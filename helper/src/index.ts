import fs from "node:fs";
import path from "node:path";
import { loadHelperConfig, type HelperConfig } from "./config.js";
import { HelperDaemon } from "./daemon.js";
import { HelperTokenExpiredError, recoverSendingEntries, runCycle } from "./engine.js";
import { Ledger } from "./ledger.js";
import { HelperApiError } from "./local-api.js";
import { maskSteamId, safeErrorMessage } from "./orders.js";
import { RelayClient, RelayHttpError } from "./relay.js";
import {
  loadHelperSession,
  pairAndSave,
  type HelperSessionFile,
} from "./session.js";
import { SteamClient, prompt } from "./steam.js";
import { ensureStateDir } from "./storage.js";

interface CliOptions {
  pairCode: string | null;
  check: boolean;
  help: boolean;
  once: boolean;
  cli: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pairCode: null,
    check: false,
    help: false,
    once: false,
    cli: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--cli") options.cli = true;
    else if (arg === "--pair") {
      options.pairCode = argv[i + 1] || null;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.once || options.pairCode) options.cli = true;
  return options;
}

function usage(): void {
  console.log(`SkinPact S1 seller-local helper

Usage:
  npm run helper                 # local daemon: the Web Sell page shows the Steam QR
  npm run helper -- --cli        # legacy terminal QR/pairing flow
  npm run helper -- --pair 123456
  npm run helper -- --check      # validate local config/state only; no Steam login
  npm run helper -- --once       # legacy: run one polling cycle and exit

The helper uses the SELLER's own Steam login state. The Web talks to it only on
127.0.0.1; the pairing code is exchanged invisibly by the Web. It never receives
the seller's Ethereum private key, never signs chain transactions, never accepts
on the buyer's behalf, and never stores the Buyer Trade URL on disk.`);
}

async function ensureAccess(
  relay: RelayClient,
  config: HelperConfig,
  options: CliOptions,
): Promise<{ session: HelperSessionFile; profile: { seller: string; steamId64: string | null } }> {
  let session = loadHelperSession(config);
  if (session) {
    relay.setToken(session.token);
    try {
      const profile = await relay.getProfile();
      if (!profile.steamId64) {
        throw new Error(
          "Seller has no SteamID binding in Relay. Open the Web app, bind the seller profile, then rerun.",
        );
      }
      return { session, profile };
    } catch (error) {
      if (error instanceof RelayHttpError && error.status === 401) {
        console.warn("Saved helper token is invalid/expired; re-pairing is required.");
        session = null;
      } else {
        throw error;
      }
    }
  }

  const code = options.pairCode || config.pairingCodeFromEnv;
  if (!code) {
    const entered = await prompt(
      "Paste the 6-digit pairing code from the SkinPact Web seller page: ",
    );
    session = await pairAndSave(relay, config, entered);
  } else {
    session = await pairAndSave(relay, config, code);
  }

  const profile = await relay.getProfile();
  if (!profile.steamId64) {
    throw new Error(
      "Seller has no SteamID binding in Relay. Open the Web app, bind the seller profile, then rerun.",
    );
  }
  return { session, profile };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDaemon(config: HelperConfig): Promise<void> {
  const daemon = new HelperDaemon(config);
  await daemon.start();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received. Stopping the helper; no new offers will be sent.`);
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("Helper is ready. Keep this terminal open while selling.");
  await new Promise<void>(() => {
    // Keep the daemon process alive until a signal stops it.
  });
}

async function runLegacyCli(config: HelperConfig, options: CliOptions): Promise<void> {
  const relay = new RelayClient(config.relayUrl, config.requestTimeoutMs);
  const { session, profile } = await ensureAccess(relay, config, options);
  console.log(`Helper seller address: ${session.seller}`);
  console.log(`Relay: ${config.relayUrl}`);
  console.log(`Seller SteamID64: ${maskSteamId(profile.steamId64 || "")}`);

  const steam = new SteamClient(config.steamSessionFile, config.qrFile);
  const loggedInSteamId = await steam.login();
  if (loggedInSteamId !== profile.steamId64) {
    throw new Error(
      `Steam login is ${maskSteamId(loggedInSteamId)}, but Relay seller profile is ${maskSteamId(profile.steamId64 || "")}. Refusing to send offers; log into the seller Steam account and retry.`,
    );
  }
  console.log(`Logged into seller Steam account: ${maskSteamId(loggedInSteamId)}`);

  const ledger = new Ledger(config.ledgerFile);
  await recoverSendingEntries(relay, steam, ledger);

  let running = true;
  const stop = () => {
    running = false;
    console.log("\nStopping helper after the current cycle. No new offers will be sent.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  do {
    try {
      await runCycle(relay, steam, ledger);
    } catch (error) {
      if (error instanceof HelperTokenExpiredError) {
        throw new Error("helper_token_expired; run the helper again to pair with the Web page");
      }
      console.error(`Cycle failed; offers are not resent. ${safeErrorMessage(error)}`);
    }
    if (options.once) break;
    if (running) await sleep(config.pollIntervalMs);
  } while (running);

  console.log(`Local ledger: ${config.ledgerFile} (no Buyer Trade URLs stored).`);
  if (fs.existsSync(path.join(config.stateDir, "login-qr.svg"))) {
    console.warn(`Unremoved QR file exists at ${config.qrFile}; delete it after login if needed.`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const config = loadHelperConfig();
  ensureStateDir(config.stateDir);

  if (options.check) {
    const session = loadHelperSession(config);
    console.log("Local helper config valid.");
    console.log(`Relay: ${config.relayUrl}`);
    console.log(`Local API: http://127.0.0.1:${config.apiPort}`);
    console.log(`State dir: ${config.stateDir}`);
    console.log(`Helper token: ${session ? "present (not printed)" : "absent"}`);
    console.log("--check did not contact Relay or Steam.");
    return;
  }

  if (options.cli) await runLegacyCli(config, options);
  else await runDaemon(config);
}

main().catch((error) => {
  if (error instanceof HelperApiError && error.code === "helper_api_port_in_use") {
    console.error(
      "Helper stopped: the local helper API port is already in use. Stop the other helper, or set HELPER_API_PORT.",
    );
    process.exitCode = 1;
    return;
  }
  console.error(`Helper stopped: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
