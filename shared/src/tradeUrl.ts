export const STEAMID64_BASE = 76561197960265728n;
export const CS2_APP_ID = 730;
export const CS2_CONTEXT_ID = "2";

export interface ParsedTradeUrl {
  /** Never log this value. */
  raw: string;
  partner: string;
  token: string;
  steamId64: string;
}

export function isSteamId64(value: string): boolean {
  return /^\d{17}$/.test(value);
}

export function steamId64FromPartner(partner: string): string {
  if (!/^\d+$/.test(partner)) throw new Error("Steam partner is not numeric");
  return (STEAMID64_BASE + BigInt(partner)).toString();
}

export function parseTradeUrl(raw: string): ParsedTradeUrl {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Trade URL is required");
  if (text.length > 4096) throw new Error("Trade URL is too long");

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Trade URL is not a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "steamcommunity.com") {
    throw new Error("Trade URL must be https://steamcommunity.com/...");
  }
  if (url.pathname.includes("/inventory/")) {
    throw new Error("That is an inventory/profile link, not a Trade URL");
  }
  if (!/^\/tradeoffer\/new\/?$/.test(url.pathname)) {
    throw new Error("Trade URL path should be /tradeoffer/new/");
  }

  const partner = url.searchParams.get("partner") || "";
  const token = url.searchParams.get("token") || "";
  if (!/^\d+$/.test(partner)) throw new Error("Trade URL is missing a numeric partner");
  if (!token || token.length > 256) throw new Error("Trade URL is missing a valid token");

  return {
    raw: text,
    partner,
    token,
    steamId64: steamId64FromPartner(partner),
  };
}
