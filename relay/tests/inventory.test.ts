import assert from "node:assert/strict";
import test from "node:test";
import {
  SteamInventoryProvider,
  type SteamInventoryPage,
  type SteamInventoryPageFetcher,
} from "../src/inventory.js";

const SELLER_STEAM_ID = "76561198000000001";

function page(overrides: Partial<SteamInventoryPage> = {}): SteamInventoryPage {
  return {
    success: true,
    assets: [],
    descriptions: [],
    ...overrides,
  };
}

function description(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    classid: "111",
    instanceid: "222",
    market_hash_name: "AK-47 | Redline (Field-Tested)",
    icon_url: "icon-hash",
    tradable: 1,
    ...overrides,
  };
}

test("inventory maps tradable assets and skips non-tradable ones", async () => {
  const provider = new SteamInventoryProvider(async () =>
    page({
      assets: [
        { assetid: "1001", classid: "111", instanceid: "222", amount: "1" },
        { assetid: "1002", classid: "333", instanceid: "0", amount: "1" },
        { assetid: "1003", classid: "444", instanceid: "0", amount: "1" },
      ],
      descriptions: [
        description(),
        description({
          classid: "333",
          instanceid: "0",
          market_hash_name: "Sticker | Crown (Foil)",
        }),
        description({
          classid: "444",
          instanceid: "0",
          market_hash_name: "Tradelocked Item",
          tradable: 0,
        }),
      ],
    }),
  );

  const items = await provider.getInventory(SELLER_STEAM_ID);
  assert.deepEqual(
    items.map((item) => ({
      assetId: item.assetId,
      classId: item.classId,
      instanceId: item.instanceId,
      marketHashName: item.marketHashName,
    })),
    [
      {
        assetId: "1001",
        classId: "111",
        instanceId: "222",
        marketHashName: "AK-47 | Redline (Field-Tested)",
      },
      {
        assetId: "1002",
        classId: "333",
        instanceId: "0",
        marketHashName: "Sticker | Crown (Foil)",
      },
    ],
  );
  assert.equal(
    items[0]?.imageUrl,
    "https://community.cloudflare.steamstatic.com/economy/image/icon-hash/360fx360f",
  );
});

test("inventory follows pagination and de-duplicates assets", async () => {
  const calls: Array<string | undefined> = [];
  const pages = [
    page({
      assets: [{ assetid: "1001", classid: "111", instanceid: "222" }],
      descriptions: [description()],
      more_items: 1,
      last_assetid: "1001",
    }),
    page({
      assets: [
        { assetid: "1001", classid: "111", instanceid: "222" },
        { assetid: "1002", classid: "111", instanceid: "222" },
      ],
      descriptions: [description()],
    }),
  ];
  const fetcher: SteamInventoryPageFetcher = async (_steamId64, startAssetId) => {
    calls.push(startAssetId);
    const next = pages.shift();
    assert.ok(next, "unexpected extra inventory page request");
    return next;
  };

  const items = await new SteamInventoryProvider(fetcher).getInventory(SELLER_STEAM_ID);
  assert.deepEqual(
    items.map((item) => item.assetId),
    ["1001", "1002"],
  );
  assert.deepEqual(calls, [undefined, "1001"]);
});

test("inventory stops when Steam omits more_items", async () => {
  // last_assetid without more_items means the page is complete.
  const provider = new SteamInventoryProvider(async () =>
    page({
      assets: [{ assetid: "1001", classid: "111", instanceid: "222" }],
      descriptions: [description()],
      last_assetid: "1001",
    }),
  );

  const items = await provider.getInventory(SELLER_STEAM_ID);
  assert.equal(items.length, 1);
});

test("inventory rejects an unsuccessful Steam page", async () => {
  const provider = new SteamInventoryProvider(async () => page({ success: false }));

  await assert.rejects(() => provider.getInventory(SELLER_STEAM_ID), /not successful/);
});
