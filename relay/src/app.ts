import type { NextFunction, Request, Response } from "express";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { verifyMessage } from "ethers";
import {
  ListingStatus,
  itemHash,
  offerIdHash,
  evidenceHash,
  parseTradeUrl,
  type ItemMetadata,
  type OfferEvidence,
} from "@skinpact/shared";
import type { RelayConfig } from "./config.js";
import type { DB } from "./db.js";
import {
  decryptString,
  encryptString,
  isFresh,
  randomNonce,
  randomPairingCode,
  randomToken,
  sha256Hex,
} from "./crypto.js";
import type { ChainReader } from "./chain.js";
import type { InventoryProvider, SteamItem } from "./inventory.js";
import { findInventoryItem } from "./inventory.js";
import {
  HttpError,
  asyncHandler,
  bearer,
  noStore,
  normalizeAddress,
  requireDigits,
  requireListingId,
  requireSteamId64,
  requireString,
} from "./http.js";

export interface AppDeps {
  db: DB;
  chain: ChainReader;
  inventory: InventoryProvider;
  config: RelayConfig;
  now?: () => number;
}

interface AuthContext {
  address: string;
  seller: string;
  via: "jwt" | "helper";
}

type AuthedRequest = Request & {
  auth?: { address: string };
  helper?: { seller: string };
  access?: AuthContext;
};

interface ProfileRow {
  address: string;
  steam_id: string;
  created_at: number;
  updated_at: number;
}

interface MetadataRow {
  item_hash: string;
  seller_address: string;
  seller_steam_id: string;
  asset_id: string;
  class_id: string;
  instance_id: string;
  market_hash_name: string;
  inspect_link: string | null;
  image_url: string | null;
  verified: number;
  created_at: number;
}

interface BuyerUrlRow {
  listing_id: string;
  buyer_address: string;
  buyer_steam_id: string;
  ciphertext: string;
  iv: string;
  tag: string;
  created_at: number;
  updated_at: number;
  revealed_at: number | null;
}

interface OfferRow {
  listing_id: string;
  seller_address: string;
  trade_offer_id: string;
  offer_id_hash: string;
  created_at: number;
}

interface EvidenceRow {
  listing_id: string;
  seller_address: string;
  evidence_hash: string;
  ciphertext: string;
  iv: string;
  tag: string;
  observed_at: string;
  created_at: number;
}

const JWT_TTL_SECONDS = 60 * 60;

function nonceMessage(address: string, chainId: number, nonce: string): string {
  return [
    "SkinPact Relay login",
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function signJwt(config: RelayConfig, address: string): string {
  return jwt.sign({ sub: address }, config.jwtSecret, {
    expiresIn: JWT_TTL_SECONDS,
    issuer: "skinpact-relay",
  });
}

function readJwt(req: Request, config: RelayConfig): string {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "auth_required");
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payload.sub)) {
      throw new Error("invalid sub");
    }
    return payload.sub.toLowerCase();
  } catch {
    throw new HttpError(401, "auth_invalid");
  }
}

function metadataToItem(row: MetadataRow): ItemMetadata {
  return {
    sellerSteamId: row.seller_steam_id,
    assetId: row.asset_id,
    classId: row.class_id,
    instanceId: row.instance_id,
    marketHashName: row.market_hash_name,
    ...(row.inspect_link ? { inspectLink: row.inspect_link } : {}),
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
  };
}

function publicMetadata(row: MetadataRow) {
  return {
    itemHash: row.item_hash,
    seller: row.seller_address,
    assetId: row.asset_id,
    classId: row.class_id,
    instanceId: row.instance_id,
    marketHashName: row.market_hash_name,
    ...(row.inspect_link ? { inspectLink: row.inspect_link } : {}),
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    verified: Boolean(row.verified),
  };
}

