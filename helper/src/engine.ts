import type { HelperOrder } from "@skinpact/shared";
import { Ledger, type LedgerEntry } from "./ledger.js";
import {
  findMatchingSentOffer,
  offerStateAction,
  offerStateName,
  safeErrorMessage,
  validateOrder,
  type SentOfferSummary,
} from "./orders.js";
import { RelayClient, RelayHttpError } from "./relay.js";
import { SteamClient, type RawInventoryEntry } from "./steam.js";

export class HelperTokenExpiredError extends Error {
  constructor() {
    super("helper_token_expired");
  }
}

function maskOfferId(tradeOfferId: string): string {
  if (tradeOfferId.length <= 6) return tradeOfferId;
  return `${tradeOfferId.slice(0, 4)}…${tradeOfferId.slice(-3)}`;
}

function ledgerNoteEquals(entry: LedgerEntry | null, note: string): boolean {
  return Boolean(entry && entry.note === note);
}

async function reportOfferIfNeeded(
  relay: RelayClient,
  ledger: Ledger,
  entry: LedgerEntry,
): Promise<LedgerEntry> {
  if (entry.offerReported && entry.offerIdHash) return entry;
  if (!entry.tradeOfferId) return entry;
  try {
    const result = await relay.reportOffer(entry.listingId, entry.tradeOfferId);
    const updated = ledger.update(entry.listingId, {
      offerReported: true,
      offerIdHash: result.offerIdHash,
      note: "offer_reported",
    });
    console.log(
      `[listing #${entry.listingId}] offer reported. offerIdHash=${result.offerIdHash}`,
    );
    console.log(
      "ACTION: seller must sign markOfferSent on the Web BEFORE the buyer accepts. Buyer must wait for that mark.",
    );
    return updated;
  } catch (error) {
    const code = error instanceof RelayHttpError ? error.code : "relay_unreachable";
    const note = `offer_report_pending:${code}`;
    if (!ledgerNoteEquals(entry, note)) {
      console.warn(`[listing #${entry.listingId}] offer report pending: ${code}`);
      return ledger.update(entry.listingId, { note });
    }
    return entry;
  }
}

async function sendNewOrder(
  relay: RelayClient,
  steam: SteamClient,
  ledger: Ledger,
  order: HelperOrder,
  inventory: RawInventoryEntry[],
): Promise<void> {
  const inventoryItems = inventory.map((entry) => entry.item);
  const validation = validateOrder(order, steam.loggedInSteamId, inventoryItems);
  if (!validation.ok) {
    ledger.set({
      listingId: String(order.listingId),
      status: "blocked",
      offerReported: false,
      note: validation.reason,
      buyerSteamId: order.buyerSteamId,
      assetId: order.item.assetId,
    });
    console.warn(`[listing #${order.listingId}] blocked before send: ${validation.reason}`);
    return;
  }

  const raw = inventory.find(
    (candidate) =>
      candidate.item.assetId === validation.value.item.assetId &&
      candidate.item.classId === validation.value.item.classId &&
      candidate.item.instanceId === validation.value.item.instanceId,
  );
  if (!raw) {
    ledger.set({
      listingId: String(order.listingId),
      status: "blocked",
      offerReported: false,
      note: "item_missing_or_not_tradable",
      buyerSteamId: order.buyerSteamId,
      assetId: order.item.assetId,
    });
    return;
  }

  // Intent record before sending: on a crash we will check Steam rather than resend.
  ledger.set({
    listingId: String(order.listingId),
    status: "sending",
    offerReported: false,
    buyerSteamId: order.buyerSteamId,
    assetId: order.item.assetId,
    note: "sending",
  });

  let sent;
  try {
    sent = await steam.sendOffer(validation.value.order.buyerTradeUrl, raw.raw, order.listingId);
  } catch (error) {
    ledger.update(String(order.listingId), {
      status: "needs_review",
      note: "send_result_uncertain",
    });
    console.error(
      `[listing #${order.listingId}] offer send result is uncertain; inspect Steam sent offers manually. No automatic retry. ${safeErrorMessage(error)}`,
    );
    return;
  }

  let entry = ledger.update(String(order.listingId), {
    status: "sent",
    tradeOfferId: sent.tradeOfferId,
    note: `sent:${sent.status}`,
  });
  console.log(
    `[listing #${order.listingId}] Steam offer #${sent.tradeOfferId} created (status=${sent.status}).`,
  );
  if (sent.status === "pending") {
    console.warn(
      `[listing #${order.listingId}] Steam requires seller mobile confirmation before the offer becomes active.`,
    );
  }
  entry = await reportOfferIfNeeded(relay, ledger, entry);
  if (!entry.offerReported) {
    console.warn(
      `[listing #${order.listingId}] Offer exists but Relay report is pending. Do not resend; seller should wait to mark until report succeeds.`,
    );
  }
}

