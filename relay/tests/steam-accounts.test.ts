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

const TOKEN = "savedAccountTokenThatMustNeverLeak_456";
const PARTNER = (BigInt(BUYER_STEAM_ID) - STEAMID64_BASE).toString();
const TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=${TOKEN}`;
const INVENTORY_URL = `https://steamcommunity.com/profiles/${BUYER_STEAM_ID}/inventory/`;
const SELLER_PARTNER = (BigInt(SELLER_STEAM_ID) - STEAMID64_BASE).toString();
const SELLER_TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${SELLER_PARTNER}&token=sellerSavedToken`;

async function createAccount(
  h: TestHarness,
  token: string,
  tradeUrl: string,
  inventoryId: string,
) {
  return request(h.app)
    .post("/steam-accounts")
    .set("Authorization", `Bearer ${token}`)
    .send({ tradeUrl, inventoryId });
}

async function prepareSellerItem(h: TestHarness): Promise<string> {
  const bound = await request(h.app)
    .post("/profiles/me")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID });
  assert.equal(bound.status, 200);
  const prepared = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(prepared.status, 200);
  return prepared.body.itemHash as string;
}

async function pairHelper(h: TestHarness): Promise<string> {
  const codeResponse = await request(h.app)
    .post("/helper/pairing-code")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(codeResponse.status, 200);
  const paired = await request(h.app).post("/helper/pair").send({ code: codeResponse.body.code });
  assert.equal(paired.status, 200);
  return paired.body.token as string;
}

test("saved buyer Steam account stores only public metadata and links without re-entering a URL", async () => {
  const h = await makeHarness();
  h.steamProfiles.profiles.set(BUYER_STEAM_ID, {
    steamId64: BUYER_STEAM_ID,
    nickname: "BuyerNick",
    avatarUrl: "https://avatars.steamstatic.com/example_medium.jpg",
  });

  const created = await createAccount(h, h.buyerToken, TRADE_URL, INVENTORY_URL);
  assert.equal(created.status, 200);
  assert.equal(created.body.account.steamId64, BUYER_STEAM_ID);
  assert.equal(created.body.account.inventoryId, BUYER_STEAM_ID);
  assert.equal(created.body.account.nickname, "BuyerNick");
  assert.equal(
    created.body.account.avatarUrl,
    "https://avatars.steamstatic.com/example_medium.jpg",
  );
  assert.equal(JSON.stringify(created.body).includes(TOKEN), false);
  assert.equal("ciphertext" in created.body.account, false);
  assert.equal(created.headers["cache-control"], "no-store");
  const accountId = created.body.account.id as string;
  assert.match(accountId, /^bsa_/);

  const listed = await request(h.app)
    .get("/steam-accounts")
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.accounts.length, 1);
  assert.equal(listed.body.accounts[0].id, accountId);
  assert.equal(JSON.stringify(listed.body).includes(TOKEN), false);
  assert.equal(JSON.stringify(listed.body).includes("ciphertext"), false);

  const stored = h.db
    .prepare("SELECT * FROM buyer_steam_accounts WHERE id = ?")
    .get(accountId) as any;
  assert.ok(stored);
  assert.notEqual(stored.ciphertext, TRADE_URL);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false);
  assert.equal(decryptString(stored, h.config.encryptionKey), TRADE_URL);

  const itemHash = await prepareSellerItem(h);
  h.chain.add("21", {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    itemHash,
    status: ListingStatus.Active,
  });

  const noLink = await request(h.app)
    .get("/listings/21/buyer-account")
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(noLink.status, 200);
  assert.deepEqual(noLink.body, { linked: false });

  const linked = await request(h.app)
    .put("/listings/21/buyer-trade-url")
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ steamAccountId: accountId });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.buyerSteamId, BUYER_STEAM_ID);
  assert.equal(linked.body.steamAccountId, accountId);
  assert.equal(JSON.stringify(linked.body).includes(TOKEN), false);

  const buyerLink = await request(h.app)
    .get("/listings/21/buyer-account")
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(buyerLink.status, 200);
  assert.equal(buyerLink.body.linked, true);
  assert.equal(buyerLink.body.steamAccountId, accountId);
  assert.equal(buyerLink.body.steamId64, BUYER_STEAM_ID);
  assert.equal(buyerLink.body.nickname, "BuyerNick");
  assert.equal(JSON.stringify(buyerLink.body).includes(TOKEN), false);
  assert.equal(buyerLink.headers["cache-control"], "no-store");

  const sellerViewOfActive = await request(h.app)
    .get("/listings/21/buyer-account")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(sellerViewOfActive.status, 200);
  assert.equal(sellerViewOfActive.body.linked, false);
  assert.equal(JSON.stringify(sellerViewOfActive.body).includes(BUYER_STEAM_ID), false);

  const buyerUrlRow = h.db
    .prepare("SELECT * FROM buyer_urls WHERE listing_id = ? AND buyer_address = ?")
    .get("21", h.buyer.address.toLowerCase()) as any;
  assert.ok(buyerUrlRow);
  assert.equal(decryptString(buyerUrlRow, h.config.encryptionKey), TRADE_URL);
  assert.equal(JSON.stringify(buyerUrlRow).includes(TOKEN), false);

  h.chain.listings.get("21")!.status = ListingStatus.Funded;
  const sellerLink = await request(h.app)
    .get("/listings/21/buyer-account")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(sellerLink.status, 403);

  const helperToken = await pairHelper(h);
  const orders = await request(h.app)
    .get("/helper/orders")
    .set("Authorization", `Bearer ${helperToken}`);
  assert.equal(orders.status, 200);
  assert.equal(orders.body.orders[0].buyerTradeUrl, TRADE_URL);
  assert.equal(orders.body.orders[0].buyerSteamId, BUYER_STEAM_ID);
});

test("saved account upserts by SteamID64 and falls back when the profile page is unavailable", async () => {
  const h = await makeHarness();
  h.steamProfiles.fail = true;

  const first = await createAccount(h, h.buyerToken, TRADE_URL, BUYER_STEAM_ID);
  assert.equal(first.status, 200);
  assert.equal(first.body.account.nickname, `Steam ${BUYER_STEAM_ID.slice(-6)}`);
  assert.equal(first.body.account.avatarUrl, null);
  const id = first.body.account.id as string;

  h.steamProfiles.fail = false;
  h.steamProfiles.profiles.set(BUYER_STEAM_ID, {
    steamId64: BUYER_STEAM_ID,
    nickname: "UpdatedNick",
    avatarUrl: null,
  });
  const updated = await createAccount(h, h.buyerToken, TRADE_URL, INVENTORY_URL);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.account.id, id);
  assert.equal(updated.body.account.nickname, "UpdatedNick");

  const list = await request(h.app)
    .get("/steam-accounts")
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(list.body.accounts.length, 1);
});

test("saved account rejects mismatched or invalid Steam identifiers", async () => {
  const h = await makeHarness();
  const sellerInventory = `https://steamcommunity.com/profiles/${SELLER_STEAM_ID}/inventory/`;

  const mismatch = await createAccount(h, h.buyerToken, TRADE_URL, sellerInventory);
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error, "steam_account_mismatch");

  const inventoryNotGiven = await createAccount(h, h.buyerToken, INVENTORY_URL, BUYER_STEAM_ID);
  assert.equal(inventoryNotGiven.status, 422);
  assert.equal(inventoryNotGiven.body.error, "trade_url_invalid");

  const badInventory = await createAccount(
    h,
    h.buyerToken,
    TRADE_URL,
    "https://steamcommunity.com/id/vanity/inventory/",
  );
  assert.equal(badInventory.status, 422);
  assert.equal(badInventory.body.error, "inventory_id_invalid");

  const anonymous = await request(h.app)
    .get("/steam-accounts");
  assert.equal(anonymous.status, 401);
});

