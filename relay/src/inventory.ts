import { Agent, request as httpsRequest } from "node:https";
import { CS2_APP_ID, CS2_CONTEXT_ID } from "@skinpact/shared";

export interface SteamItem {
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  inspectLink?: string;
  imageUrl?: string;
}

export interface InventoryProvider {
  getInventory(steamId64: string): Promise<SteamItem[]>;
}

interface InventoryAsset {
  assetid?: string | number;
  classid?: string | number;
  instanceid?: string | number;
  amount?: string | number;
}

interface InventoryAction {
  link?: string;
}

interface InventoryDescription {
  classid?: string | number;
  instanceid?: string | number;
  market_hash_name?: string;
  market_name?: string;
  icon_url?: string;
  tradable?: number | boolean;
  inspect_link?: string;
  actions?: InventoryAction[];
  market_actions?: InventoryAction[];
}

export interface SteamInventoryPage {
  success?: number | boolean;
  assets?: InventoryAsset[];
  descriptions?: InventoryDescription[];
  more_items?: number | boolean;
  last_assetid?: string;
  total_inventory_count?: number;
}

export type SteamInventoryPageFetcher = (
  steamId64: string,
  startAssetId?: string,
) => Promise<SteamInventoryPage>;

const MAX_PAGES = 50;
const PAGE_SIZE = 1000;

class InventoryHttpError extends Error {
  constructor(readonly status: number) {
    super(`Steam inventory request failed with HTTP ${status}`);
    this.name = "InventoryHttpError";
  }
}

function descriptionKey(classId: string, instanceId: string): string {
  return `${classId}_${instanceId}`;
}

function toItem(
  asset: InventoryAsset,
  description: InventoryDescription | undefined,
): SteamItem | null {
  if (!description || !description.tradable) return null;
  const assetId = String(asset.assetid ?? "");
  const classId = String(asset.classid ?? description.classid ?? "");
  const instanceId = String(asset.instanceid ?? description.instanceid ?? "0");
  const marketHashName = String(
    description.market_hash_name ?? description.market_name ?? "",
  );
  if (!assetId || !classId || !marketHashName) return null;
  const icon = description.icon_url ? String(description.icon_url) : "";
  return {
    assetId,
    classId,
    instanceId,
    marketHashName,
    ...(icon
      ? { imageUrl: `https://community.cloudflare.steamstatic.com/economy/image/${icon}/360fx360f` }
      : {}),
    ...(description.inspect_link ? { inspectLink: String(description.inspect_link) } : {}),
  };
}

function parsePage(page: SteamInventoryPage): SteamItem[] {
  const descriptions = new Map<string, InventoryDescription>();
  for (const description of page.descriptions ?? []) {
    descriptions.set(
      descriptionKey(
        String(description.classid ?? ""),
        String(description.instanceid ?? "0"),
      ),
      description,
    );
  }

  const items: SteamItem[] = [];
  for (const asset of page.assets ?? []) {
    const description = descriptions.get(
      descriptionKey(String(asset.classid ?? ""), String(asset.instanceid ?? "0")),
    );
    const item = toItem(asset, description);
    if (item) items.push(item);
  }
  return items;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof InventoryHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestInventoryPage(
  steamId64: string,
  startAssetId?: string,
): Promise<SteamInventoryPage> {
  const url = new URL(
    `https://steamcommunity.com/inventory/${steamId64}/${CS2_APP_ID}/${CS2_CONTEXT_ID}`,
  );
  url.searchParams.set("l", "english");
  url.searchParams.set("count", String(PAGE_SIZE));
  if (startAssetId) url.searchParams.set("start_assetid", startAssetId);

  return new Promise<SteamInventoryPage>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        agent: new Agent({ keepAlive: false }),
        timeout: 8_000,
        headers: {
          // Steam's inventory endpoint returns 429 for the default Node client
          // fingerprint. A browser-like request matches what the profile page uses.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `https://steamcommunity.com/profiles/${steamId64}/inventory`,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 8_000_000) {
            request.destroy(new Error("Steam inventory response is too large"));
          }
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            reject(new InventoryHttpError(status));
            return;
          }
          try {
            resolve(JSON.parse(body) as SteamInventoryPage);
          } catch {
            reject(new Error("Steam returned an invalid inventory response"));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Steam inventory request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchPageWithRetry(
  steamId64: string,
  startAssetId?: string,
): Promise<SteamInventoryPage> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestInventoryPage(steamId64, startAssetId);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 1) break;
      await delay(500);
    }
  }
  throw lastError;
}

export class SteamInventoryProvider implements InventoryProvider {
  constructor(private readonly fetchPage: SteamInventoryPageFetcher = fetchPageWithRetry) {}

  async getInventory(steamId64: string): Promise<SteamItem[]> {
    const items: SteamItem[] = [];
    const seenAssetIds = new Set<string>();
    let startAssetId: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const page = await this.fetchPage(steamId64, startAssetId);
      if (page.success !== true && page.success !== 1) {
        throw new Error("Steam inventory response was not successful");
      }

      const pageItems = parsePage(page);
      for (const item of pageItems) {
        if (seenAssetIds.has(item.assetId)) continue;
        seenAssetIds.add(item.assetId);
        items.push(item);
      }

      if (!page.more_items || !page.last_assetid || page.last_assetid === startAssetId) break;
      startAssetId = page.last_assetid;
    }

    return items;
  }
}

export function findInventoryItem(
  items: SteamItem[],
  assetId: string,
  classId?: string,
  instanceId?: string,
): SteamItem | undefined {
  return items.find((item) => {
    if (item.assetId !== assetId) return false;
    if (classId && item.classId !== classId) return false;
    if (instanceId && item.instanceId !== instanceId) return false;
    return true;
  });
}