async function adoptExistingOffer(
  relay: RelayClient,
  ledger: Ledger,
  order: HelperOrder,
  tradeOfferId: string,
): Promise<void> {
  console.warn(
    `[listing #${order.listingId}] found existing active Steam offer #${maskOfferId(tradeOfferId)}; adopting it instead of creating a duplicate.`,
  );
  const entry = ledger.set({
    listingId: String(order.listingId),
    status: "sent",
    tradeOfferId,
    offerReported: false,
    buyerSteamId: order.buyerSteamId,
    assetId: order.item.assetId,
    note: "adopted_existing_offer",
  });
  await reportOfferIfNeeded(relay, ledger, entry);
}

export async function recoverSendingEntries(
  relay: RelayClient,
  steam: SteamClient,
  ledger: Ledger,
): Promise<void> {
  const pending = ledger.all().filter((entry) => entry.status === "sending");
  if (pending.length === 0) return;
  let activeOffers: SentOfferSummary[];
  try {
    activeOffers = await steam.getActiveSentOffers();
  } catch (error) {
    console.error(
      `Cannot verify previously sending offers; no new offers will be sent until this is resolved. ${safeErrorMessage(error)}`,
    );
    return;
  }
  for (const entry of pending) {
    if (!entry.buyerSteamId || !entry.assetId) {
      ledger.update(entry.listingId, {
        status: "needs_review",
        note: "sending_state_unverifiable",
      });
      console.error(`[listing #${entry.listingId}] unverifiable sending state; manual review required.`);
      continue;
    }
    const match = findMatchingSentOffer(activeOffers, {
      listingId: entry.listingId,
      buyerSteamId: entry.buyerSteamId,
      assetId: entry.assetId,
    });
    if (match.match) {
      const updated = ledger.update(entry.listingId, {
        status: "sent",
        tradeOfferId: match.match.id,
        note: "recovered_from_steam",
      });
      console.log(
        `[listing #${entry.listingId}] recovered in-flight offer #${maskOfferId(match.match.id)} from Steam.`,
      );
      await reportOfferIfNeeded(relay, ledger, updated);
    } else {
      ledger.update(entry.listingId, {
        status: "needs_review",
        note: match.ambiguous ? "multiple_matching_offers" : "no_matching_offer_found",
      });
      console.error(
        `[listing #${entry.listingId}] could not verify whether an offer was sent; no automatic resend. Inspect Steam sent offers manually.`,
      );
    }
  }
}

async function monitorEntry(
  relay: RelayClient,
  steam: SteamClient,
  ledger: Ledger,
  entry: LedgerEntry,
): Promise<void> {
  if (!entry.tradeOfferId) return;
  let offer;
  try {
    offer = await steam.getOffer(entry.tradeOfferId);
  } catch (error) {
    const note = `state_poll_failed:${safeErrorMessage(error)}`;
    if (!ledgerNoteEquals(entry, note)) {
      console.warn(`[listing #${entry.listingId}] could not poll Steam offer state; will retry.`);
      ledger.update(entry.listingId, { note });
    }
    return;
  }

  const state = Number(offer.state);
  if (entry.lastState !== state) {
    ledger.update(entry.listingId, { lastState: state, note: `state:${offerStateName(state)}` });
    console.log(
      `[listing #${entry.listingId}] Steam offer state: ${offerStateName(state)} (${state}).`,
    );
  }

  const action = offerStateAction(state);
  if (action === "wait") return;

  if (action === "needs_confirmation") {
    const note = "steam_needs_mobile_confirmation";
    if (!ledgerNoteEquals(entry, note)) {
      console.warn(
        `[listing #${entry.listingId}] offer needs the seller's Steam mobile confirmation; approve it in the Steam app.`,
      );
      ledger.update(entry.listingId, { note });
    }
    return;
  }

  if (action === "accepted") {
    const reported = await reportOfferIfNeeded(relay, ledger, ledger.get(entry.listingId) ?? entry);
    if (!reported.offerReported) return;
    try {
      const result = await relay.reportAccepted(
        entry.listingId,
        entry.tradeOfferId,
        new Date().toISOString(),
      );
      ledger.update(entry.listingId, {
        status: "accepted_reported",
        evidenceHash: result.evidenceHash,
        note: "accepted_evidence_uploaded",
      });
      console.log(
        `[listing #${entry.listingId}] buyer accepted Steam offer. Evidence uploaded: ${result.evidenceHash}`,
      );
      console.log("ACTION: seller can now sign claimAccepted on the Web; helper does not sign chain txs.");
    } catch (error) {
      const code = error instanceof RelayHttpError ? error.code : "relay_unreachable";
      if (code === "listing_not_offer_sent") {
        const note = "accepted_waiting_for_seller_mark";
        if (!ledgerNoteEquals(entry, note)) {
          console.warn(
            `[listing #${entry.listingId}] buyer accepted before the on-chain mark; waiting for seller markOfferSent before evidence upload.`,
          );
          ledger.update(entry.listingId, { note });
        }
      } else {
        const note = `accepted_upload_pending:${code}`;
        if (!ledgerNoteEquals(entry, note)) {
          console.warn(`[listing #${entry.listingId}] accepted evidence upload pending: ${code}`);
          ledger.update(entry.listingId, { note });
        }
      }
    }
    return;
  }

  if (action === "held") {
    if (entry.status !== "held") {
      ledger.update(entry.listingId, {
        status: "held",
        note: "steam_in_escrow_held",
      });
      console.warn(
        `[listing #${entry.listingId}] Steam reports InEscrow(11). This is held/not final; S1 does not claim or refund. Follow up manually in S2.`,
      );
    }
    return;
  }

  if (action === "failed") {
    if (entry.status !== "failed") {
      ledger.update(entry.listingId, {
        status: "failed",
        note: `offer_failed:${offerStateName(state)}`,
      });
      console.warn(
        `[listing #${entry.listingId}] Steam offer ended in ${offerStateName(state)}. S1 does not retry or auto-refund; follow the on-chain paths/manual review.`,
      );
    }
    return;
  }

  if (action === "review") {
    if (entry.status !== "needs_review") {
      ledger.update(entry.listingId, {
        status: "needs_review",
        note: `offer_state_review:${offerStateName(state)}`,
      });
      console.warn(
        `[listing #${entry.listingId}] unexpected Steam offer state ${offerStateName(state)}; paused for manual review.`,
      );
    }
  }
}

