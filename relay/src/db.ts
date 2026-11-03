import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

export function createDb(filename: string): DB {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      address TEXT PRIMARY KEY,
      steam_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metadata (
      item_hash TEXT PRIMARY KEY,
      seller_address TEXT NOT NULL,
      seller_steam_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      market_hash_name TEXT NOT NULL,
      inspect_link TEXT,
      image_url TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buyer_urls (
      listing_id TEXT NOT NULL,
      buyer_address TEXT NOT NULL,
      buyer_steam_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revealed_at INTEGER,
      PRIMARY KEY (listing_id, buyer_address)
    );

    CREATE TABLE IF NOT EXISTS buyer_steam_accounts (
      id TEXT PRIMARY KEY,
      owner_address TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      inventory_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar_url TEXT,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_address, steam_id)
    );

    CREATE TABLE IF NOT EXISTS helper_pairings (
      code_hash TEXT PRIMARY KEY,
      seller_address TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helper_sessions (
      token_hash TEXT PRIMARY KEY,
      seller_address TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offers (
      listing_id TEXT PRIMARY KEY,
      seller_address TEXT NOT NULL,
      trade_offer_id TEXT NOT NULL,
      offer_id_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      listing_id TEXT PRIMARY KEY,
      seller_address TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nonces (
      address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metadata_seller ON metadata(seller_address);
    CREATE INDEX IF NOT EXISTS idx_buyer_urls_listing ON buyer_urls(listing_id);
    CREATE INDEX IF NOT EXISTS idx_buyer_steam_accounts_owner
      ON buyer_steam_accounts(owner_address);
    CREATE INDEX IF NOT EXISTS idx_helper_sessions_seller ON helper_sessions(seller_address);
  `);

  return db;
}
