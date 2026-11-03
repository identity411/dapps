import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import steamSession from "steam-session";
import TradeOfferManager from "steam-tradeoffer-manager";
import QRCode from "qrcode";
import { safeErrorMessage, type SentOfferSummary } from "./orders.js";
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

export interface QrLoginOptions {
  /** Write the SVG to the state dir for terminal-only fallback. */
  writeQrFile?: boolean;
  /** Print the ASCII QR to the terminal (CLI mode). */
  logToTerminal?: boolean;
  /** Called after the code is scanned, before the user approves it. */
  onRemoteInteraction?: () => void;
}

export interface QrLoginHandle {
  qrDataUrl: string;
  /** Resolves to the logged-in SteamID64 after cookies are installed. */
  waitForLogin: Promise<string>;
  /** Stops this attempt; a fresh LoginSession is needed to try again. */
  cancel(): void;
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

  get isLoggedIn(): boolean {
    return Boolean(this.steamId64 && this.manager);
  }

  /**
   * Try the locally saved refresh token without ever starting a QR flow.
   * Returns null when there is no usable saved session.
   */
  async loginWithSavedToken(): Promise<string | null> {
    const saved = this.loadRefreshToken();
    if (!saved) return null;
    try {
      const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
      session.refreshToken = saved;
      const cookies = await session.getWebCookies();
      return await this.configureManager(cookies);
    } catch {
      console.warn("Saved Steam login token is invalid/expired; QR login is required.");
      return null;
    }
  }

  /**
   * Create a QR login challenge and return a data URL plus the eventual login.
   * The QR challenge is a short-lived login credential; it must stay local.
   */
  async beginQrLogin(options: QrLoginOptions = {}): Promise<QrLoginHandle> {
    if (this.isLoggedIn) throw new Error("steam_already_logged_in");

    const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
    session.loginTimeout = 5 * 60 * 1000;

    let rejectForCancel: ((error: Error) => void) | null = null;
    const cancelled = new Promise<never>((_, reject) => {
      rejectForCancel = reject;
    });
    const authenticated = new Promise<void>((resolve, reject) => {
      session.once("authenticated", () => resolve());
      session.once("timeout", () => reject(new Error("steam_qr_timeout")));
      session.once("error", (error: Error & { eresult?: number }) => {
        const eresult = error?.eresult !== undefined ? ` (eresult ${error.eresult})` : "";
        console.warn(`Steam QR polling failed: ${safeErrorMessage(error)}${eresult}`);
        reject(new Error("steam_qr_error"));
      });
      session.once("remoteInteraction", () => options.onRemoteInteraction?.());
    });
    const loginOutcome = Promise.race([authenticated, cancelled]);
    const cancel = (): void => {
      session.cancelLoginAttempt();
      const reject = rejectForCancel;
      rejectForCancel = null;
      reject?.(new Error("steam_qr_canceled"));
    };

    const start = await session.startWithQR();
    const qrDataUrl = await QRCode.toDataURL(start.qrChallengeUrl, {
      margin: 1,
      width: 360,
    });

    if (options.writeQrFile) {
      const svg = await QRCode.toString(start.qrChallengeUrl, {
        type: "svg",
        margin: 1,
        width: 512,
      });
      writeTextFileSecure(this.qrFile, svg);
    }
    if (options.logToTerminal) {
      const terminalQr = await QRCode.toString(start.qrChallengeUrl, {
        type: "terminal",
        small: true,
      });
      console.log("\nScan this QR with the SELLER Steam mobile app:\n");
      console.log(terminalQr);
      if (options.writeQrFile) {
        console.log(`A larger QR image was saved locally at ${this.qrFile} (do not share it).`);
      }
    }

    const waitForLogin = (async () => {
      try {
        await loginOutcome;
        if (session.refreshToken) {
          const payload: SteamSessionFile = {
            refreshToken: String(session.refreshToken),
            savedAt: new Date().toISOString(),
          };
          writeJsonFileSecure(this.steamSessionFile, payload);
          console.log("Steam login token saved locally (600, gitignored).");
        }
        const cookies = await session.getWebCookies();
        return await this.configureManager(cookies);
      } finally {
        if (options.writeQrFile) deleteFile(this.qrFile);
      }
    })();

    return { qrDataUrl, waitForLogin, cancel };
  }

  /** CLI compatibility: saved token first, then one interactive QR flow. */
  async login(): Promise<string> {
    const saved = await this.loginWithSavedToken();
    if (saved) {
      console.log("Using saved local Steam login token.");
      return saved;
    }
    const qr = await this.beginQrLogin({ writeQrFile: true, logToTerminal: true });
    return qr.waitForLogin;
  }

  private async configureManager(cookies: string[]): Promise<string> {
    const manager = new TradeOfferManager({
      domain: "localhost",
      language: "en",
      pollInterval: 10_000,
      useAccessToken: true,
      dataDirectory: null,
      savePollData: false,
    });
    await new Promise<void>((resolve, reject) => {
      manager.setCookies(cookies, (error: Error | null) => {
        if (error) reject(new Error("steam_session_rejected"));
        else resolve();
      });
    });
    const steamId = manager.steamID?.getSteamID64?.();
    if (!steamId || !/^\d{17}$/.test(String(steamId))) {
      throw new Error("steam_login_did_not_yield_steamid");
    }
    this.manager = manager;
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
