import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { itemHash } from "@skinpact/shared";
import { ITEM, SELLER_STEAM_ID, makeHarness } from "./helpers.js";

async function bindSeller(h: Awaited<ReturnType<typeof makeHarness>>): Promise<void> {
  const response = await request(h.app)
    .post("/profiles/me")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID });
  assert.equal(response.status, 200);
}

test("inventory is public and prepare records authoritative Steam item metadata", async () => {
  const h = await makeHarness();

  const inventory = await request(h.app).get(`/inventory/${SELLER_STEAM_ID}`);
  assert.equal(inventory.status, 200);
  assert.equal(inventory.body.items.length, 1);
  assert.equal(inventory.body.items[0].assetId, ITEM.assetId);

  const unauthenticated = await request(h.app)
    .post("/items/prepare")
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(unauthenticated.status, 401);

  await bindSeller(h);
  const prepared = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({
      steamId64: SELLER_STEAM_ID,
      assetId: ITEM.assetId,
      classId: "999999999",
      instanceId: ITEM.instanceId,
    });
  assert.equal(prepared.status, 404);

  const result = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(result.status, 200);
  const expected = itemHash({
    sellerSteamId: SELLER_STEAM_ID,
    assetId: ITEM.assetId,
    classId: ITEM.classId,
    instanceId: ITEM.instanceId,
    marketHashName: ITEM.marketHashName,
  });
  assert.equal(result.body.itemHash, expected);

  const metadata = await request(h.app).get(`/metadata/${expected}`);
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.marketHashName, ITEM.marketHashName);
  assert.equal(metadata.body.seller, h.seller.address.toLowerCase());
  assert.equal(metadata.body.sellerSteamId, undefined);

  const other = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.buyerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(other.status, 403);
});

test("prepare reports missing inventory and Steam unavailability without upstream details", async () => {
  const h = await makeHarness();
  await bindSeller(h);

  const missing = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: "404404404" });
  assert.equal(missing.status, 404);

  h.inventory.fail = true;
  const unavailable = await request(h.app)
    .post("/items/prepare")
    .set("Authorization", `Bearer ${h.sellerToken}`)
    .send({ steamId64: SELLER_STEAM_ID, assetId: ITEM.assetId });
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.body.error, "steam_inventory_unavailable");
});
