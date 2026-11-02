#!/usr/bin/env node
/**
 * Stage 0 local env checker — Plan A (seller local helper -> buyer Trade URL).
 *
 * ⚠️ STAGE 0 DEMO REFERENCE ONLY — NOT the S1/S2 DApp implementation.
 * It validates a local .env for the feasibility spike only; do not reuse it as
 * the production Relay/helper configuration path. See scripts/stage0/README.md.
 *
 * Usage:
 *   node scripts/stage0/check-env.mjs
 *
 * Validates:
 * - seller SteamID64
 * - buyer Trade URL (required) and optional buyer SteamID64
 * - optional seller Trade URL (legacy buyer-initiated fallback)
 * - optional item numeric fields
 * Never prints a trade token or API key.
 */

import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(".env");
const STEAMID64_BASE = 76561197960265728n;
const errors = [];
const warnings = [];

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...parseEnvFile(ENV_PATH), ...process.env };

function isSteamId64(value) {
  return /^\d{17}$/.test(value || "");
}

function checkSteamId(label, key, required) {
  const value = (env[key] || "").trim();
  if (!value) {
    if (required) errors.push(`${key} is required`);
    return;
  }
  if (!isSteamId64(value)) {
    errors.push(`${label} (${key}) is not a 17-digit SteamID64`);
  }
}

checkSteamId("Seller", "STAGE0_SELLER_STEAM_ID", true);
checkSteamId("Buyer", "STAGE0_BUYER_STEAM_ID", false);

function validateTradeUrl({ key, label, required, expectedIdKey }) {
  const raw = (env[key] || "").trim();
  if (!raw) {
    if (required) {
      errors.push(`${key} is empty (required for Plan A: seller helper -> buyer Trade URL)`);
    }
    return;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`${key} is not a valid URL`);
    return;
  }

  if (url.protocol !== "https:" || url.hostname !== "steamcommunity.com") {
    errors.push(`${key} must be https://steamcommunity.com/...`);
  }
  if (url.pathname.includes("/inventory/")) {
    errors.push(
      `${key} looks like an inventory/profile link. Use https://steamcommunity.com/tradeoffer/new/?partner=...&token=...`,
    );
    return;
  }
  if (!/^\/tradeoffer\/new\/?$/.test(url.pathname)) {
    errors.push(`${key} path should be /tradeoffer/new/`);
  }

  const partner = url.searchParams.get("partner") || "";
  const token = url.searchParams.get("token") || "";

  if (!/^\d+$/.test(partner)) errors.push(`${key} is missing a numeric partner parameter`);
  if (!token) errors.push(`${key} is missing a token parameter`);
  if (!/^\d+$/.test(partner)) return;

  const derived = (STEAMID64_BASE + BigInt(partner)).toString();
  console.log(`${label}: partner=${partner}, token=*** (${token.length} chars), SteamID64=${derived}`);

  const expected = (env[expectedIdKey] || "").trim();
  if (expected && isSteamId64(expected) && derived !== expected) {
    errors.push(`${label} derives ${derived}, which does not match ${expectedIdKey} (${expected})`);
  }
}

// Plan A requires the BUYER's Trade URL (seller helper sends to it).
validateTradeUrl({
  key: "STAGE0_BUYER_TRADE_URL",
  label: "Buyer Trade URL",
  required: true,
  expectedIdKey: "STAGE0_BUYER_STEAM_ID",
});

// Optional: keep for the legacy buyer-initiated fallback test.
validateTradeUrl({
  key: "STAGE0_SELLER_TRADE_URL",
  label: "Seller Trade URL (optional/legacy)",
  required: false,
  expectedIdKey: "STAGE0_SELLER_STEAM_ID",
});

if (env.STEAM_WEB_API_KEY) {
  warnings.push(
    "STEAM_WEB_API_KEY is set (value hidden). Use only for Stage 0 read-only tests; revoke afterwards.",
  );
}

for (const [key, label] of [
  ["STAGE0_ITEM_ASSET_ID", "asset_id"],
  ["STAGE0_ITEM_CLASS_ID", "class_id"],
  ["STAGE0_ITEM_INSTANCE_ID", "instance_id"],
]) {
  const value = (env[key] || "").trim();
  if (value && !/^\d+$/.test(value)) {
    errors.push(`${label} (${key}) should be numeric`);
  }
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(
    "\nFix .env locally. Never paste a Trade URL token, Steam session, password, or API key into chat/issues/commits.",
  );
  process.exit(1);
}

console.log("Stage 0 env looks structurally valid for Plan A.");
console.log(
  "Next: start the seller helper locally (seller Steam login stays on this machine), confirm both accounts > 7 days, and verify the chosen item's trade lock in Steam.",
);
