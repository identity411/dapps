import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { ListingStatus, STEAMID64_BASE } from "@skinpact/shared";
import { decryptString } from "../src/crypto.js";
import {
  BUYER_STEAM_ID,
  ITEM,
  SELLER_STEAM_ID,
  makeHarness,
  type TestHarness,
} from "./helpers.js";

const LISTING_ID = "7";
const TOKEN = "buyerTradeTokenThatMustNeverLeak_123";
const PARTNER = (BigInt(BUYER_STEAM_ID) - STEAMID64_BASE).toString();
const TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=${TOKEN}`;

async function bind(h: TestHarness, walletToken: string, steamId64: string): Promise<void> {
  const response = await request(h.app)
    .post("/profiles/me")
    .set("Authorization", `Bearer ${walletToken}`)
    .send({ steamId64 });
  assert.equal(response.status, 200);
}

async function prepareSellerItem(h: TestHarness): Promise<string> {
  await bind(h, h.sellerToken, SELLER_STEAM_ID);
  const prepared = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(prepared.status, 200);
  return prepared.body.itemHash as string;
}

function fundedListing(h: TestHarness, itemHash: string): void {
  h.chain.add(LISTING_ID, {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash,
    status: ListingStatus.Funded,
  });
}

test("buyer trade URL is encrypted, seller-only after funding, and never echoed in public data", async () => {
  const h = await makeHarness();
  const hash = await prepareSellerItem(h);
  h.chain.add(LISTING_ID, {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash: hash,
    status: ListingStatus.Active,
  });

  const submitted = await request(h.app)
    .put(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: TRADE_URL });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.buyerSteamId, BUYER_STEAM_ID);
  assert.equal(JSON.stringify(submitted.body).includes(TOKEN), false);

  const row = h.db
    .prepare("SELECT * FROM buyer_urls WHERE listing_id = ?")
    .get(LISTING_ID) as any;
  assert.ok(row);
  assert.notEqual(row.ciphertext, TRADE_URL);
  assert.equal(JSON.stringify(row).includes(TOKEN), false);
  assert.equal(
    decryptString(row, h.config.encryptionKey),
    TRADE_URL,
  );

  const tooEarly = await request(h.app)
    .get(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(tooEarly.status, 409);

  const listing = h.chain.listings.get(LISTING_ID);
  assert.ok(listing);
  listing.status = ListingStatus.Funded;

  const buyerAttempt = await request(h.app)
    .get(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(buyerAttempt.status, 403);

  const sellerRead = await request(h.app)
    .get(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(sellerRead.status, 200);
  assert.equal(sellerRead.body.tradeUrl, TRADE_URL);
  assert.equal(sellerRead.headers["cache-control"], "no-store");

  const metadata = await request(h.app).get(`/metadata/${hash}`);
  assert.equal(JSON.stringify(metadata.body).includes(TOKEN), false);
});

test("trade URL rejects inventory links and cannot be revealed before funding or to the wrong buyer", async () => {
  const h = await makeHarness();
  const hash = await prepareSellerItem(h);
  h.chain.add(LISTING_ID, {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash: hash,
    status: ListingStatus.Active,
  });

  const inventoryLink = await request(h.app)
    .put(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: `https://steamcommunity.com/profiles/${BUYER_STEAM_ID}/inventory/` });
  assert.equal(inventoryLink.status, 422);

  h.chain.add("8", {
    seller: h.seller.address.toLowerCase(),
    buyer: h.seller.address.toLowerCase(),
    itemHash: hash,
    status: ListingStatus.Funded,
  });
  const wrongBuyer = await request(h.app)
    .put("/listings/8/buyer-trade-url")
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: TRADE_URL });
  assert.equal(wrongBuyer.status, 403);

  const unknown = await request(h.app)
    .put("/listings/99/buyer-trade-url")
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: TRADE_URL });
  assert.equal(unknown.status, 404);
});

