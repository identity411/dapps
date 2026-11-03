import type { HelperConfig } from "./config.js";
import { HelperTokenExpiredError, recoverSendingEntries, runCycle } from "./engine.js";
import { Ledger } from "./ledger.js";
import {
  createLocalApiServer,
  HelperApiError,
  type HelperController,
  type HelperStatus,
  type LocalApiServer,
  type LoginStartResult,
  type SteamLoginState,
} from "./local-api.js";
import { maskSteamId, safeErrorMessage } from "./orders.js";
import { RelayClient, RelayHttpError } from "./relay.js";
import { loadHelperSession, savePairing, type HelperSessionFile } from "./session.js";
import { SteamClient, type QrLoginHandle } from "./steam.js";
import { deleteFile } from "./storage.js";

const ACTIVE_TRACKING_STATUSES = new Set([
  "sending",
  "sent",
  "needs_review",
  "held",
  "accepted_reported",
]);

/** Steam rotates its login QR roughly every 30 seconds; the Web asks us to refresh before then. */
const QR_ROTATE_AFTER_MS = 18_000;
/** After a scan, leave time to approve in the Steam app instead of invalidating the code. */
const QR_REMOTE_INTERACTION_GRACE_MS = 60_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export class HelperDaemon implements HelperController {
  private readonly relay: RelayClient;
  private readonly steam: SteamClient;
  private readonly ledger: Ledger;
  private readonly abort = new AbortController();

  private session: HelperSessionFile | null;
  private lastSeller: string | null;
  private api: LocalApiServer | null = null;
  private stopped = false;

  private steamState: SteamLoginState = "logged_out";
  private steamId64: string | null = null;
  private steamError: string | null = null;
  private qrDataUrl: string | null = null;
  private qrVersion = 0;
  private qrIssuedAt: string | null = null;
  private qrIssuedAtMs = 0;
  private qrRemoteInteraction = false;
  private qrRemoteInteractionAtMs = 0;
  private qrHandle: QrLoginHandle | null = null;
  private qrAttempt = 0;
  private loginStartPromise: Promise<LoginStartResult> | null = null;
  private savedLoginAttempted = false;
  private savedLoginPromise: Promise<void> | null = null;

  private profileSteamId: string | null = null;
  private profileMatches = false;
  private relayError: string | null = null;
  private recovered = false;

  constructor(
    private readonly config: HelperConfig,
    private readonly log: (message: string) => void = console.log,
  ) {
    this.relay = new RelayClient(config.relayUrl, config.requestTimeoutMs);
    this.steam = new SteamClient(config.steamSessionFile, config.qrFile);
    this.ledger = new Ledger(config.ledgerFile);
    this.session = loadHelperSession(config);
    this.lastSeller = this.session?.seller ?? null;
    if (this.session) this.relay.setToken(this.session.token);
  }

  async start(): Promise<{ port: number }> {
    if (this.api) throw new Error("helper_daemon_already_started");
    this.api = await createLocalApiServer({
      port: this.config.apiPort,
      allowedOrigins: this.config.webOrigins,
      controller: this,
    });
    this.log(`Local helper API: http://127.0.0.1:${this.api.port} (loopback only)`);
    this.log("Open the Web Sell page to scan the Steam QR; the Web auto-pairs this helper.");

    if (this.session) {
      void this.refreshProfile();
      void this.attemptSavedLogin();
    }
    void this.profileLoop();
    void this.pollLoop();
    return { port: this.api.port };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    this.cancelQrAttempt();
    await this.api?.close();
    this.api = null;
  }

  getStatus(): HelperStatus {
    return {
      paired: Boolean(this.session),
      seller: this.session?.seller ?? null,
      steam: {
        status: this.steamState,
        steamId64: this.steamId64,
        error: this.steamError,
        qrVersion: this.qrVersion,
        qrIssuedAt: this.qrIssuedAt,
        remoteInteraction: this.qrRemoteInteraction,
      },
      profile: {
        steamId64: this.profileSteamId,
        bound: Boolean(this.profileSteamId),
        matches: this.profileMatches,
      },
      relayError: this.relayError,
      polling: this.canPoll(),
    };
  }

  async pair(code: string): Promise<{ seller: string }> {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) throw new HelperApiError(422, "pairing_code_invalid");

    let paired;
    try {
      paired = await this.relay.pair(trimmed);
    } catch (error) {
      if (error instanceof RelayHttpError) {
        if (error.status === 401) throw new HelperApiError(422, "pairing_code_invalid");
        if (error.status === 504) throw new HelperApiError(504, "relay_timeout");
        if (error.status === 503) throw new HelperApiError(503, "relay_unreachable");
        throw new HelperApiError(502, error.code);
      }
      throw new HelperApiError(503, "relay_unreachable");
    }

    const previousSeller = this.lastSeller;
    if (
      this.hasActiveTracking() &&
      previousSeller &&
      previousSeller.toLowerCase() !== paired.seller.toLowerCase()
    ) {
      throw new HelperApiError(409, "helper_active_offers_other_seller");
    }

    const changedSeller =
      previousSeller && previousSeller.toLowerCase() !== paired.seller.toLowerCase();
    this.session = savePairing(this.relay, this.config, paired);
    this.lastSeller = this.session.seller;
    this.relayError = null;
    if (changedSeller) {
      this.cancelQrAttempt();
      this.profileSteamId = null;
      this.profileMatches = false;
    }
    void this.refreshProfile();
    return { seller: this.session.seller };
  }

  startLogin(): Promise<LoginStartResult> {
    if (this.steam.isLoggedIn && this.steamId64) {
      return Promise.resolve({ status: "logged_in", steamId64: this.steamId64 });
    }
    if (!this.session) return Promise.reject(new HelperApiError(409, "helper_not_paired"));
    if (this.loginStartPromise) return this.loginStartPromise;
    if (this.canReuseQr()) return Promise.resolve(this.qrResult());

    this.loginStartPromise = this.doStartLogin().finally(() => {
      this.loginStartPromise = null;
    });
    return this.loginStartPromise;
  }

  private async doStartLogin(): Promise<LoginStartResult> {
    if (!this.session) throw new HelperApiError(409, "helper_not_paired");
    if (this.steam.isLoggedIn && this.steamId64) {
      return { status: "logged_in", steamId64: this.steamId64 };
    }

    await this.attemptSavedLogin();
    if (this.steam.isLoggedIn && this.steamId64) {
      return { status: "logged_in", steamId64: this.steamId64 };
    }
    if (this.canReuseQr()) return this.qrResult();

    return this.startQrAttempt();
  }

  private canReuseQr(): boolean {
    if (!this.qrDataUrl) return false;
    const now = Date.now();
    if (this.qrRemoteInteraction) {
      return now - this.qrRemoteInteractionAtMs < QR_REMOTE_INTERACTION_GRACE_MS;
    }
    return now - this.qrIssuedAtMs < QR_ROTATE_AFTER_MS;
  }

  private qrResult(): LoginStartResult {
    if (!this.qrDataUrl) throw new HelperApiError(502, "steam_qr_not_ready");
    return {
      status: "qr",
      qrDataUrl: this.qrDataUrl,
      qrVersion: this.qrVersion,
      qrIssuedAt: this.qrIssuedAt,
      remoteInteraction: this.qrRemoteInteraction,
    };
  }

  private cancelQrAttempt(): void {
    this.qrAttempt += 1;
    this.qrHandle?.cancel();
    this.qrHandle = null;
    this.qrDataUrl = null;
    this.qrIssuedAt = null;
    this.qrIssuedAtMs = 0;
    this.qrRemoteInteraction = false;
    this.qrRemoteInteractionAtMs = 0;
  }

  private async startQrAttempt(): Promise<LoginStartResult> {
    if (!this.session) throw new HelperApiError(409, "helper_not_paired");
    this.cancelQrAttempt();
    const attempt = this.qrAttempt;
    this.steamState = "qr_pending";
    this.steamError = null;

    let handle: QrLoginHandle;
    try {
      handle = await this.steam.beginQrLogin({
        onRemoteInteraction: () => {
          if (this.qrAttempt !== attempt) return;
          this.qrRemoteInteraction = true;
          this.qrRemoteInteractionAtMs = Date.now();
          this.log("Steam QR scanned; approve the login in the Steam mobile app.");
        },
      });
    } catch (error) {
      if (this.qrAttempt === attempt) {
        this.steamState = "error";
        this.qrDataUrl = null;
        this.qrIssuedAt = null;
        this.qrIssuedAtMs = 0;
        if (error instanceof Error && error.message === "steam_already_logged_in") {
          this.steamError = "steam_login_state_conflict";
          this.log("Steam login state changed during QR start; restart the helper and retry.");
        } else {
          this.steamError = "steam_qr_start_failed";
          this.log("Could not start Steam QR login; check Steam Community connectivity and retry.");
        }
      }
      throw new HelperApiError(502, this.steamError || "steam_qr_start_failed");
    }

    if (this.qrAttempt !== attempt) {
      handle.cancel();
      throw new HelperApiError(409, "steam_login_state_conflict");
    }

    this.qrHandle = handle;
    this.qrDataUrl = handle.qrDataUrl;
    this.qrVersion += 1;
    this.qrIssuedAt = new Date().toISOString();
    this.qrIssuedAtMs = Date.now();
    this.qrRemoteInteraction = false;
    this.qrRemoteInteractionAtMs = 0;

    void handle.waitForLogin
      .then((steamId64) => {
        if (this.qrAttempt === attempt) this.onSteamLoggedIn(steamId64);
      })
      .catch((error: unknown) => {
        if (this.qrAttempt === attempt) this.onSteamLoginError(error);
      });

    return this.qrResult();
  }

  private attemptSavedLogin(): Promise<void> {
    if (this.savedLoginAttempted) return this.savedLoginPromise ?? Promise.resolve();
    this.savedLoginAttempted = true;
    this.savedLoginPromise = this.steam
      .loginWithSavedToken()
      .then((steamId64) => {
        if (steamId64) this.onSteamLoggedIn(steamId64);
      })
      .catch(() => {
        this.log("Saved local Steam login could not be used; QR login is required.");
      });
    return this.savedLoginPromise;
  }

  private onSteamLoggedIn(steamId64: string): void {
    if (this.steamState === "logged_in" && this.steamId64 === steamId64) return;
    this.qrAttempt += 1;
    this.qrHandle = null;
    this.qrDataUrl = null;
    this.qrIssuedAt = null;
    this.qrIssuedAtMs = 0;
    this.qrRemoteInteraction = false;
    this.qrRemoteInteractionAtMs = 0;
    this.steamId64 = steamId64;
    this.steamState = "logged_in";
    this.steamError = null;
    this.log(`Steam login active locally for ${maskSteamId(steamId64)}.`);
    void this.refreshProfile();
  }

  private onSteamLoginError(error: unknown): void {
    const message = error instanceof Error ? error.message : "";
    if (message === "steam_qr_canceled") return;
    const code = /^steam_[a-z_]+$/.test(message) ? message : "steam_login_failed";
    this.qrAttempt += 1;
    this.qrHandle = null;
    this.steamState = "error";
    this.steamError = code;
    this.qrDataUrl = null;
    this.qrIssuedAt = null;
    this.qrIssuedAtMs = 0;
    this.qrRemoteInteraction = false;
    this.qrRemoteInteractionAtMs = 0;
    this.log(`Steam QR login did not complete (${code}). Requesting a fresh QR.`);
  }

  private async refreshProfile(): Promise<void> {
    if (!this.session) return;
    try {
      const profile = await this.relay.getProfile();
      const previousMatches = this.profileMatches;
      this.profileSteamId = profile.steamId64;
      this.relayError = null;
      const matches = Boolean(
        this.steamId64 && this.profileSteamId && this.steamId64 === this.profileSteamId,
      );
      this.profileMatches = matches;
      if (matches && !previousMatches) {
        this.log(
          `Relay seller profile matches Steam account ${maskSteamId(this.steamId64 || "")}; offer polling enabled.`,
        );
      } else if (!matches && this.steamId64 && previousMatches) {
        this.log("Relay seller profile no longer matches the logged-in Steam account; polling stopped.");
      }
    } catch (error) {
      if (error instanceof RelayHttpError && error.status === 401) {
        this.invalidatePairing("helper_token_expired");
        return;
      }
      this.relayError = error instanceof RelayHttpError ? error.code : "relay_unreachable";
    }
  }

  private invalidatePairing(reason: string): void {
    if (!this.session) return;
    this.session = null;
    this.relay.clearToken();
    deleteFile(this.config.helperSessionFile);
    this.profileSteamId = null;
    this.profileMatches = false;
    this.relayError = reason;
    this.log(`Helper pairing is no longer valid (${reason}); re-pair from the Web Sell page.`);
  }

  private hasActiveTracking(): boolean {
    return this.ledger.all().some((entry) => ACTIVE_TRACKING_STATUSES.has(entry.status));
  }

  private canPoll(): boolean {
    return Boolean(
      !this.stopped &&
        this.session &&
        this.steam.isLoggedIn &&
        this.steamId64 &&
        this.profileMatches,
    );
  }

  private async profileLoop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      if (this.session && this.steamId64 && !this.profileMatches) {
        await this.refreshProfile();
      }
      await sleep(3_000, this.abort.signal);
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      if (this.canPoll()) {
        if (!this.recovered) {
          await recoverSendingEntries(this.relay, this.steam, this.ledger);
          this.recovered = true;
        }
        try {
          await runCycle(this.relay, this.steam, this.ledger);
        } catch (error) {
          if (error instanceof HelperTokenExpiredError) {
            this.invalidatePairing("helper_token_expired");
          } else {
            console.error(`Cycle failed; offers are not resent. ${safeErrorMessage(error)}`);
          }
        }
      }
      await sleep(this.config.pollIntervalMs, this.abort.signal);
    }
  }
}