function itemFromInventory(item: SteamItem, sellerSteamId: string): ItemMetadata {
  return {
    sellerSteamId,
    assetId: item.assetId,
    classId: item.classId,
    instanceId: item.instanceId,
    marketHashName: item.marketHashName,
    ...(item.inspectLink ? { inspectLink: item.inspectLink } : {}),
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(504, "steam_inventory_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= max) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    bucket.count += 1;
    next();
  };
}

export function createApp(deps: AppDeps): express.Express {
  const { db, chain, inventory, config } = deps;
  const now = deps.now ?? (() => Date.now());
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(cors({ origin: config.webOrigin }));
  app.use(express.json({ limit: "256kb" }));

  const authRateLimit = rateLimiter(30, 60_000);
  const pairRateLimit = rateLimiter(10, 60_000);
  const inventoryRateLimit = rateLimiter(60, 60_000);

  function requireAuth(req: Request): string {
    const address = readJwt(req, config);
    (req as AuthedRequest).auth = { address };
    return address;
  }

  function requireHelper(req: Request): string {
    const token = bearer(req);
    if (!token || !token.startsWith("sp_helper_")) throw new HttpError(401, "helper_auth_required");
    const row = db
      .prepare("SELECT seller_address, expires_at FROM helper_sessions WHERE token_hash = ?")
      .get(sha256Hex(token)) as { seller_address: string; expires_at: number } | undefined;
    if (!row || !isFresh(row.expires_at, now())) {
      throw new HttpError(401, "helper_auth_invalid");
    }
    const seller = row.seller_address;
    (req as AuthedRequest).helper = { seller };
    return seller;
  }

  function requireReportAccess(req: Request): AuthContext {
    const token = bearer(req);
    if (token?.startsWith("sp_helper_")) {
      const seller = requireHelper(req);
      return { address: seller, seller, via: "helper" };
    }
    const address = requireAuth(req);
    return { address, seller: address, via: "jwt" };
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, chainId: config.chainId });
  });

  app.post(
    "/auth/nonce",
    authRateLimit,
    asyncHandler(async (req, res) => {
      const address = normalizeAddress(req.body?.address);
      const nonce = randomNonce();
      const expiresAt = now() + config.nonceTtlMs;
      db.prepare(
        `INSERT INTO nonces (address, nonce, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at`,
      ).run(address, nonce, expiresAt);
      res.json({
        address,
        nonce,
        message: nonceMessage(address, config.chainId, nonce),
        expiresAt,
      });
    }),
  );

  app.post(
    "/auth/verify",
    authRateLimit,
    asyncHandler(async (req, res) => {
      const address = normalizeAddress(req.body?.address);
      const signature = requireString(req.body?.signature, "signature", 4096);
      const row = db
        .prepare("SELECT nonce, expires_at FROM nonces WHERE address = ?")
        .get(address) as { nonce: string; expires_at: number } | undefined;
      if (!row || !isFresh(row.expires_at, now())) throw new HttpError(401, "nonce_invalid");

      let signer: string;
      try {
        signer = verifyMessage(nonceMessage(address, config.chainId, row.nonce), signature);
      } catch {
        throw new HttpError(401, "signature_invalid");
      }
      if (signer.toLowerCase() !== address) throw new HttpError(401, "signature_invalid");

      db.prepare("DELETE FROM nonces WHERE address = ? AND nonce = ?").run(address, row.nonce);
      res.json({ token: signJwt(config, address), address, expiresIn: JWT_TTL_SECONDS });
    }),
  );

  app.get(
    "/profiles/me",
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      const row = db.prepare("SELECT * FROM profiles WHERE address = ?").get(address) as
        | ProfileRow
        | undefined;
      if (!row) throw new HttpError(404, "profile_not_found");
      res.json({ address: row.address, steamId64: row.steam_id });
    }),
  );

  app.post(
    "/profiles/me",
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      const steamId64 = requireSteamId64(req.body?.steamId64);
      const timestamp = now();
      db.prepare(
        `INSERT INTO profiles (address, steam_id, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET steam_id = excluded.steam_id, updated_at = excluded.updated_at`,
      ).run(address, steamId64, timestamp, timestamp);
      res.json({ address, steamId64 });
    }),
  );

  app.get(
    "/inventory/:steamId64",
    inventoryRateLimit,
    asyncHandler(async (req, res) => {
      const steamId64 = requireSteamId64(req.params.steamId64);
      let items: SteamItem[];
      try {
        items = await withTimeout(inventory.getInventory(steamId64), 20_000);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "steam_inventory_unavailable");
      }
      res.json({ steamId64, items });
    }),
  );

  app.post(
    "/items/prepare",
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      const steamId64 = requireSteamId64(req.body?.steamId64);
      const assetId = requireDigits(req.body?.assetId, "assetId");
      const classId =
        req.body?.classId === undefined ? undefined : requireDigits(req.body.classId, "classId");
      const instanceId =
        req.body?.instanceId === undefined
          ? undefined
          : requireDigits(req.body.instanceId, "instanceId");

      const profile = db.prepare("SELECT * FROM profiles WHERE address = ?").get(address) as
        | ProfileRow
        | undefined;
      if (!profile || profile.steam_id !== steamId64) throw new HttpError(403, "steam_id_mismatch");

      let items: SteamItem[];
      try {
        items = await withTimeout(inventory.getInventory(steamId64), 20_000);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "steam_inventory_unavailable");
      }
      const found = findInventoryItem(items, assetId, classId, instanceId);
      if (!found) throw new HttpError(404, "item_not_found_or_not_tradable");

      const item = itemFromInventory(found, steamId64);
      const hash = itemHash(item);
      const existing = db.prepare("SELECT * FROM metadata WHERE item_hash = ?").get(hash) as
        | MetadataRow
        | undefined;
      if (
        existing &&
        (existing.seller_address !== address || existing.seller_steam_id !== steamId64)
      ) {
        throw new HttpError(409, "item_already_prepared");
      }
      const timestamp = now();
      if (existing) {
        db.prepare(
          `UPDATE metadata SET asset_id = ?, class_id = ?, instance_id = ?, market_hash_name = ?,
           inspect_link = ?, image_url = ?, verified = 1 WHERE item_hash = ?`,
        ).run(
          item.assetId,
          item.classId,
          item.instanceId,
          item.marketHashName,
          item.inspectLink ?? null,
          item.imageUrl ?? null,
          hash,
        );
      } else {
        db.prepare(
          `INSERT INTO metadata (item_hash, seller_address, seller_steam_id, asset_id, class_id,
           instance_id, market_hash_name, inspect_link, image_url, verified, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        ).run(
          hash,
          address,
          steamId64,
          item.assetId,
          item.classId,
          item.instanceId,
          item.marketHashName,
          item.inspectLink ?? null,
          item.imageUrl ?? null,
          timestamp,
        );
      }
      res.json({ itemHash: hash, item });
    }),
  );

  app.get(
    "/metadata/:itemHash",
    asyncHandler(async (req, res) => {
      const hash = requireString(req.params.itemHash, "itemHash", 66);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(422, "item_hash_invalid");
      const row = db.prepare("SELECT * FROM metadata WHERE item_hash = ?").get(hash) as
        | MetadataRow
        | undefined;
      if (!row) throw new HttpError(404, "metadata_not_found");
      res.json(publicMetadata(row));
    }),
  );

  app.put(
    "/listings/:listingId/buyer-trade-url",
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      const listingId = requireListingId(req.params.listingId);
      const rawUrl = requireString(req.body?.tradeUrl, "tradeUrl", 4096);

      let parsed: ReturnType<typeof parseTradeUrl>;
      try {
        parsed = parseTradeUrl(rawUrl);
      } catch {
        throw new HttpError(422, "trade_url_invalid");
      }

      const listing = await chain.getListing(listingId);
      if (listing.status === ListingStatus.None) throw new HttpError(404, "listing_not_found");
      if (listing.status === ListingStatus.Active) {
        // Pre-buy submission is allowed; it is only associated with this wallet.
      } else if (listing.status === ListingStatus.Funded) {
        if (listing.buyer.toLowerCase() !== address) throw new HttpError(403, "not_buyer");
      } else {
        throw new HttpError(409, "listing_not_accepting_trade_url");
      }

      const encrypted = encryptString(parsed.raw, config.encryptionKey);
      const timestamp = now();
      db.prepare(
        `INSERT INTO buyer_urls (listing_id, buyer_address, buyer_steam_id, ciphertext, iv, tag,
          created_at, updated_at, revealed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(listing_id, buyer_address) DO UPDATE SET
           buyer_steam_id = excluded.buyer_steam_id,
           ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
           updated_at = excluded.updated_at, revealed_at = NULL`,
      ).run(
        listingId,
        address,
        parsed.steamId64,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        timestamp,
        timestamp,
      );
      noStore(res);
      res.json({ ok: true, listingId, buyerSteamId: parsed.steamId64 });
    }),
  );

  app.get(
    "/listings/:listingId/buyer-trade-url",
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      const listingId = requireListingId(req.params.listingId);
      const listing = await chain.getListing(listingId);
      if (listing.status === ListingStatus.None) throw new HttpError(404, "listing_not_found");
      if (listing.seller.toLowerCase() !== address) throw new HttpError(403, "not_seller");
      if (listing.status !== ListingStatus.Funded) {
        throw new HttpError(409, "buyer_trade_url_not_available");
      }
      const row = db
        .prepare("SELECT * FROM buyer_urls WHERE listing_id = ? AND buyer_address = ?")
        .get(listingId, listing.buyer.toLowerCase()) as BuyerUrlRow | undefined;
      if (!row) throw new HttpError(404, "buyer_trade_url_not_found");

      db.prepare("UPDATE buyer_urls SET revealed_at = ? WHERE listing_id = ? AND buyer_address = ?")
        .run(now(), listingId, listing.buyer.toLowerCase());
      noStore(res);
      res.json({
        listingId,
        tradeUrl: decryptString(row, config.encryptionKey),
      });
    }),
  );

  app.post(
    "/helper/pairing-code",
    pairRateLimit,
    asyncHandler(async (req, res) => {
      const address = requireAuth(req);
      let code = "";
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        code = randomPairingCode();
        try {
          db.transaction(() => {
            db.prepare(
              "DELETE FROM helper_pairings WHERE seller_address = ? AND used_at IS NULL",
            ).run(address);
            db.prepare(
              "INSERT INTO helper_pairings (code_hash, seller_address, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)",
            ).run(sha256Hex(code), address, now() + config.pairingCodeTtlMs, now());
          })();
          inserted = true;
        } catch {
          // collision; retry
        }
      }
      if (!inserted) throw new HttpError(503, "pairing_code_unavailable");
      res.json({ code, expiresAt: now() + config.pairingCodeTtlMs });
    }),
  );

  app.post(
    "/helper/pair",
    pairRateLimit,
    asyncHandler(async (req, res) => {
      const code = requireString(req.body?.code, "code", 6);
      if (!/^\d{6}$/.test(code)) throw new HttpError(422, "pairing_code_invalid");
      const codeHash = sha256Hex(code);
      const row = db
        .prepare("SELECT * FROM helper_pairings WHERE code_hash = ?")
        .get(codeHash) as
        | { seller_address: string; expires_at: number; used_at: number | null }
        | undefined;
      if (!row || row.used_at !== null || !isFresh(row.expires_at, now())) {
        throw new HttpError(401, "pairing_code_invalid");
      }
      const used = db
        .prepare(
          "UPDATE helper_pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL",
        )
        .run(now(), codeHash);
      if (used.changes !== 1) throw new HttpError(401, "pairing_code_invalid");

      const token = randomToken("sp_helper_");
      const expiresAt = now() + config.helperTokenTtlMs;
      db.prepare(
        "INSERT INTO helper_sessions (token_hash, seller_address, expires_at, created_at) VALUES (?, ?, ?, ?)",
      ).run(sha256Hex(token), row.seller_address, expiresAt, now());
      noStore(res);
      res.json({ token, seller: row.seller_address, expiresAt });
    }),
  );

  app.get(
    "/helper/profile",
    asyncHandler(async (req, res) => {
      const seller = requireHelper(req);
      const profile = db.prepare("SELECT * FROM profiles WHERE address = ?").get(seller) as
        | ProfileRow
        | undefined;
      noStore(res);
      res.json({ seller, steamId64: profile?.steam_id ?? null });
    }),
  );

  app.get(
    "/helper/orders",
    asyncHandler(async (req, res) => {
      const seller = requireHelper(req);
      const listings = await chain.findFundedBySeller(seller);
      const orders = [];
      for (const { listingId, listing } of listings) {
        const metadata = db.prepare("SELECT * FROM metadata WHERE item_hash = ?").get(listing.itemHash) as
          | MetadataRow
          | undefined;
        const buyerUrl = db
          .prepare("SELECT * FROM buyer_urls WHERE listing_id = ? AND buyer_address = ?")
          .get(listingId, listing.buyer.toLowerCase()) as BuyerUrlRow | undefined;
        if (!metadata || !buyerUrl) continue;
        db.prepare(
          "UPDATE buyer_urls SET revealed_at = ? WHERE listing_id = ? AND buyer_address = ?",
        ).run(now(), listingId, listing.buyer.toLowerCase());
        orders.push({
          listingId,
          seller: listing.seller,
          buyer: listing.buyer,
          sellerSteamId: metadata.seller_steam_id,
          buyerSteamId: buyerUrl.buyer_steam_id,
          buyerTradeUrl: decryptString(buyerUrl, config.encryptionKey),
          item: metadataToItem(metadata),
          price: listing.price.toString(),
          bond: listing.bond.toString(),
          offerDeadline: Number(listing.offerDeadline),
        });
      }
      noStore(res);
      res.json({ orders });
    }),
  );

  app.post(
    "/helper/listings/:listingId/offer",
    asyncHandler(async (req, res) => {
      const seller = requireHelper(req);
      const listingId = requireListingId(req.params.listingId);
      const tradeOfferId = requireDigits(req.body?.tradeOfferId, "tradeOfferId");
      const listing = await chain.getListing(listingId);
      if (listing.status === ListingStatus.None) throw new HttpError(404, "listing_not_found");
      if (listing.seller.toLowerCase() !== seller) throw new HttpError(403, "not_seller");
      if (listing.status !== ListingStatus.Funded) throw new HttpError(409, "listing_not_funded");
      if (BigInt(Math.floor(now() / 1000)) > listing.offerDeadline) {
        throw new HttpError(409, "offer_deadline_passed");
      }

      const hash = offerIdHash(tradeOfferId);
      const existing = db
        .prepare("SELECT * FROM offers WHERE listing_id = ?")
        .get(listingId) as OfferRow | undefined;
      if (existing) {
        if (existing.offer_id_hash === hash) {
          res.json({ listingId, offerIdHash: hash, idempotent: true });
          return;
        }
        throw new HttpError(409, "offer_already_recorded");
      }
      db.prepare(
        "INSERT INTO offers (listing_id, seller_address, trade_offer_id, offer_id_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(listingId, seller, tradeOfferId, hash, now());
      res.json({ listingId, offerIdHash: hash });
    }),
  );

  app.post(
    "/helper/listings/:listingId/accepted",
    asyncHandler(async (req, res) => {
      const seller = requireHelper(req);
      const listingId = requireListingId(req.params.listingId);
      const tradeOfferId = requireDigits(req.body?.tradeOfferId, "tradeOfferId");
      const observedAtRaw = requireString(req.body?.observedAt, "observedAt", 64);
      const observedAtMs = Date.parse(observedAtRaw);
      if (!Number.isFinite(observedAtMs)) throw new HttpError(422, "observed_at_invalid");

      const listing = await chain.getListing(listingId);
      if (listing.status === ListingStatus.None) throw new HttpError(404, "listing_not_found");
      if (listing.seller.toLowerCase() !== seller) throw new HttpError(403, "not_seller");
      if (listing.status !== ListingStatus.OfferSent) {
        throw new HttpError(409, "listing_not_offer_sent");
      }
      const hash = offerIdHash(tradeOfferId);
      if (hash.toLowerCase() !== String(listing.offerIdHash).toLowerCase()) {
        throw new HttpError(409, "offer_hash_mismatch");
      }
      const offer = db
        .prepare("SELECT * FROM offers WHERE listing_id = ?")
        .get(listingId) as OfferRow | undefined;
      if (!offer || offer.offer_id_hash.toLowerCase() !== hash.toLowerCase()) {
        throw new HttpError(409, "offer_not_recorded");
      }

      const metadata = db.prepare("SELECT * FROM metadata WHERE item_hash = ?").get(listing.itemHash) as
        | MetadataRow
        | undefined;
      const buyerUrl = db
        .prepare("SELECT * FROM buyer_urls WHERE listing_id = ? AND buyer_address = ?")
        .get(listingId, listing.buyer.toLowerCase()) as BuyerUrlRow | undefined;
      const sellerProfile = db
        .prepare("SELECT * FROM profiles WHERE address = ?")
        .get(seller) as ProfileRow | undefined;
      if (!metadata || !buyerUrl || !sellerProfile) {
        throw new HttpError(409, "evidence_data_unavailable");
      }

      const evidence: OfferEvidence = {
        listingId,
        tradeOfferId,
        state: 3,
        observedAt: new Date(observedAtMs).toISOString(),
        sellerSteamId: sellerProfile.steam_id,
        buyerSteamId: buyerUrl.buyer_steam_id,
        items: [
          {
            assetId: metadata.asset_id,
            classId: metadata.class_id,
            instanceId: metadata.instance_id,
            marketHashName: metadata.market_hash_name,
          },
        ],
      };
      const hashEvidence = evidenceHash(evidence);
      const existing = db
        .prepare("SELECT * FROM evidence WHERE listing_id = ?")
        .get(listingId) as EvidenceRow | undefined;
      if (existing) {
        if (existing.evidence_hash === hashEvidence) {
          res.json({ listingId, evidenceHash: hashEvidence, idempotent: true });
          return;
        }
        throw new HttpError(409, "evidence_already_recorded");
      }

      const encrypted = encryptString(JSON.stringify(evidence), config.encryptionKey);
      db.prepare(
        `INSERT INTO evidence (listing_id, seller_address, evidence_hash, ciphertext, iv, tag,
          observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        listingId,
        seller,
        hashEvidence,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        evidence.observedAt,
        now(),
      );
      res.json({ listingId, evidenceHash: hashEvidence });
    }),
  );

  app.get(
    "/listings/:listingId/report",
    asyncHandler(async (req, res) => {
      const access = requireReportAccess(req);
      const listingId = requireListingId(req.params.listingId);
      const listing = await chain.getListing(listingId);
      if (listing.status === ListingStatus.None) throw new HttpError(404, "listing_not_found");
      if (listing.seller.toLowerCase() !== access.seller) throw new HttpError(403, "not_seller");

      const offer = db
        .prepare("SELECT * FROM offers WHERE listing_id = ?")
        .get(listingId) as OfferRow | undefined;
      const evidence = db
        .prepare("SELECT * FROM evidence WHERE listing_id = ?")
        .get(listingId) as EvidenceRow | undefined;
      noStore(res);
      res.json({
        listingId,
        status: listing.status,
        onChainOfferIdHash: listing.offerIdHash,
        onChainEvidenceHash: listing.evidenceHash,
        offer: offer
          ? { tradeOfferId: offer.trade_offer_id, offerIdHash: offer.offer_id_hash }
          : null,
        evidence: evidence
          ? { evidenceHash: evidence.evidence_hash, observedAt: evidence.observed_at }
          : null,
      });
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    // Deliberately log neither request bodies nor headers: they may contain bearer URLs.
    console.error("[relay] internal error", {
      name: error instanceof Error ? error.name : typeof error,
    });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

/**
 * Delete buyer Trade URLs once the on-chain listing is terminal (or no longer exists).
 * Returns the number of listing groups removed.
 */
export async function cleanupTerminalBuyerUrls(db: DB, chain: ChainReader): Promise<number> {
  const rows = db.prepare("SELECT DISTINCT listing_id FROM buyer_urls").all() as Array<{
    listing_id: string;
  }>;
  let removed = 0;
  for (const row of rows) {
    let terminal = false;
    try {
      const listing = await chain.getListing(row.listing_id);
      terminal =
        listing.status === ListingStatus.None ||
        listing.status === ListingStatus.Completed ||
        listing.status === ListingStatus.Refunded;
    } catch {
      // Do not delete on transient RPC failure; retry on the next pass.
      terminal = false;
    }
    if (terminal) {
      const result = db.prepare("DELETE FROM buyer_urls WHERE listing_id = ?").run(row.listing_id);
      if (result.changes > 0) removed += 1;
    }
  }
  return removed;
}
