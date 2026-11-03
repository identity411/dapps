import type { Signer } from "ethers";
import { RELAY_URL } from "./config";

export class RelayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export interface RelayProfile {
  address?: string;
  steamId64?: string;
}

export interface InventoryItem {
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  inspectLink?: string;
  imageUrl?: string;
}

export interface PublicMetadata {
  itemHash: string;
  seller: string;
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  inspectLink?: string;
  imageUrl?: string;
  verified: boolean;
}

export interface SellerReport {
  listingId: string;
  status: number;
  onChainOfferIdHash: string;
  onChainEvidenceHash: string;
  offer: { tradeOfferId: string; offerIdHash: string } | null;
  evidence: { evidenceHash: string; observedAt: string } | null;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
}

async function relayFetch<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT"; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`${RELAY_URL}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const code = parsed && typeof parsed.error === "string" ? parsed.error : `http_${response.status}`;
      throw new RelayError(response.status, code);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RelayError(504, "relay_timeout");
    }
    throw new RelayError(503, "relay_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticateRelay(address: string, signer: Signer): Promise<string> {
  const nonce = await relayFetch<{ message: string }>("/auth/nonce", {
    method: "POST",
    body: { address },
  });
  const signature = await signer.signMessage(nonce.message);
  const verified = await relayFetch<{ token: string }>("/auth/verify", {
    method: "POST",
    body: { address, signature },
  });
  if (!verified.token) throw new RelayError(502, "relay_auth_invalid");
  return verified.token;
}

export function getRelayProfile(token: string): Promise<RelayProfile> {
  return relayFetch<RelayProfile>("/profiles/me", { method: "GET", token });
}

export function saveRelayProfile(token: string, steamId64: string): Promise<RelayProfile> {
  return relayFetch<RelayProfile>("/profiles/me", {
    method: "POST",
    token,
    body: { steamId64 },
  });
}

export async function getInventory(steamId64: string): Promise<InventoryItem[]> {
  const result = await relayFetch<{ items: InventoryItem[] }>(`/inventory/${steamId64}`, {
    method: "GET",
  });
  return result.items || [];
}

export function prepareItem(
  token: string,
  steamId64: string,
  assetId: string,
): Promise<{ itemHash: string }> {
  return relayFetch<{ itemHash: string }>("/items/prepare", {
    method: "POST",
    token,
    body: { steamId64, assetId },
  });
}

export function getMetadata(itemHash: string): Promise<PublicMetadata> {
  return relayFetch<PublicMetadata>(`/metadata/${itemHash}`, { method: "GET" });
}

export function submitBuyerTradeUrl(
  token: string,
  listingId: string,
  tradeUrl: string,
): Promise<{ buyerSteamId: string }> {
  return relayFetch<{ buyerSteamId: string }>(`/listings/${listingId}/buyer-trade-url`, {
    method: "PUT",
    token,
    body: { tradeUrl },
  });
}

export function getSellerReport(token: string, listingId: string): Promise<SellerReport> {
  return relayFetch<SellerReport>(`/listings/${listingId}/report`, { method: "GET", token });
}

export function createPairingCode(token: string): Promise<PairingCode> {
  return relayFetch<PairingCode>("/helper/pairing-code", { method: "POST", token });
}
