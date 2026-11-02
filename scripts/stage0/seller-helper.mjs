#!/usr/bin/env node
/**
 * SkinPact Stage 0 — local seller helper (Plan A).
 *
 * ⚠️ STAGE 0 DEMO REFERENCE ONLY — NOT the S1/S2 DApp implementation.
 * This is a throwaway feasibility spike. Do NOT copy/import it directly into the
 * DApp helper: it has no Relay auth, no contract integration, no evidence
 * pipeline, no encryption, no UI, no tests, and no recovery/hardening.
 * It reads a local .env and stores a local Steam refresh token by design.
 * See scripts/stage0/README.md.
 *
 * Uses the SELLER'S OWN local Steam login (QR login, refresh token stored locally)
 * to send a trade offer for one specific inventory item to the BUYER'S Trade URL.
 *
 * - The platform is not involved. No password is stored. The local refresh token
 *   lives in .steam-helper-session.json (gitignored, mode 600).
 * - Steam may still require a mobile confirmation for the offer; approve it in
 *   the Steam mobile app. This helper never auto-confirms and never accepts a
 *   buyer's offer.
 * - Use only with your own accounts and a low-value test item.
 *
 * Usage:
 *   npm run stage0:helper -- --check              # validate env only, no Steam login
 *   npm run stage0:helper                         # QR login, verify item, ask SEND, send offer + watch
 *   npm run stage0:helper -- --send --no-wait     # skip prompt, send, exit immediately
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { stdin as input, stdout as output, argv } from "node:process";
import steamSession from "steam-session";
import TradeOfferManager from "steam-tradeoffer-manager";
import QRCode from "qrcode";

const { LoginSession, EAuthTokenPlatformType } = steamSession;
const { ETradeOfferState } = TradeOfferManager;

const ENV_PATH = path.resolve(".env");
const SESSION_FILE = path.resolve(".steam-helper-session.json");
const QR_FILE = path.resolve(".steam-helper-qr.svg");
const STEAMID64_BASE = 76561197960265728n;
const CS2_APPID = 730;
const CS2_CONTEXTID = "2";
const OFFER_TIMEOUT_MS = 15 * 60 * 1000;

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

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseTradeUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (url.protocol !== "https:" || url.hostname !== "steamcommunity.com") {
    fail(`${label} must be https://steamcommunity.com/...`);
  }
  if (url.pathname.includes("/inventory/")) {
    fail(`${label} is an inventory/profile link, not a trade URL`);
  }
  if (!/^\/tradeoffer\/new\/?$/.test(url.pathname)) {
    fail(`${label} path should be /tradeoffer/new/`);
  }
  const partner = url.searchParams.get("partner") || "";
  const token = url.searchParams.get("token") || "";
  if (!/^\d+$/.test(partner)) fail(`${label} is missing a numeric partner`);
  if (!token) fail(`${label} is missing a token`);
  const steamId64 = (STEAMID64_BASE + BigInt(partner)).toString();
  return { partner, token, steamId64 };
}

function loadConfig() {
  const sellerSteamId = (env.STAGE0_SELLER_STEAM_ID || "").trim();
  const buyerSteamId = (env.STAGE0_BUYER_STEAM_ID || "").trim();
  const buyerUrlRaw = (env.STAGE0_BUYER_TRADE_URL || "").trim();
  const assetId = (env.STAGE0_ITEM_ASSET_ID || "").trim();
  const classId = (env.STAGE0_ITEM_CLASS_ID || "").trim();
  const instanceId = (env.STAGE0_ITEM_INSTANCE_ID || "").trim();
  const marketHashName = (env.STAGE0_ITEM_MARKET_HASH_NAME || "").trim();

  if (!/^\d{17}$/.test(sellerSteamId)) fail("STAGE0_SELLER_STEAM_ID must be a 17-digit SteamID64");
  if (buyerSteamId && !/^\d{17}$/.test(buyerSteamId)) fail("STAGE0_BUYER_STEAM_ID is not a 17-digit SteamID64");
  if (!buyerUrlRaw) fail("STAGE0_BUYER_TRADE_URL is required (seller helper sends to the buyer)");
  if (!/^\d+$/.test(assetId)) fail("STAGE0_ITEM_ASSET_ID must be numeric");
  if (classId && !/^\d+$/.test(classId)) fail("STAGE0_ITEM_CLASS_ID must be numeric");
  if (instanceId && !/^\d+$/.test(instanceId)) fail("STAGE0_ITEM_INSTANCE_ID must be numeric");
  if (sellerSteamId === buyerSteamId) fail("seller and buyer must be different accounts");

  const buyer = parseTradeUrl(buyerUrlRaw, "STAGE0_BUYER_TRADE_URL");
  if (buyer.steamId64 === sellerSteamId) fail("buyer trade URL belongs to the seller account");
  if (buyerSteamId && buyer.steamId64 !== buyerSteamId) {
    fail(`buyer trade URL derives ${buyer.steamId64}, but STAGE0_BUYER_STEAM_ID is ${buyerSteamId}`);
  }

  return {
    sellerSteamId,
    buyerSteamId: buyer.steamId64,
    buyerUrl: buyerUrlRaw,
    buyerPartner: buyer.partner,
    assetId,
    classId,
    instanceId,
    marketHashName: marketHashName || "(name not set)",
  };
}

function loadRefreshToken() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    return data.refreshToken || null;
  } catch {
    return null;
  }
}

function saveRefreshToken(token) {
  fs.writeFileSync(
    SESSION_FILE,
    JSON.stringify({ refreshToken: token, savedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  try {
    fs.chmodSync(SESSION_FILE, 0o600);
  } catch {
    // best effort
  }
}

function openQrFile(file) {
  if (process.platform === "darwin") {
    execFile("open", [file], () => {
      // If opening fails, the printed path is still usable.
    });
  }
}

async function qrLoginAttempt(attempt) {
  const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
  session.loginTimeout = 5 * 60 * 1000;

  const authenticated = new Promise((resolve, reject) => {
    session.once("authenticated", resolve);
    session.once("timeout", () => reject(new Error("QR login timed out")));
    session.once("error", reject);
  });

  const start = await session.startWithQR();
  const qrSvg = await new Promise((resolve, reject) => {
    QRCode.toString(
      start.qrChallengeUrl,
      { type: "svg", margin: 1, width: 512 },
      (err, svg) => {
        if (err) reject(err);
        else resolve(svg);
      },
    );
  });
  fs.writeFileSync(QR_FILE, qrSvg, { mode: 0o600 });
  console.log(`\nQR image saved to: ${QR_FILE}`);
  console.log("Open the image, then scan it with the SELLER account in the Steam mobile app.");
  console.log("Do not share this image or the session files.");
  openQrFile(QR_FILE);
  console.log(`Waiting for Steam QR login (attempt ${attempt}/3, up to 5 minutes)...`);

  await authenticated;

  if (session.refreshToken) {
    saveRefreshToken(session.refreshToken);
    console.log(`Saved local login token to ${SESSION_FILE}（不提交、不外发）`);
  }

  const cookies = await session.getWebCookies();
  fs.rmSync(QR_FILE, { force: true });
  return cookies;
}

async function getWebCookies() {
  const saved = loadRefreshToken();
  if (saved) {
    try {
      const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
      session.refreshToken = saved;
      const cookies = await session.getWebCookies();
      console.log("Using saved local Steam login token.");
      return cookies;
    } catch {
      console.warn("Saved Steam login token is invalid/expired; starting QR login.");
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await qrLoginAttempt(attempt);
    } catch (err) {
      fs.rmSync(QR_FILE, { force: true });
      console.warn(`QR attempt ${attempt}/3 failed: ${err.message}`);
    }
  }

  throw new Error(
    "QR login failed 3 times. Run this in a real foreground terminal, enlarge the QR image if needed, and scan within 5 minutes.",
  );
}

function stateName(state) {
  return ETradeOfferState[state] || String(state);
}

function setCookies(manager, cookies) {
  return new Promise((resolve, reject) => {
    manager.setCookies(cookies, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getInventory(manager) {
  return new Promise((resolve, reject) => {
    manager.getInventoryContents(CS2_APPID, CS2_CONTEXTID, true, (err, items) => {
      if (err) reject(err);
      else resolve(items);
    });
  });
}

async function sendSpecificItemOffer(config) {
  const cookies = await getWebCookies();

  const manager = new TradeOfferManager({
    domain: "localhost",
    language: "en",
    pollInterval: 10000,
    useAccessToken: true,
    dataDirectory: null,
    savePollData: false,
  });

  await setCookies(manager, cookies);
  if (!manager.steamID) fail("Steam cookies did not yield a SteamID; login may have failed");

  const loggedInSteamId = manager.steamID.getSteamID64();
  if (loggedInSteamId !== config.sellerSteamId) {
    fail(
      `Logged into ${loggedInSteamId}, but STAGE0_SELLER_STEAM_ID is ${config.sellerSteamId}. ` +
        `Delete ${SESSION_FILE} and scan the seller account again.`,
    );
  }

  console.log(`Logged in as seller: ${loggedInSteamId}`);
  console.log(`Buyer: partner=${config.buyerPartner} (token hidden), SteamID64=${config.buyerSteamId}`);
  console.log(`Item: ${config.marketHashName} (asset ${config.assetId})`);

  const inventory = await getInventory(manager);
  const item = inventory.find(
    (candidate) =>
      String(candidate.assetid) === config.assetId || String(candidate.id) === config.assetId,
  );

  if (!item) {
    fail(
      `Asset ${config.assetId} was not found among TRADABLE CS2 items. ` +
        `Check the Steam trade lock / cooldown or choose another item.`,
    );
  }
  if (config.classId && item.classid && String(item.classid) !== config.classId) {
    fail(`Inventory classid (${item.classid}) does not match STAGE0_ITEM_CLASS_ID (${config.classId})`);
  }
  if (config.instanceId && item.instanceid && String(item.instanceid) !== config.instanceId) {
    fail(
      `Inventory instanceid (${item.instanceid}) does not match STAGE0_ITEM_INSTANCE_ID (${config.instanceId})`,
    );
  }

  console.log(`Item found in seller inventory: ${item.market_hash_name || item.market_name || config.marketHashName}`);
  console.log("The buyer will accept in Steam; this helper never accepts on the buyer's behalf.");

  const autoSend = argv.includes("--send") || argv.includes("--yes");
  const noWait = argv.includes("--no-wait");

  if (autoSend) {
    console.log("--send: skipping the SEND prompt and creating the offer now.");
  } else {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question('Type "SEND" to create the trade offer: ');
    rl.close();
    if (answer.trim().toUpperCase() !== "SEND") {
      console.log("Aborted; no offer was sent.");
      return;
    }
  }

  const offer = manager.createOffer(config.buyerUrl);
  if (!offer.addMyItem(item)) {
    fail("Could not add the item to the offer");
  }
  offer.setMessage("SkinPact Stage 0 test");

  manager.on("sentOfferChanged", (changed, oldState) => {
    if (String(changed.id) !== String(offer.id)) return;
    console.log(`Offer #${changed.id}: ${stateName(oldState)} -> ${stateName(changed.state)}`);
  });

  const offerId = await new Promise((resolve, reject) => {
    offer.send((err, status) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`Offer #${offer.id} created (status=${status}).`);
      console.log(`Offer URL: https://steamcommunity.com/tradeoffer/${offer.id}/`);
      if (status === "pending") {
        console.log(
          "Steam requires confirmation. Approve the offer in the SELLER's Steam mobile app, " +
            "then have the buyer accept. This helper does not auto-confirm.",
        );
      } else {
        console.log("Have the buyer accept the incoming offer in Steam.");
      }
      resolve(offer.id);
    });
  });

  if (noWait) {
    console.log("--no-wait: offer created; exiting. Confirm in Steam if required, then have the buyer accept.");
    process.exit(0);
  }

  console.log("Watching offer state. Leave this running until the buyer accepts (or Ctrl+C).");
  const terminalState = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), OFFER_TIMEOUT_MS);
    manager.on("sentOfferChanged", (changed) => {
      if (String(changed.id) !== String(offerId)) return;
      if (
        [
          ETradeOfferState.Accepted,
          ETradeOfferState.InEscrow,
          ETradeOfferState.Declined,
          ETradeOfferState.Canceled,
          ETradeOfferState.Expired,
          ETradeOfferState.InvalidItems,
        ].includes(changed.state)
      ) {
        clearTimeout(timeout);
        resolve(changed.state);
      }
    });
  });

  if (terminalState === "timeout") {
    console.log("Timed out waiting for the offer state change. Check Steam manually.");
  } else {
    console.log(`Final observed offer state: ${stateName(terminalState)}`);
    if (terminalState === ETradeOfferState.Accepted) {
      console.log("Steam accepted. Now have the buyer confirm receipt in the DApp (after the contract is ready).");
    } else if (terminalState === ETradeOfferState.InEscrow) {
      console.log(
        "Steam accepted but the trade is InEscrow (trade hold). The buyer may not have the item yet; record this as hold observed.",
      );
    }
  }

  process.exit(0);
}

async function main() {
  const config = loadConfig();
  console.log("Plan A config valid.");
  console.log(`Seller SteamID64: ${config.sellerSteamId}`);
  console.log(`Buyer partner: ${config.buyerPartner} (token hidden)`);
  console.log(`Test item: ${config.marketHashName} (asset ${config.assetId})`);

  if (argv.includes("--check")) {
    console.log("--check: environment is valid; no Steam login attempted.");
    return;
  }

  await sendSpecificItemOffer(config);
}

main().catch((err) => {
  console.error(`ERROR: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
