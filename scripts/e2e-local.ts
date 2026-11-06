/**
 * SkinPact S2-mini local E2E (P1–P8).
 *
 * Spawns a throwaway Hardhat node, deploys SkinPactMarket, runs the real Relay
 * app in-process with an in-memory SQLite DB, and exercises the contract + Relay
 * boundaries. Steam is NOT contacted: helper offer/accepted reports are mocked
 * here and clearly labelled. A real Steam offer is a separate manual exit check.
 *
 * The buyer Trade URL token used here is synthetic. It is never printed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  keccak256,
  parseEther,
  toUtf8Bytes,
  type JsonRpcSigner,
} from "ethers";
import { ListingStatus, STEAMID64_BASE, type ItemMetadata } from "@skinpact/shared";
import { createApp, cleanupTerminalBuyerUrls } from "../relay/src/app.js";
import { createDb } from "../relay/src/db.js";
import { EthersChain } from "../relay/src/chain.js";
import type { InventoryProvider } from "../relay/src/inventory.js";
import type { RelayConfig } from "../relay/src/config.js";

const SELLER_STEAM_ID = "76561198000000001";
const BUYER_STEAM_ID = "76561198000000002";
const ROLES = ["seller", "buyer", "outsider"] as const;
const PRICE = {
  p1: parseEther("0.02"),
  p2: parseEther("0.03"),
  p3: parseEther("0.04"),
};
const FAKE_ITEMS = [
  { assetId: "910000000001", classId: "9100001", instanceId: "91000001", marketHashName: "E2E Test Skin Alpha" },
  { assetId: "910000000002", classId: "9100002", instanceId: "91000002", marketHashName: "E2E Test Skin Beta" },
  { assetId: "910000000003", classId: "9100003", instanceId: "91000003", marketHashName: "E2E Test Skin Gamma" },
];
const OFFER_WINDOW = 600;
const CHALLENGE_WINDOW = 300;
const DELIVERY_WINDOW = 3_600;

let checks = 0;
function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  checks += 1;
}
function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  checks += 1;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForRpc(provider: JsonRpcProvider, child: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      if (child()) throw new Error(`Hardhat node exited early:\n${child()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Hardhat node did not become ready. Logs:\n${child()}`);
}

interface ApiResult {
  status: number;
  body: any;
  headers: Headers;
}

async function main(): Promise<void> {
  const hardhatBinary = path.resolve("node_modules/.bin/hardhat");
  const contractsDir = path.resolve("contracts");
  const artifactPath = path.resolve(
    "contracts/artifacts/contracts/SkinPactMarket.sol/SkinPactMarket.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: any[];
    bytecode: string;
  };

  const port = await getFreePort();
  let nodeLogs = "";
  const hardhat = spawn(hardhatBinary, ["node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: contractsDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" },
  });
  hardhat.stdout.on("data", (chunk) => {
    nodeLogs = `${nodeLogs}${chunk}`.slice(-20_000);
  });
  hardhat.stderr.on("data", (chunk) => {
    nodeLogs = `${nodeLogs}${chunk}`.slice(-20_000);
  });

  const rpcUrl = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  let server: Server | null = null;
  let db: ReturnType<typeof createDb> | null = null;

  try {
    await waitForRpc(provider, () => (hardhat.exitCode === null ? "" : nodeLogs));

    const seller = await provider.getSigner(0);
    const buyer = await provider.getSigner(1);
    const outsider = await provider.getSigner(2);
    const arbiter = await provider.getSigner(3);
    const signers = new Map<string, JsonRpcSigner>([
      ["seller", seller],
      ["buyer", buyer],
      ["outsider", outsider],
      ["arbiter", arbiter],
    ]);
    const addresses = new Map<string, string>([
      ["seller", await seller.getAddress()],
      ["buyer", await buyer.getAddress()],
      ["outsider", await outsider.getAddress()],
      ["arbiter", await arbiter.getAddress()],
    ]);

    const factory = new ContractFactory(artifact.abi, artifact.bytecode, seller);
    // Artifact ABI is dynamic; use a loose handle for method calls.
    const market: any = await factory.deploy(
      parseEther("0.1"),
      parseEther("0.001"),
      OFFER_WINDOW,
      CHALLENGE_WINDOW,
      DELIVERY_WINDOW,
      await arbiter.getAddress(),
    );
    await market.waitForDeployment();
    const marketAddress = await market.getAddress();
    ok(/^0x[0-9a-fA-F]{40}$/.test(marketAddress), "contract deployed");
    equal(Number(await provider.getNetwork().then((n) => n.chainId)), 31337, "chain is 31337");

    const inventory: InventoryProvider = {
      async getInventory(steamId64: string) {
        return steamId64 === SELLER_STEAM_ID ? FAKE_ITEMS : [];
      },
    };
    const config: RelayConfig = {
      port: 0,
      rpcUrl,
      contractAddress: marketAddress,
      chainId: 31337,
      deploymentBlock: 0,
      dbPath: ":memory:",
      encryptionKey: randomBytes(32),
      jwtSecret: randomBytes(32).toString("hex"),
      webOrigin: "http://localhost:5173",
      pairingCodeTtlMs: 300_000,
      helperTokenTtlMs: 28_800_000,
      nonceTtlMs: 300_000,
    };
    db = createDb(":memory:");
    const chain = new EthersChain(provider, marketAddress, 0);
    const app = createApp({ db, chain, inventory, config });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const relayPort = (server.address() as AddressInfo).port;
    const relayUrl = `http://127.0.0.1:${relayPort}`;

    async function api(
      method: "GET" | "POST" | "PUT",
      endpoint: string,
      options: { token?: string; body?: unknown } = {},
    ): Promise<ApiResult> {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      const response = await fetch(`${relayUrl}${endpoint}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: response.status, body, headers: response.headers };
    }

    async function expectError(
      result: ApiResult,
      status: number,
      code: string,
      label: string,
    ): Promise<void> {
      equal(result.status, status, `${label}: HTTP status`);
      equal(result.body?.error, code, `${label}: error code`);
    }

    async function expectRevert(action: () => Promise<unknown>, label: string): Promise<void> {
      let reverted = false;
      try {
        await action();
      } catch {
        reverted = true;
      }
      ok(reverted, label);
    }

    async function login(who: (typeof ROLES)[number]): Promise<string> {
      const address = addresses.get(who)!;
      const signer = signers.get(who)!;
      const nonce = await api("POST", "/auth/nonce", { body: { address } });
      equal(nonce.status, 200, `${who} nonce issued`);
      const signature = await signer.signMessage(String(nonce.body.message));
      const verified = await api("POST", "/auth/verify", { body: { address, signature } });
      equal(verified.status, 200, `${who} Relay login`);
      ok(typeof verified.body.token === "string" && verified.body.token.length > 20, `${who} JWT`);
      return String(verified.body.token);
    }

    async function advance(seconds: number): Promise<void> {
      await provider.send("evm_increaseTime", [seconds]);
      await provider.send("evm_mine", []);
    }

    const partner = (BigInt(BUYER_STEAM_ID) - STEAMID64_BASE).toString();
    function buyerUrlFor(tag: string): string {
      return `https://steamcommunity.com/tradeoffer/new/?partner=${partner}&token=e2e_secret_${tag}`;
    }

    const sellerToken = await login("seller");
    const buyerToken = await login("buyer");
    const outsiderToken = await login("outsider");
    const profile = await api("POST", "/profiles/me", {
      token: sellerToken,
      body: { steamId64: SELLER_STEAM_ID },
    });
    equal(profile.status, 200, "seller SteamID64 bound");

    async function prepare(assetId: string): Promise<ItemMetadata & { itemHash: string }> {
      const prepared = await api("POST", "/items/prepare", {
        token: sellerToken,
        body: { steamId64: SELLER_STEAM_ID, assetId },
      });
      equal(prepared.status, 200, `prepared item ${assetId}`);
      const raw = await api("GET", `/metadata/${prepared.body.itemHash}`);
      equal(raw.status, 200, "metadata stored");
      return { ...raw.body, itemHash: prepared.body.itemHash };
    }

    async function createListing(
      itemHash: string,
      price: bigint,
      sellerSigner: JsonRpcSigner,
    ): Promise<{ id: bigint; bond: bigint }> {
      const bond = BigInt(await market.quoteBond(price));
      const tx = await market
        .connect(sellerSigner)
        .createListing(itemHash, price, { value: bond });
      await tx.wait();
      const id = BigInt(await market.nextListingId()) - 1n;
      return { id, bond };
    }

    async function statusOf(id: bigint): Promise<number> {
      const listing = await market.getListing(id);
      return Number(listing.status);
    }

    async function withdrawableOf(address: string): Promise<bigint> {
      return BigInt(await market.withdrawable(address));
    }

    // Pair the seller's local helper (mocked Steam transport).
    const sellerPairing = await api("POST", "/helper/pairing-code", { token: sellerToken });
    equal(sellerPairing.status, 200, "seller pairing code issued");
    const sellerHelper = await api("POST", "/helper/pair", {
      body: { code: sellerPairing.body.code },
    });
    equal(sellerHelper.status, 200, "seller helper paired");
    const helperToken = String(sellerHelper.body.token);

    const outsiderPairing = await api("POST", "/helper/pairing-code", { token: outsiderToken });
    equal(outsiderPairing.status, 200, "outsider pairing code issued");
    const outsiderHelper = await api("POST", "/helper/pair", {
      body: { code: outsiderPairing.body.code },
    });
    equal(outsiderHelper.status, 200, "outsider helper paired");
    const outsiderHelperToken = String(outsiderHelper.body.token);

    // ---------------------------------------------------------------------
    // P1: buyer confirms after helper/mock offer + seller mark.
    // ---------------------------------------------------------------------
    const item1 = await prepare(FAKE_ITEMS[0]!.assetId);
    const p1 = await createListing(item1.itemHash, PRICE.p1, seller);
    const url1 = buyerUrlFor("p1");
    const url1Put = await api("PUT", `/listings/${p1.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: url1 },
    });
    equal(url1Put.status, 200, "P1 buyer URL accepted while Active");
    equal(url1Put.body.buyerSteamId, BUYER_STEAM_ID, "P1 URL buyer SteamID parsed");
    equal(url1Put.headers.get("cache-control"), "no-store", "P1 URL response is no-store");

    // P4: no reveal while Active.
    const activeReveal = await api("GET", `/listings/${p1.id}/buyer-trade-url`, {
      token: sellerToken,
    });
    await expectError(activeReveal, 409, "buyer_trade_url_not_available", "P4 active reveal refused");

    const buy1 = await market.connect(buyer).buy(p1.id, { value: PRICE.p1 });
    await buy1.wait();
    equal(await statusOf(p1.id), ListingStatus.Funded, "P1 funded");
    equal(await withdrawableOf(addresses.get("seller")!), 0n, "P1 no payout at Funded");

    // P4: seller-only reveal after Funded; outsider and helper scope.
    const sellerReveal = await api("GET", `/listings/${p1.id}/buyer-trade-url`, {
      token: sellerToken,
    });
    equal(sellerReveal.status, 200, "P4 seller reveals URL after Funded");
    equal(sellerReveal.body.tradeUrl, url1, "P4 revealed URL is correct");
    equal(sellerReveal.headers.get("cache-control"), "no-store", "P4 reveal is no-store");

    const outsiderReveal = await api("GET", `/listings/${p1.id}/buyer-trade-url`, {
      token: outsiderToken,
    });
    await expectError(outsiderReveal, 403, "not_seller", "P4 outsider reveal refused");

    const sellerOrders = await api("GET", "/helper/orders", { token: helperToken });
    equal(sellerOrders.status, 200, "P4 seller helper orders");
    equal(sellerOrders.body.orders.length, 1, "P4 seller helper sees funded order");
    equal(sellerOrders.body.orders[0].buyerTradeUrl, url1, "P4 helper receives URL (authorized)");

    const outsiderOrders = await api("GET", "/helper/orders", { token: outsiderHelperToken });
    equal(outsiderOrders.status, 200, "P4 outsider helper orders");
    equal(outsiderOrders.body.orders.length, 0, "P4 outsider helper sees no orders");

    const metadata1 = await api("GET", `/metadata/${item1.itemHash}`);
    equal(metadata1.status, 200, "P4 metadata readable");
    ok(!JSON.stringify(metadata1.body).includes("e2e_secret_p1"), "P4 metadata has no URL token");

    const cipherRows = db!
      .prepare("SELECT listing_id, buyer_address, ciphertext, iv, tag FROM buyer_urls")
      .all();
    ok(!JSON.stringify(cipherRows).includes("e2e_secret_p1"), "P4 DB ciphertext has no URL token");
    ok(cipherRows.length >= 1, "P4 buyer URL row exists encrypted");

    // Mock helper: send offer report (Steam is not contacted in E2E).
    const offer1 = await api("POST", `/helper/listings/${p1.id}/offer`, {
      token: helperToken,
      body: { tradeOfferId: "950000000000000001" },
    });
    equal(offer1.status, 200, "P1 mock offer reported");
    const mark1 = await market
      .connect(seller)
      .markOfferSent(p1.id, String(offer1.body.offerIdHash));
    await mark1.wait();
    equal(await statusOf(p1.id), ListingStatus.OfferSent, "P1 offer marked");
    equal(await withdrawableOf(addresses.get("seller")!), 0n, "P1 mark does not pay seller");

    const confirm1 = await market.connect(buyer).confirmReceipt(p1.id);
    await confirm1.wait();
    equal(await statusOf(p1.id), ListingStatus.Completed, "P1 completed by buyer");
    equal(
      await withdrawableOf(addresses.get("seller")!),
      PRICE.p1 + p1.bond,
      "P1 seller withdrawable = price + bond",
    );

    const removed1 = await cleanupTerminalBuyerUrls(db!, chain);
    ok(removed1 >= 1, "P1 terminal buyer URL cleanup ran");
    equal(
      (db!.prepare("SELECT COUNT(*) AS n FROM buyer_urls WHERE listing_id = ?").get(String(p1.id)) as { n: number }).n,
      0,
      "P1 terminal buyer URL row deleted",
    );

    // ---------------------------------------------------------------------
    // P2: helper evidence -> seller claim -> challenge -> permissionless finalize.
    // ---------------------------------------------------------------------
    const item2 = await prepare(FAKE_ITEMS[1]!.assetId);
    const p2 = await createListing(item2.itemHash, PRICE.p2, seller);
    await (await market.connect(buyer).buy(p2.id, { value: PRICE.p2 })).wait();
    const url2Put = await api("PUT", `/listings/${p2.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: buyerUrlFor("p2") },
    });
    equal(url2Put.status, 200, "P2 buyer URL stored while Funded");
    const offer2 = await api("POST", `/helper/listings/${p2.id}/offer`, {
      token: helperToken,
      body: { tradeOfferId: "950000000000000002" },
    });
    equal(offer2.status, 200, "P2 mock offer reported");
    await (await market.connect(seller).markOfferSent(p2.id, String(offer2.body.offerIdHash))).wait();
    equal(await statusOf(p2.id), ListingStatus.OfferSent, "P2 offer marked");

    await expectRevert(
      () => market.connect(outsider).expireOrder.staticCall(p2.id),
      "P3 guard: OfferSent cannot expire",
    );

    const accepted2 = await api("POST", `/helper/listings/${p2.id}/accepted`, {
      token: helperToken,
      body: {
        tradeOfferId: "950000000000000002",
        observedAt: new Date().toISOString(),
      },
    });
    equal(accepted2.status, 200, "P2 Accepted(3) evidence stored");
    ok(/^0x[0-9a-f]{64}$/i.test(String(accepted2.body.evidenceHash)), "P2 evidence hash returned");

    const claim2 = await market
      .connect(seller)
      .claimAccepted(p2.id, String(accepted2.body.evidenceHash));
    await claim2.wait();
    equal(await statusOf(p2.id), ListingStatus.ClaimPending, "P2 claim pending");
    equal(await withdrawableOf(addresses.get("seller")!), PRICE.p1 + p1.bond, "P2 no payout before challenge");

    const report2 = await api("GET", `/listings/${p2.id}/report`, { token: sellerToken });
    equal(report2.status, 200, "P2 seller report readable");
    ok(!JSON.stringify(report2.body).includes("e2e_secret_p2"), "P4 report has no buyer URL token");
    equal(report2.headers.get("cache-control"), "no-store", "P4 report is no-store");

    await expectRevert(
      () => market.connect(outsider).finalizeClaim.staticCall(p2.id),
      "P2 finalize reverts before challenge ends",
    );

    await advance(CHALLENGE_WINDOW + 1);
    await (await market.connect(outsider).finalizeClaim(p2.id)).wait();
    equal(await statusOf(p2.id), ListingStatus.Completed, "P2 permissionless finalize completed");
    equal(
      await withdrawableOf(addresses.get("seller")!),
      PRICE.p1 + p1.bond + PRICE.p2 + p2.bond,
      "P2 seller withdrawable credited",
    );
    await cleanupTerminalBuyerUrls(db!, chain);

    // ---------------------------------------------------------------------
    // P3: no offer -> expire after deadline -> both sides refund in pull payments.
    // ---------------------------------------------------------------------
    const item3 = await prepare(FAKE_ITEMS[2]!.assetId);
    const p3 = await createListing(item3.itemHash, PRICE.p3, seller);
    const p3Url = buyerUrlFor("p3");
    await api("PUT", `/listings/${p3.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: p3Url },
    });
    await (await market.connect(buyer).buy(p3.id, { value: PRICE.p3 })).wait();
    equal(await statusOf(p3.id), ListingStatus.Funded, "P3 funded without offer");

    await advance(OFFER_WINDOW + 1);
    await (await market.connect(outsider).expireOrder(p3.id)).wait();
    equal(await statusOf(p3.id), ListingStatus.Refunded, "P3 permissionless expire refunded");
    equal(await withdrawableOf(addresses.get("buyer")!), PRICE.p3, "P3 buyer price refunded");
    equal(
      await withdrawableOf(addresses.get("seller")!),
      PRICE.p1 + p1.bond + PRICE.p2 + p2.bond + p3.bond,
      "P3 seller bond refunded",
    );

    await expectRevert(
      () => market.connect(outsider).expireOrder.staticCall(p3.id),
      "P3 cannot expire a Refunded listing again",
    );

    await cleanupTerminalBuyerUrls(db!, chain);
    equal(
      (db!.prepare("SELECT COUNT(*) AS n FROM buyer_urls").get() as { n: number }).n,
      0,
      "P3 all terminal buyer URLs cleaned",
    );

    // ---------------------------------------------------------------------
    // P5: seller cancels an unsold Active listing and recovers the bond.
    // ---------------------------------------------------------------------
    const item5 = await prepare(FAKE_ITEMS[0]!.assetId);
    const sellerBefore5 = await withdrawableOf(addresses.get("seller")!);
    const p5 = await createListing(item5.itemHash, PRICE.p1, seller);
    await (await market.connect(seller).cancelListing(p5.id)).wait();
    equal(await statusOf(p5.id), ListingStatus.Cancelled, "P5 active listing cancelled");
    equal(
      await withdrawableOf(addresses.get("seller")!),
      sellerBefore5 + p5.bond,
      "P5 seller bond refunded",
    );
    await expectRevert(
      () => market.connect(seller).cancelListing.staticCall(p5.id),
      "P5 cannot cancel twice",
    );

    // ---------------------------------------------------------------------
    // P6: buyer disputes from OfferSent; arbiter refunds price, bond stays seller.
    // ---------------------------------------------------------------------
    const item6 = await prepare(FAKE_ITEMS[1]!.assetId);
    const p6 = await createListing(item6.itemHash, PRICE.p2, seller);
    await api("PUT", `/listings/${p6.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: buyerUrlFor("p6") },
    });
    await (await market.connect(buyer).buy(p6.id, { value: PRICE.p2 })).wait();
    const offer6 = await api("POST", `/helper/listings/${p6.id}/offer`, {
      token: helperToken,
      body: { tradeOfferId: "950000000000000006" },
    });
    equal(offer6.status, 200, "P6 mock offer reported");
    await (
      await market.connect(seller).markOfferSent(p6.id, String(offer6.body.offerIdHash))
    ).wait();
    const buyerBefore6 = await withdrawableOf(addresses.get("buyer")!);
    const sellerBefore6 = await withdrawableOf(addresses.get("seller")!);
    await (
      await market
        .connect(buyer)
        .openDispute(p6.id, keccak256(toUtf8Bytes("P6 buyer dispute: no delivery")))
    ).wait();
    equal(await statusOf(p6.id), ListingStatus.Disputed, "P6 buyer dispute opened");
    equal(
      await withdrawableOf(addresses.get("buyer")!),
      buyerBefore6,
      "P6 no payout while disputed",
    );
    await (await market.connect(arbiter).resolveDispute(p6.id, false, false)).wait();
    equal(await statusOf(p6.id), ListingStatus.Refunded, "P6 arbiter refunded");
    equal(
      await withdrawableOf(addresses.get("buyer")!),
      buyerBefore6 + PRICE.p2,
      "P6 buyer price refunded",
    );
    equal(
      await withdrawableOf(addresses.get("seller")!),
      sellerBefore6 + p6.bond,
      "P6 seller bond returned",
    );

    // ---------------------------------------------------------------------
    // P7: buyer disputes a ClaimPending claim; arbiter rules for the seller.
    // ---------------------------------------------------------------------
    const item7 = await prepare(FAKE_ITEMS[2]!.assetId);
    const p7 = await createListing(item7.itemHash, PRICE.p3, seller);
    await api("PUT", `/listings/${p7.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: buyerUrlFor("p7") },
    });
    await (await market.connect(buyer).buy(p7.id, { value: PRICE.p3 })).wait();
    const offer7 = await api("POST", `/helper/listings/${p7.id}/offer`, {
      token: helperToken,
      body: { tradeOfferId: "950000000000000007" },
    });
    equal(offer7.status, 200, "P7 mock offer reported");
    await (
      await market.connect(seller).markOfferSent(p7.id, String(offer7.body.offerIdHash))
    ).wait();
    const accepted7 = await api("POST", `/helper/listings/${p7.id}/accepted`, {
      token: helperToken,
      body: {
        tradeOfferId: "950000000000000007",
        observedAt: new Date().toISOString(),
      },
    });
    equal(accepted7.status, 200, "P7 Accepted(3) evidence stored");
    await (
      await market.connect(seller).claimAccepted(p7.id, String(accepted7.body.evidenceHash))
    ).wait();
    equal(await statusOf(p7.id), ListingStatus.ClaimPending, "P7 claim pending");
    const sellerBefore7 = await withdrawableOf(addresses.get("seller")!);
    await (
      await market
        .connect(buyer)
        .openDispute(p7.id, keccak256(toUtf8Bytes("P7 buyer disputes seller claim")))
    ).wait();
    equal(await statusOf(p7.id), ListingStatus.Disputed, "P7 claim dispute opened");
    await (await market.connect(arbiter).resolveDispute(p7.id, true, false)).wait();
    equal(await statusOf(p7.id), ListingStatus.Completed, "P7 arbiter paid seller");
    equal(
      await withdrawableOf(addresses.get("seller")!),
      sellerBefore7 + PRICE.p3 + p7.bond,
      "P7 seller paid price + bond",
    );

    // ---------------------------------------------------------------------
    // P8: seller disputes from OfferSent; arbiter refunds buyer and slashes bond.
    // ---------------------------------------------------------------------
    const item8 = await prepare(FAKE_ITEMS[0]!.assetId);
    const p8 = await createListing(item8.itemHash, PRICE.p1, seller);
    await api("PUT", `/listings/${p8.id}/buyer-trade-url`, {
      token: buyerToken,
      body: { tradeUrl: buyerUrlFor("p8") },
    });
    await (await market.connect(buyer).buy(p8.id, { value: PRICE.p1 })).wait();
    const offer8 = await api("POST", `/helper/listings/${p8.id}/offer`, {
      token: helperToken,
      body: { tradeOfferId: "950000000000000008" },
    });
    equal(offer8.status, 200, "P8 mock offer reported");
    await (
      await market.connect(seller).markOfferSent(p8.id, String(offer8.body.offerIdHash))
    ).wait();
    const buyerBefore8 = await withdrawableOf(addresses.get("buyer")!);
    await (
      await market
        .connect(seller)
        .openDispute(p8.id, keccak256(toUtf8Bytes("P8 seller cannot deliver")))
    ).wait();
    equal(await statusOf(p8.id), ListingStatus.Disputed, "P8 seller dispute opened");
    await (await market.connect(arbiter).resolveDispute(p8.id, false, true)).wait();
    equal(await statusOf(p8.id), ListingStatus.Refunded, "P8 arbiter refunded buyer");
    equal(
      await withdrawableOf(addresses.get("buyer")!),
      buyerBefore8 + PRICE.p1 + p8.bond,
      "P8 buyer receives price + slashed bond",
    );

    await cleanupTerminalBuyerUrls(db!, chain);
    equal(
      (db!.prepare("SELECT COUNT(*) AS n FROM buyer_urls").get() as { n: number }).n,
      0,
      "P5–P8 all terminal buyer URLs cleaned",
    );

    // The synthetic URL never appears in the stored identity columns either.
    const allRows = JSON.stringify(
      db!.prepare("SELECT * FROM buyer_urls").all(),
    ) + JSON.stringify(db!.prepare("SELECT * FROM evidence").all());
    ok(!allRows.includes("e2e_secret_"), "P4 no buyer URL token in stored DB rows");

    console.log("\nSkinPact S2-mini local E2E (P1–P8): PASS");
    console.log(`  checks: ${checks}`);
    console.log("  Steam transport: MOCKED in E2E (helper offer/accepted reports), not a real delivery");
    console.log("  P1 buyer confirm → Completed + withdrawable price+bond");
    console.log("  P2 seller claim → ClaimPending → challenge → permissionless finalize");
    console.log("  P3 no-offer expire after deadline → Refunded + both pull payments");
    console.log("  P4 Buyer URL: encrypted, seller-only after Funded, scoped helper, no token in API/DB, deleted on terminal");
    console.log("  P5 seller cancel Active → Cancelled + bond refund");
    console.log("  P6 OfferSent buyer dispute → arbiter buyer wins → Refunded (bond returns to seller)");
    console.log("  P7 ClaimPending buyer dispute → arbiter seller wins → Completed");
    console.log("  P8 OfferSent seller dispute → arbiter buyer wins + bond slashed → Refunded");
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    if (db) db.close();
    if (hardhat.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          hardhat.kill("SIGKILL");
          resolve();
        }, 5_000);
        hardhat.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        hardhat.kill("SIGINT");
      });
    }
  }
}

main().catch((error) => {
  console.error("\nSkinPact S2-mini local E2E: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
