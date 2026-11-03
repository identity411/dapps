declare module "steamcommunity" {
  export default class SteamCommunity {
    getUserInventoryContents(
      steamId64: string,
      appId: number,
      contextId: string,
      tradableOnly: boolean,
      callback: (err: Error | null, items: any[]) => void,
    ): void;
  }
}