export async function runCycle(
  relay: RelayClient,
  steam: SteamClient,
  ledger: Ledger,
): Promise<void> {
  let orders: HelperOrder[];
  try {
    orders = await relay.getOrders();
  } catch (error) {
    if (error instanceof RelayHttpError && error.status === 401) {
      throw new HelperTokenExpiredError();
    }
    console.warn(
      `Relay polling failed; existing offers are not resent. ${error instanceof RelayHttpError ? error.code : "relay_unreachable"}`,
    );
    return;
  }

  const newOrders = orders.filter((order) => !ledger.get(String(order.listingId)));
  let inventory: RawInventoryEntry[] | null = null;
  let activeSentOffers: SentOfferSummary[] | null = null;

  if (newOrders.length > 0) {
    try {
      inventory = await steam.getInventory();
    } catch (error) {
      console.warn(
        `Could not read seller inventory; no new offers sent this cycle. ${safeErrorMessage(error)}`,
      );
      inventory = null;
    }
  }

  for (const order of orders) {
    const listingId = String(order.listingId);
    const existing = ledger.get(listingId);
    if (existing) continue;
    if (!inventory) continue;

    const validation = validateOrder(
      order,
      steam.loggedInSteamId,
      inventory.map((item) => item.item),
    );
    if (!validation.ok) {
      ledger.set({
        listingId,
        status: "blocked",
        offerReported: false,
        note: validation.reason,
        buyerSteamId: order.buyerSteamId,
        assetId: order.item.assetId,
      });
      console.warn(`[listing #${listingId}] blocked before send: ${validation.reason}`);
      continue;
    }

    if (!activeSentOffers) {
      try {
        activeSentOffers = await steam.getActiveSentOffers();
      } catch (error) {
        console.warn(
          `Could not check existing Steam sent offers; no new offers sent this cycle. ${safeErrorMessage(error)}`,
        );
        break;
      }
    }
    const match = findMatchingSentOffer(activeSentOffers, {
      listingId,
      buyerSteamId: order.buyerSteamId,
      assetId: order.item.assetId,
    });
    if (match.ambiguous) {
      ledger.set({
        listingId,
        status: "needs_review",
        offerReported: false,
        note: "multiple_matching_steam_offers",
        buyerSteamId: order.buyerSteamId,
        assetId: order.item.assetId,
      });
      console.warn(
        `[listing #${listingId}] multiple matching active Steam offers found; no send. Manual review required.`,
      );
      continue;
    }
    if (match.match) {
      await adoptExistingOffer(relay, ledger, order, match.match.id);
      continue;
    }
    await sendNewOrder(relay, steam, ledger, order, inventory);
  }

  for (const entry of ledger.all()) {
    if (entry.status === "sent") {
      await monitorEntry(relay, steam, ledger, entry);
    }
  }

  const waiting = ledger.all().filter((entry) =>
    ["sending", "sent", "needs_review", "held"].includes(entry.status),
  );
  if (waiting.length > 0) {
    console.log(
      `Tracked offers needing attention/manual follow-up: ${waiting
        .map((entry) => `#${entry.listingId}(${entry.status})`)
        .join(", ")}`,
    );
  }
}
