import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { Wallet } from "ethers";
import { makeHarness } from "./helpers.js";

test("wallet nonce login issues a JWT and rejects replay", async () => {
  const h = await makeHarness();
  const wallet = Wallet.createRandom();

  const nonce = await request(h.app).post("/auth/nonce").send({ address: wallet.address });
  assert.equal(nonce.status, 200);
  assert.match(nonce.body.message, /SkinPact Relay login/);
  assert.match(nonce.body.message, /Chain ID: 31337/);
  assert.match(nonce.body.message, /Nonce: [0-9a-f]{32}/);

  const signature = await wallet.signMessage(nonce.body.message);
  const verified = await request(h.app)
    .post("/auth/verify")
    .send({ address: wallet.address, signature });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.address, wallet.address.toLowerCase());
  assert.equal(typeof verified.body.token, "string");

  const replay = await request(h.app)
    .post("/auth/verify")
    .send({ address: wallet.address, signature });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, "nonce_invalid");
});

test("auth rejects malformed addresses, bad signatures, and tampered JWTs", async () => {
  const h = await makeHarness();
  const wallet = Wallet.createRandom();

  const malformed = await request(h.app).post("/auth/nonce").send({ address: "not-an-address" });
  assert.equal(malformed.status, 422);

  const nonce = await request(h.app).post("/auth/nonce").send({ address: wallet.address });
  const other = Wallet.createRandom();
  const badSignature = await other.signMessage(nonce.body.message);
  const bad = await request(h.app)
    .post("/auth/verify")
    .send({ address: wallet.address, signature: badSignature });
  assert.equal(bad.status, 401);

  const goodSignature = await wallet.signMessage(nonce.body.message);
  const good = await request(h.app)
    .post("/auth/verify")
    .send({ address: wallet.address, signature: goodSignature });
  assert.equal(good.status, 200);

  const noToken = await request(h.app).get("/profiles/me");
  assert.equal(noToken.status, 401);

  const tampered = good.body.token.slice(0, -2) + "xx";
  const rejected = await request(h.app)
    .get("/profiles/me")
    .set("Authorization", `Bearer ${tampered}`);
  assert.equal(rejected.status, 401);
});

test("profile binds a wallet to a SteamID64 and can be updated", async () => {
  const h = await makeHarness();
  const auth = { Authorization: `Bearer ${h.sellerToken}` };

  const missing = await request(h.app).get("/profiles/me").set(auth);
  assert.equal(missing.status, 404);

  const saved = await request(h.app)
    .post("/profiles/me")
    .set(auth)
    .send({ steamId64: "76561198000000001" });
  assert.equal(saved.status, 200);

  const loaded = await request(h.app).get("/profiles/me").set(auth);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.steamId64, "76561198000000001");

  const invalid = await request(h.app)
    .post("/profiles/me")
    .set(auth)
    .send({ steamId64: "123" });
  assert.equal(invalid.status, 422);
});
