import crypto from "node:crypto";
import { Wallet, type HDNodeWallet } from "ethers";
import request from "supertest";
import type { Listing } from "@skinpact/shared";
import { ListingStatus } from "@skinpact/shared";
import type { ChainReader } from "../src/chain.js";
import type { InventoryProvider, SteamItem } from "../src/inventory.js";
import type { RelayConfig } from "../src/config.js";
import { createDb, type DB } from "../src/db.js";
import { createApp } from "../src/app.js";

export const SELLER_STEAM_ID = "76561198000000001";
export const BUYER_STEAM_ID = "76561198000000002";
export const ITEM: SteamItem = {
  assetId: "12345678901",
  classId: "987654321",
  instanceId: "188530139",
  marketHashName: "AK-47 | Redline (Field-Tested)",
  imageUrl: "https://example.invalid/item.png",
};

export class FakeChain implements ChainReader {
  public listings = new Map<string, Listing>();
  public failListings = new Set<string>();

  add(listingId: string, overrides: Partial<Listing> = {}): Listing {
    const listing: Listing = {
      seller: "0x0000000000000000000000000000000000000001",
      buyer: "0x0000000000000000000000000000000000000002",
      price: 10_000_000_000_000_000n,
      bond: 1_000_000_000_000_000n,
      itemHash: "0x" + "11".repeat(32),
      offerIdHash: "0x" + "00".repeat(32),
      evidenceHash: "0x" + "00".repeat(32),
      offerDeadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      challengeDeadline: 0n,
      status: ListingStatus.Active,
      ...overrides,
    };
    this.listings.set(listingId, listing);
    return listing;
  }

  async getListing(listingId: string): Promise<Listing> {
    const listing = this.listings.get(listingId);
    if (this.failListings.has(listingId)) throw new Error("rpc unavailable");
    if (!listing) {
      return {
        seller: "0x0000000000000000000000000000000000000000",
        buyer: "0x0000000000000000000000000000000000000000",
        price: 0n,
        bond: 0n,
        itemHash: "0x" + "00".repeat(32),
        offerIdHash: "0x" + "00".repeat(32),
        evidenceHash: "0x" + "00".repeat(32),
        offerDeadline: 0n,
        challengeDeadline: 0n,
        status: ListingStatus.None,
      };
    }
    return { ...listing };
  }

  async findFundedBySeller(seller: string): Promise<Array<{ listingId: string; listing: Listing }>> {
    return [...this.listings.entries()]
      .filter(
        ([, listing]) =>
          listing.status === ListingStatus.Funded &&
          listing.seller.toLowerCase() === seller.toLowerCase(),
      )
      .map(([listingId, listing]) => ({ listingId, listing: { ...listing } }));
  }
}

export class FakeInventory implements InventoryProvider {
  public items: SteamItem[] = [];
  public fail = false;

  async getInventory(_steamId64: string): Promise<SteamItem[]> {
    if (this.fail) throw new Error("steam unavailable");
    return this.items.map((item) => ({ ...item }));
  }
}

export function testConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    port: 0,
    rpcUrl: "http://127.0.0.1:8545",
    contractAddress: "0x" + "aa".repeat(20),
    chainId: 31337,
    deploymentBlock: 0,
    dbPath: ":memory:",
    encryptionKey: crypto.createHash("sha256").update("relay-test-key").digest(),
    jwtSecret: "relay-test-jwt-secret-0123456789",
    webOrigin: "http://localhost:5173",
    pairingCodeTtlMs: 300_000,
    helperTokenTtlMs: 28_800_000,
    nonceTtlMs: 300_000,
    ...overrides,
  };
}

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  db: DB;
  chain: FakeChain;
  inventory: FakeInventory;
  config: RelayConfig;
  seller: HDNodeWallet;
  buyer: HDNodeWallet;
  sellerToken: string;
  buyerToken: string;
}

export async function login(app: ReturnType<typeof createApp>, wallet: HDNodeWallet): Promise<string> {
  const nonceResponse = await request(app).post("/auth/nonce").send({ address: wallet.address });
  if (nonceResponse.status !== 200) throw new Error("nonce failed");
  const signature = await wallet.signMessage(nonceResponse.body.message);
  const verifyResponse = await request(app)
    .post("/auth/verify")
    .send({ address: wallet.address, signature });
  if (verifyResponse.status !== 200) throw new Error("verify failed");
  return verifyResponse.body.token as string;
}

export async function makeHarness(): Promise<TestHarness> {
  const db = createDb(":memory:");
  const chain = new FakeChain();
  const inventory = new FakeInventory();
  inventory.items = [ITEM];
  const config = testConfig();
  const app = createApp({ db, chain, inventory, config });
  const seller = Wallet.createRandom();
  const buyer = Wallet.createRandom();
  const sellerToken = await login(app, seller);
  const buyerToken = await login(app, buyer);
  return { app, db, chain, inventory, config, seller, buyer, sellerToken, buyerToken };
}
