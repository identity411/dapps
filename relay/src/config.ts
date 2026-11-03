import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";

export interface RelayConfig {
  port: number;
  rpcUrl: string;
  contractAddress: string;
  chainId: number;
  deploymentBlock: number;
  dbPath: string;
  encryptionKey: Buffer;
  jwtSecret: string;
  webOrigin: string;
  pairingCodeTtlMs: number;
  helperTokenTtlMs: number;
  nonceTtlMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = (env[key] || "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseEncryptionKey(raw: string): Buffer {
  const text = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  try {
    const decoded = Buffer.from(text, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through
  }
  throw new Error("RELAY_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars)");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const chainId = Number(env.CHAIN_ID || "31337");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("CHAIN_ID is invalid");

  const jwtSecret = (env.JWT_SECRET || "").trim();
  if (jwtSecret.length < 16) throw new Error("JWT_SECRET must be at least 16 characters");

  const contractAddress = required(env, "CONTRACT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error("CONTRACT_ADDRESS must be a 20-byte hex address");
  }

  return {
    port: Number(env.PORT || "8787"),
    rpcUrl: (env.RPC_URL || "http://127.0.0.1:8545").trim(),
    contractAddress,
    chainId,
    deploymentBlock: Number(env.DEPLOYMENT_BLOCK || "0"),
    dbPath: path.resolve(env.DB_PATH || "data/skinpact.db"),
    encryptionKey: parseEncryptionKey(required(env, "RELAY_ENCRYPTION_KEY")),
    jwtSecret,
    webOrigin: (env.WEB_ORIGIN || "http://localhost:5173").trim(),
    pairingCodeTtlMs: Number(env.PAIRING_CODE_TTL_SECONDS || "300") * 1000,
    helperTokenTtlMs: Number(env.HELPER_TOKEN_TTL_SECONDS || "28800") * 1000,
    nonceTtlMs: Number(env.NONCE_TTL_SECONDS || "300") * 1000,
  };
}

export function generateDevSecrets(): { encryptionKey: string; jwtSecret: string } {
  return {
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    jwtSecret: crypto.randomBytes(32).toString("hex"),
  };
}
