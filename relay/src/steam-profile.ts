export interface SteamProfile {
  steamId64: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface SteamProfileProvider {
  getProfile(steamId64: string): Promise<SteamProfile>;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124 Safari/537.36";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function readTag(xml: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`).exec(xml);
  if (cdata) return decodeXmlEntities(cdata[1]!.trim());
  const plain = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return plain ? decodeXmlEntities(plain[1]!.trim()) : null;
}

function safeAvatarUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(".steamstatic.com") && !host.endsWith(".akamaihd.net")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export class SteamCommunityProfileProvider implements SteamProfileProvider {
  async getProfile(steamId64: string): Promise<SteamProfile> {
    const response = await fetch(`https://steamcommunity.com/profiles/${steamId64}/?xml=1`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Steam profile request failed with HTTP ${response.status}`);
    }
    const xml = await response.text();
    if (xml.length > 512_000) throw new Error("Steam profile response is too large");

    const returnedId = readTag(xml, "steamID64");
    if (returnedId !== steamId64) throw new Error("Steam profile response did not match SteamID64");

    const nickname = (readTag(xml, "steamID") || "").slice(0, 64) || `Steam ${steamId64.slice(-6)}`;
    const avatarUrl = safeAvatarUrl(readTag(xml, "avatarMedium") || readTag(xml, "avatarFull"));
    return { steamId64, nickname, avatarUrl };
  }
}
