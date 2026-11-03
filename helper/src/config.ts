import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HelperConfig {
  relayUrl: string;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  apiPort: number;
  webOrigins: string[];
  stateDir: string;
  helperSessionFile: string;
  steamSessionFile: string;
  ledgerFile: string;
  qrFile: string;
  pairingCodeFromEnv: string | null;
}

export const DEFAULT_HELPER_API_PORT = 8788;
export const DEFAULT_WEB_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStateDir = path.resolve(moduleDir, "../.skinpact-helper");

function positiveInt(raw: string | undefined, fallback: number, min: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < min) return fallback;
  return value;
}

function parseWebOrigins(raw: string | undefined): string[] {
  const candidates = (raw || DEFAULT_WEB_ORIGINS.join(","))
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const origins: string[] = [];
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`HELPER_WEB_ORIGINS contains an invalid origin: ${candidate}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("HELPER_WEB_ORIGINS entries must be http(s) origins");
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      throw new Error("HELPER_WEB_ORIGINS may only contain loopback origins");
    }
    origins.push(parsed.origin);
  }
  if (origins.length === 0) throw new Error("HELPER_WEB_ORIGINS must not be empty");
  return [...new Set(origins)];
}

export function loadHelperConfig(env: NodeJS.ProcessEnv = process.env): HelperConfig {
  const relayUrl = (env.SKINPACT_RELAY_URL || "http://127.0.0.1:8787").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(relayUrl);
  } catch {
    throw new Error("SKINPACT_RELAY_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("SKINPACT_RELAY_URL must be http(s)");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (parsed.protocol !== "https:" && !localHosts.has(parsed.hostname)) {
    throw new Error("Non-local Relay URLs must use HTTPS");
  }

  const apiPort = positiveInt(env.HELPER_API_PORT, DEFAULT_HELPER_API_PORT, 1);
  if (apiPort > 65_535) throw new Error("HELPER_API_PORT must be <= 65535");

  const stateDir = path.resolve(env.SKINPACT_HELPER_DIR || defaultStateDir);
  return {
    relayUrl,
    requestTimeoutMs: positiveInt(env.HELPER_REQUEST_TIMEOUT_MS, 15_000, 1_000),
    pollIntervalMs: positiveInt(env.HELPER_POLL_INTERVAL_MS, 5_000, 1_000),
    apiPort,
    webOrigins: parseWebOrigins(env.HELPER_WEB_ORIGINS),
    stateDir,
    helperSessionFile: path.join(stateDir, "helper-session.json"),
    steamSessionFile: path.join(stateDir, "steam-session.json"),
    ledgerFile: path.join(stateDir, "ledger.json"),
    qrFile: path.join(stateDir, "login-qr.svg"),
    pairingCodeFromEnv: (env.HELPER_PAIRING_CODE || "").trim() || null,
  };
}
