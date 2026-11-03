import assert from "node:assert/strict";
import test from "node:test";
import { STEAMID64_BASE, type HelperOrder } from "@skinpact/shared";
import {
  findMatchingSentOffer,
  offerStateAction,
  safeErrorMessage,
  validateOrder,
  type SentOfferSummary,
} from "../src/orders.js";
import type { SteamItem } from "../src/steam.js";

const SELLER_ID = "76561198000000001";
const BUYER_ID = "76561198000000002";
const BUYER_PARTNER = (BigInt(BUYER_ID) - STEAMID64_BASE).toString();
const TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${BUYER_PARTNER}&token=secret-token`;
const ITEM: SteamItem = {
  assetId: "12345678901",
  classId: "987654321",
  instanceId: "188530139",
  marketHashName: "AK-47 | Redline (Field-Tested)",
};

function order(overrides: Partial<HelperOrder> = {}): HelperOrder {
  return {
    listingId: "7",
    seller: "0x0000000000000000000000000000000000000001",
    buyer: "0x0000000000000000000000000000000000000002",
    sellerSteamId: SELLER_ID,
    buyerSteamId: BUYER_ID,
    buyerTradeUrl: TRADE_URL,
    item: { sellerSteamId: SELLER_ID, ...ITEM },
    price: "10000000000000000",
    bond: "1000000000000000",
    offerDeadline: 1_700_000_000,
    ...overrides,
  };
}

test("validates the seller account, trade URL/SteamID match, and exact inventory item", () => {
  const valid = validateOrder(order(), SELLER_ID, [ITEM]);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.parsedTradeUrl.steamId64, BUYER_ID);
    assert.equal(valid.value.item.assetId, ITEM.assetId);
  }

  const wrongSeller = validateOrder(order(), "76561190000000000", [ITEM]);
  assert.deepEqual(wrongSeller, { ok: false, reason: "seller_steam_account_mismatch" });

  const wrongBuyer = validateOrder(order({ buyerSteamId: "76561190000000001" }), SELLER_ID, [ITEM]);
  assert.deepEqual(wrongBuyer, { ok: false, reason: "buyer_trade_url_id_mismatch" });

  const missing = validateOrder(order(), SELLER_ID, []);
  assert.deepEqual(missing, { ok: false, reason: "item_missing_or_not_tradable" });

  const wrongName = validateOrder(
    order({ item: { ...ITEM, sellerSteamId: SELLER_ID, marketHashName: "Wrong name" } }),
    SELLER_ID,
    [ITEM],
  );
  assert.deepEqual(wrongName, { ok: false, reason: "item_market_hash_name_mismatch" });

  const selfBuyer = validateOrder(
    order({
      buyerSteamId: SELLER_ID,
      buyerTradeUrl: `https://steamcommunity.com/tradeoffer/new/?partner=${
        BigInt(SELLER_ID) - STEAMID64_BASE
      }&token=secret`,
    }),
    SELLER_ID,
    [ITEM],
  );
  assert.deepEqual(selfBuyer, { ok: false, reason: "buyer_is_seller" });

  const badUrl = validateOrder(order({ buyerTradeUrl: "https://example.com/trade" }), SELLER_ID, [ITEM]);
  assert.deepEqual(badUrl, { ok: false, reason: "buyer_trade_url_invalid" });
});

test("maps Steam offer states to intentional helper actions", () => {
  assert.equal(offerStateAction(2), "wait");
  assert.equal(offerStateAction(9), "needs_confirmation");
  assert.equal(offerStateAction(3), "accepted");
  assert.equal(offerStateAction(11), "held");
  for (const state of [5, 6, 7, 8]) assert.equal(offerStateAction(state), "failed");
  for (const state of [1, 4, 10, 99]) assert.equal(offerStateAction(state), "review");
});

function sentOffer(overrides: Partial<SentOfferSummary> = {}): SentOfferSummary {
  return {
    id: "9464202838",
    partnerSteamId: BUYER_ID,
    state: 2,
    assetIds: [ITEM.assetId],
    message: "SkinPact S1 listing #7",
    ...overrides,
  };
}

test("matches only one exact active sent offer for safe recovery", () => {
  const query = { listingId: "7", buyerSteamId: BUYER_ID, assetId: ITEM.assetId };

  const none = findMatchingSentOffer([sentOffer({ partnerSteamId: SELLER_ID })], query);
  assert.deepEqual(none, { match: null, ambiguous: false });

  const one = findMatchingSentOffer([sentOffer()], query);
  assert.equal(one.match?.id, "9464202838");
  assert.equal(one.ambiguous, false);

  const two = findMatchingSentOffer(
    [sentOffer({ id: "1" }), sentOffer({ id: "2" })],
    query,
  );
  assert.equal(two.match, null);
  assert.equal(two.ambiguous, true);

  const wrongMessage = findMatchingSentOffer(
    [sentOffer({ message: "SkinPact S1 listing #8" })],
    query,
  );
  assert.equal(wrongMessage.match, null);
});

test("redacts accidental URL/token material from third-party errors", () => {
  const message = safeErrorMessage(
    new Error(`failed at ${TRADE_URL}?access_token=abc123&partner=42`),
  );
  assert.equal(message.includes("secret-token"), false);
  assert.equal(message.includes("abc123"), false);
  assert.equal(message.includes("steamcommunity.com"), false);
  assert.match(message, /redacted/);
});