test("buyer Steam accounts are wallet-scoped and cannot be linked or deleted by another wallet", async () => {
  const h = await makeHarness();
  const sellerAccount = await createAccount(
    h,
    h.sellerToken,
    SELLER_TRADE_URL,
    SELLER_STEAM_ID,
  );
  assert.equal(sellerAccount.status, 200);

  const buyerList = await request(h.app)
    .get("/steam-accounts")
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(buyerList.status, 200);
  assert.deepEqual(buyerList.body.accounts, []);

  h.chain.add("31", {
    seller: h.seller.address.toLowerCase(),
    buyer: h.buyer.address.toLowerCase(),
    status: ListingStatus.Active,
  });

  const crossLink = await request(h.app)
    .put("/listings/31/buyer-trade-url")
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ steamAccountId: sellerAccount.body.account.id });
  assert.equal(crossLink.status, 404);
  assert.equal(crossLink.body.error, "steam_account_not_found");

  const crossDelete = await request(h.app)
    .delete(`/steam-accounts/${sellerAccount.body.account.id}`)
    .set("Authorization", `Bearer ${h.buyerToken}`);
  assert.equal(crossDelete.status, 404);

  const sellerList = await request(h.app)
    .get("/steam-accounts")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(sellerList.status, 200);
  assert.equal(sellerList.body.accounts.length, 1);

  const ownDelete = await request(h.app)
    .delete(`/steam-accounts/${sellerAccount.body.account.id}`)
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.equal(ownDelete.status, 200);
  const empty = await request(h.app)
    .get("/steam-accounts")
    .set("Authorization", `Bearer ${h.sellerToken}`);
  assert.deepEqual(empty.body.accounts, []);
});
