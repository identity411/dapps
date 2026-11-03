import crypto from "node:crypto";

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptString(plaintext: string, key: Buffer): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptString(value: EncryptedValue, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
}

export function randomNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function randomPairingCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isFresh(expiresAt: number, now = Date.now()): boolean {
  return Number.isFinite(expiresAt) && expiresAt > now;
}