test("helper pairs with a one-time code and receives only funded orders for its seller", async () => {
  const h = await makeHarness();
  const hash = await prepareSellerItem(h);
  await bind(h, h.buyerToken, BUYER_STEAM_ID);
  h.chain.add(LISTING_ID, {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash: hash,
    status: ListingStatus.Active,
  });

  const submitted = await request(h.app)
    .put(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: TRADE_URL });
  assert.equal(submitted.status, 200);

  const codeResponse = await request(h.app)
    .post("/helper/pairing-code")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(codeResponse.status, 200);
  assert.match(codeResponse.body.code, /^\d{6}$/);

  const paired = await request(h.app)
    .post("/helper/pair")
    .send({ code: codeResponse.body.code });
  assert.equal(paired.status, 200);
  const helperToken = paired.body.token as string;
  assert.match(helperToken, /^sp_helper_/);

  const reused = await request(h.app)
    .post("/helper/pair")
    .send({ code: codeResponse.body.code });
  assert.equal(reused.status, 401);

  const empty = await request(h.app)
    .get("/helper/orders")
    .set("Authorization", `Bearer ${helperToken}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.orders, []);

  const listing = h.chain.listings.get(LISTING_ID);
  assert.ok(listing);
  listing.status = ListingStatus.Funded;

  const orders = await request(h.app)
    .get("/helper/orders")
    .set("Authorization", `Bearer ${helperToken}`);
  assert.equal(orders.status, 200);
  assert.equal(orders.body.orders.length, 1);
  assert.equal(orders.body.orders[0].buyerTradeUrl, TRADE_URL);
  assert.equal(orders.body.orders[0].buyerSteamId, BUYER_STEAM_ID);
  assert.equal(orders.body.orders[0].item.marketHashName, ITEM.marketHashName);
  assert.equal(orders.headers["cache-control"], "no-store");

  const sellerJwtCannotUseHelperRoute = await request(h.app)
    .get("/helper/orders")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(sellerJwtCannotUseHelperRoute.status, 401);

  const otherWallet = await request(h.app)
    .get("/helper/orders")
    .set("Authorization", "Bearer sp_helper_not_a_real_token");
  assert.equal(otherWallet.status, 401);
});

test("offer and acceptance evidence endpoints are idempotent and scoped to the seller", async () => {
  const h = await makeHarness();
  const hash = await prepareSellerItem(h);
  await bind(h, h.buyerToken, BUYER_STEAM_ID);
  h.chain.add(LISTING_ID, {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash: hash,
    status: ListingStatus.Funded,
  });
  const submission = await request(h.app)
    .put(`/listings/${LISTING_ID}/buyer-trade-url`)
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ tradeUrl: TRADE_URL });
  assert.equal(submission.status, 200);

  const codeResponse = await request(h.app)
    .post("/helper/pairing-code")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  const paired = await request(h.app).post("/helper/pair").send({ code: codeResponse.body.code });
  const helperToken = paired.body.token as string;

  const offer = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/offer`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "9464202838" });
  assert.equal(offer.status, 200);
  const expectedOfferHash = offer.body.offerIdHash as string;

  const duplicateOffer = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/offer`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "9464202838" });
  assert.equal(duplicateOffer.status, 200);
  assert.equal(duplicateOffer.body.idempotent, true);

  const conflictingOffer = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/offer`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "1111111111" });
  assert.equal(conflictingOffer.status, 409);

  const acceptedTooEarly = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/accepted`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "9464202838", observedAt: new Date().toISOString() });
  assert.equal(acceptedTooEarly.status, 409);

  const listing = h.chain.listings.get(LISTING_ID);
  assert.ok(listing);
  listing.status = ListingStatus.OfferSent;
  listing.offerIdHash = expectedOfferHash;

  const wrongOffer = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/accepted`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "2222222222", observedAt: new Date().toISOString() });
  assert.equal(wrongOffer.status, 409);

  const observedAt = new Date().toISOString();
  const accepted = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/accepted`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "9464202838", observedAt });
  assert.equal(accepted.status, 200);
  const evidenceHash = accepted.body.evidenceHash as string;
  assert.match(evidenceHash, /^0x[0-9a-f]{64}$/);

  const repeated = await request(h.app)
    .post(`/helper/listings/${LISTING_ID}/accepted`)
    .set("Authorization", `Bearer ${helperToken}`)
    .send({ tradeOfferId: "9464202838", observedAt });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.idempotent, true);
  assert.equal(repeated.body.evidenceHash, evidenceHash);

  const evidenceRow = h.db
    .prepare("SELECT * FROM evidence WHERE listing_id = ?")
    .get(LISTING_ID) as any;
  assert.equal(JSON.stringify(evidenceRow).includes(TOKEN), false);

  const report = await request(h.app)
    .get(`/listings/${LISTING_ID}/report`)
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(report.status, 200);
  assert.equal(report.body.offer.tradeOfferId, "9464202838");
  assert.equal(report.body.evidence.evidenceHash, evidenceHash);
  assert.equal(JSON.stringify(report.body).includes(TOKEN), false);

  const helperReport = await request(h.app)
    .get(`/listings/${LISTING_ID}/report`)
    .set("Authorization", `Bearer ${helperToken}`);
  assert.equal(helperReport.status, 200);

  const reportedByBuyer = await request(h.app)
    .get(`/listings/${LISTING_ID}/report`)
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(reportedByBuyer.status, 403);
});

test("terminal cleanup removes Trade URLs, while funded and RPC-failing listings are retained", async () => {
  const h = await makeHarness();
  await bind(h, h.buyerToken, BUYER_STEAM_ID);
  for (const id of ["11", "12", "13"]) {
    h.chain.add(id, {
      seller: h.seller.address.toLowerCase(),
      buyer: h.buyer.address.toLowerCase(),
      status: ListingStatus.Active,
    });
    const response = await request(h.app)
      .put(`/listings/${id}/buyer-trade-url`)
      .set("Authorization", `Bearer ${h.buyerToken}`)
      .send({ tradeUrl: TRADE_URL });
    assert.equal(response.status, 200);
  }
  h.chain.listings.get("11")!.status = ListingStatus.Completed;
  h.chain.listings.get("12")!.status = ListingStatus.Funded;
  h.chain.failListings.add("13");

  const { cleanupTerminalBuyerUrls } = await import("../src/app.js");
  const removed = await cleanupTerminalBuyerUrls(h.db, h.chain);
  assert.equal(removed, 1);
  const remaining = h.db
    .prepare("SELECT listing_id FROM buyer_urls ORDER BY listing_id")
    .all() as Array<{ listing_id: string }>;
  assert.deepEqual(
    remaining.map((row) => row.listing_id),
    ["12", "13"],
  );
});
