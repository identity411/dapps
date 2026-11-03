import type { HelperConfig } from "./config.js";
import type { PairResult, RelayClient } from "./relay.js";
import { readJsonFile, writeJsonFileSecure } from "./storage.js";

export interface HelperSessionFile {
  token: string;
  seller: string;
  savedAt: string;
}

export function loadHelperSession(config: HelperConfig): HelperSessionFile | null {
  try {
    const data = readJsonFile<HelperSessionFile>(config.helperSessionFile);
    if (!data || typeof data.token !== "string" || typeof data.seller !== "string") return null;
    if (!data.token.startsWith("sp_helper_")) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePairing(
  relay: RelayClient,
  config: HelperConfig,
  paired: PairResult,
): HelperSessionFile {
  relay.setToken(paired.token);
  const session: HelperSessionFile = {
    token: paired.token,
    seller: paired.seller,
    savedAt: new Date().toISOString(),
  };
  writeJsonFileSecure(config.helperSessionFile, session);
  console.log(`Paired with seller ${paired.seller} (helper token saved locally, 600).`);
  return session;
}

export async function pairAndSave(
  relay: RelayClient,
  config: HelperConfig,
  code: string,
): Promise<HelperSessionFile> {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) throw new Error("pairing code must be 6 digits");
  const paired = await relay.pair(trimmed);
  return savePairing(relay, config, paired);
}
