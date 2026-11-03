import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import steamSession from "steam-session";
import TradeOfferManager from "steam-tradeoffer-manager";
import QRCode from "qrcode";
import type { SentOfferSummary } from "./orders.js";
import { deleteFile, readJsonFile, writeJsonFileSecure, writeTextFileSecure } from "./storage.js";

const { LoginSession, EAuthTokenPlatformType } = steamSession;
const { EOfferFilter, ETradeOfferState } = TradeOfferManager;

const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = "2";

export interface SteamItem {
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
}

export interface RawInventoryEntry {
  item: SteamItem;
  raw: any;
}

export interface SentOffer {
  id: string;
  partnerSteamId: string;
  state: number;
  assetIds: string[];
  message: string | null;
}

export interface SendOfferResult {
  tradeOfferId: string;
  status: string;
}

interface SteamSessionFile {
  refreshToken: string;
  savedAt: string;
}

export class SteamClient {
  private manager: any = null;
  private steamId64: string | null = null;

  constructor(
    private readonly steamSessionFile: string,
    private readonly qrFile: string,
  ) {}

  get loggedInSteamId(): string {
    if (!this.steamId64) throw new Error("Steam client is not logged in");
    return this.steamId64;
  }

  async login(): Promise<string> {
    const cookies = await this.getWebCookies();
    this.manager = new TradeOfferManager({
      domain: "localhost",
      language: "en",
      pollInterval: 10_000,
      useAccessToken: true,
      dataDirectory: null,
      savePollData: false,
    });
    await new Promise<void>((resolve, reject) => {
      this.manager.setCookies(cookies, (error: Error | null) => {
        if (error) reject(new Error("steam_session_rejected"));
        else resolve();
      });
    });
    const steamId = this.manager.steamID?.getSteamID64?.();
    if (!steamId || !/^\d{17}$/.test(String(steamId))) {
      throw new Error("steam_login_did_not_yield_steamid");
    }
    this.steamId64 = String(steamId);
    return this.steamId64;
  }

  async getInventory(): Promise<RawInventoryEntry[]> {
    if (!this.manager) throw new Error("Steam client is not logged in");
    const rawItems = await new Promise<any[]>((resolve, reject) => {
      this.manager.getInventoryContents(
        CS2_APP_ID,
        CS2_CONTEXT_ID,
        true,
        (error: Error | null, items: any[]) => {
          if (error) reject(new Error("steam_inventory_unavailable"));
          else resolve(items);
        },
      );
    });

    const out: RawInventoryEntry[] = [];
    for (const raw of rawItems) {
      const assetId = String(raw.assetid ?? raw.id ?? "");
      const classId = String(raw.classid ?? "");
      const instanceId = String(raw.instanceid ?? "");
      const marketHashName = String(raw.market_hash_name ?? raw.market_name ?? "");
      if (!assetId || !classId || !instanceId || !marketHashName) continue;
      out.push({ item: { assetId, classId, instanceId, marketHashName }, raw });
    }
    return out;
  }

  async sendOffer(
    buyerTradeUrl: string,
    rawItem: any,
    listingId: string,
  ): Promise<SendOfferResult> {
    if (!this.manager) throw new Error("Steam client is not logged in");
    const offer = this.manager.createOffer(buyerTradeUrl);
    if (!offer.addMyItem(rawItem)) throw new Error("steam_add_item_failed");
    offer.setMessage(`SkinPact S1 listing #${listingId}`);

    return new Promise<SendOfferResult>((resolve, reject) => {
      offer.send((error: Error | null, status: string) => {
        if (error || !offer.id) {
          reject(new Error("steam_send_offer_failed"));
          return;
        }
        resolve({ tradeOfferId: String(offer.id), status: String(status || "sent") });
      });
    });
  }

  async getOffer(tradeOfferId: string): Promise<{
    tradeOfferId: string;
    state: number;
    partnerSteamId: string;
    assetIds: string[];
    message: string | null;
  }> {
    if (!this.manager) throw new Error("Steam client is not logged in");
    const offer = await new Promise<any>((resolve, reject) => {
      this.manager.getOffer(tradeOfferId, (error: Error | null, data: any) => {
        if (error) reject(new Error("steam_get_offer_failed"));
        else resolve(data);
      });
    });
    return {
      tradeOfferId: String(offer.id ?? tradeOfferId),
      state: Number(offer.state),
      partnerSteamId: String(offer.partner?.getSteamID64?.() ?? ""),
      assetIds: Array.isArray(offer.itemsToGive)
        ? offer.itemsToGive.map((item: any) => String(item.assetid ?? item.id ?? ""))
        : [],
      message: typeof offer.message === "string" ? offer.message : null,
    };
  }

  async getActiveSentOffers(): Promise<SentOfferSummary[]> {
    if (!this.manager) throw new Error("Steam client is not logged in");
    const sent = await new Promise<any[]>((resolve, reject) => {
      this.manager.getOffers(
        EOfferFilter.ActiveOnly,
        (error: Error | null, offersSent: any[]) => {
          if (error) reject(new Error("steam_list_offers_failed"));
          else resolve(offersSent || []);
        },
      );
    });
    return sent.map((offer: any) => ({
      id: String(offer.id),
      partnerSteamId: String(offer.partner?.getSteamID64?.() ?? ""),
      state: Number(offer.state),
      assetIds: Array.isArray(offer.itemsToGive)
        ? offer.itemsToGive.map((item: any) => String(item.assetid ?? item.id ?? ""))
        : [],
      message: typeof offer.message === "string" ? offer.message : null,
    }));
  }

  private async getWebCookies(): Promise<string[]> {
    const saved = this.loadRefreshToken();
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

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.qrLoginAttempt(attempt);
      } catch {
        deleteFile(this.qrFile);
        console.warn(`Steam QR login attempt ${attempt}/3 failed.`);
      }
    }
    throw new Error("steam_qr_login_failed");
  }

  private async qrLoginAttempt(attempt: number): Promise<string[]> {
    const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
    session.loginTimeout = 5 * 60 * 1000;

    const authenticated = new Promise<void>((resolve, reject) => {
      session.once("authenticated", () => resolve());
      session.once("timeout", () => reject(new Error("steam_qr_timeout")));
      session.once("error", () => reject(new Error("steam_qr_error")));
    });

    const start = await session.startWithQR();
    const svg = await QRCode.toString(start.qrChallengeUrl, {
      type: "svg",
      margin: 1,
      width: 512,
    });
    writeTextFileSecure(this.qrFile, svg);
    const terminalQr = await QRCode.toString(start.qrChallengeUrl, {
      type: "terminal",
      small: true,
    });
    console.log(`\nScan this QR with the SELLER Steam mobile app (attempt ${attempt}/3):\n`);
    console.log(terminalQr);
    console.log(`A larger QR image was saved locally at ${this.qrFile} (do not share it).`);

    await authenticated;

    if (session.refreshToken) {
      const payload: SteamSessionFile = {
        refreshToken: String(session.refreshToken),
        savedAt: new Date().toISOString(),
      };
      writeJsonFileSecure(this.steamSessionFile, payload);
      console.log("Steam login token saved locally (600, gitignored).");
    }
    const cookies = await session.getWebCookies();
    deleteFile(this.qrFile);
    return cookies;
  }

  private loadRefreshToken(): string | null {
    const data = readJsonFile<SteamSessionFile>(this.steamSessionFile);
    if (!data || typeof data.refreshToken !== "string") return null;
    return data.refreshToken;
  }
}

export { ETradeOfferState };

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export function qrFileExists(file: string): boolean {
  return fs.existsSync(file);
}
