import { keccak256, toUtf8Bytes } from "ethers";

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = normalize(item);
    }
    return out;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

/** Stable JSON: sorted object keys, deterministic across callers. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalHash(value: unknown): string {
  return keccak256(toUtf8Bytes(canonicalJson(value)));
}

export function hashTradeOfferId(tradeOfferId: string | number | bigint): string {
  const id = String(tradeOfferId).trim();
  if (!id) throw new Error("tradeOfferId is empty");
  return keccak256(toUtf8Bytes(id));
}
