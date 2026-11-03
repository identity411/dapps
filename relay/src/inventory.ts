import SteamCommunity from "steamcommunity";
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

function toItem(raw: any): SteamItem | null {
  const assetId = String(raw.assetid ?? raw.id ?? "");
  const classId = String(raw.classid ?? "");
  const instanceId = String(raw.instanceid ?? "");
  const marketHashName = String(raw.market_hash_name ?? raw.market_name ?? "");
  if (!assetId || !classId || !instanceId || !marketHashName) return null;
  const icon = raw.icon_url ? String(raw.icon_url) : "";
  return {
    assetId,
    classId,
    instanceId,
    marketHashName,
    ...(icon
      ? { imageUrl: `https://community.cloudflare.steamstatic.com/economy/image/${icon}/360fx360f` }
      : {}),
    ...(raw.inspect_link ? { inspectLink: String(raw.inspect_link) } : {}),
  };
}

export class SteamInventoryProvider implements InventoryProvider {
  private readonly community = new SteamCommunity();

  async getInventory(steamId64: string): Promise<SteamItem[]> {
    const items = await new Promise<any[]>((resolve, reject) => {
      this.community.getUserInventoryContents(
        steamId64,
        CS2_APP_ID,
        CS2_CONTEXT_ID,
        true,
        (err: Error | null, inventory: any[]) => {
          if (err) reject(err);
          else resolve(inventory);
        },
      );
    });
    return items.map(toItem).filter((item): item is SteamItem => Boolean(item));
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
