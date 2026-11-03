import type { HelperOrder, ParsedTradeUrl } from "@skinpact/shared";
import { parseTradeUrl } from "@skinpact/shared";
import type { SteamItem } from "./steam.js";

export interface ValidatedOrder {
  order: HelperOrder;
  parsedTradeUrl: ParsedTradeUrl;
  item: SteamItem;
}

export type OrderValidation =
  | { ok: true; value: ValidatedOrder }
  | { ok: false; reason: string };

export function maskSteamId(steamId: string): string {
  if (!/^\d{17}$/.test(steamId)) return "unknown";
  return `${steamId.slice(0, 4)}…${steamId.slice(-4)}`;
}

export function offerMessage(listingId: string): string {
  return `SkinPact S1 listing #${listingId}`;
}

export function validateOrder(
  order: HelperOrder,
  loggedInSellerSteamId: string,
  inventory: SteamItem[],
): OrderValidation {
  if (!/^\d+$/.test(String(order.listingId)) || String(order.listingId) === "0") {
    return { ok: false, reason: "listing_id_invalid" };
  }
  if (order.sellerSteamId !== loggedInSellerSteamId) {
    return { ok: false, reason: "seller_steam_account_mismatch" };
  }

  let parsed: ParsedTradeUrl;
  try {
    parsed = parseTradeUrl(order.buyerTradeUrl);
  } catch {
    return { ok: false, reason: "buyer_trade_url_invalid" };
  }
  if (parsed.steamId64 !== order.buyerSteamId) {
    return { ok: false, reason: "buyer_trade_url_id_mismatch" };
  }
  if (parsed.steamId64 === loggedInSellerSteamId) {
    return { ok: false, reason: "buyer_is_seller" };
  }

  const item = inventory.find(
    (candidate) =>
      candidate.assetId === order.item.assetId &&
      candidate.classId === order.item.classId &&
      candidate.instanceId === order.item.instanceId,
  );
  if (!item) return { ok: false, reason: "item_missing_or_not_tradable" };
  if (item.marketHashName !== order.item.marketHashName) {
    return { ok: false, reason: "item_market_hash_name_mismatch" };
  }

  return { ok: true, value: { order, parsedTradeUrl: parsed, item } };
}

export type OfferAction =
  | "wait"
  | "needs_confirmation"
  | "accepted"
  | "held"
  | "failed"
  | "review";

export function offerStateAction(state: number): OfferAction {
  switch (state) {
    case 2:
      return "wait";
    case 9:
      return "needs_confirmation";
    case 3:
      return "accepted";
    case 11:
      return "held";
    case 5:
    case 6:
    case 7:
    case 8:
      return "failed";
    case 1:
    case 4:
    case 10:
      return "review";
    default:
      return "review";
  }
}

export const OFFER_STATE_NAMES: Record<number, string> = {
  1: "Invalid",
  2: "Active",
  3: "Accepted",
  4: "Countered",
  5: "Expired",
  6: "Canceled",
  7: "Declined",
  8: "InvalidItems",
  9: "CreatedNeedsConfirmation",
  10: "CanceledBySecondFactor",
  11: "InEscrow",
};

export function offerStateName(state: number): string {
  return OFFER_STATE_NAMES[state] ?? `Unknown(${state})`;
}

export interface SentOfferSummary {
  id: string;
  partnerSteamId: string;
  state: number;
  assetIds: string[];
  message: string | null;
}

export interface OfferMatch {
  match: SentOfferSummary | null;
  ambiguous: boolean;
}

export function findMatchingSentOffer(
  offers: SentOfferSummary[],
  query: { listingId: string; buyerSteamId: string; assetId: string },
): OfferMatch {
  const expected = offerMessage(query.listingId);
  const matches = offers.filter(
    (offer) =>
      offer.partnerSteamId === query.buyerSteamId &&
      offer.assetIds.includes(query.assetId) &&
      offer.message === expected &&
      (offer.state === 2 || offer.state === 9),
  );
  if (matches.length === 1) return { match: matches[0] ?? null, ambiguous: false };
  return { match: null, ambiguous: matches.length > 1 };
}

/** Redact accidental URL/token material from third-party error messages before logging. */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(token|partner|access_token|refresh_token)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 300);
}
