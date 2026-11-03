import { canonicalHash } from "./canonical.js";
import type { ItemMetadata, OfferEvidence } from "./types.js";

/** Canonical hash shared by Relay, helper and web. */
export function itemHash(item: ItemMetadata): string {
  return canonicalHash({
    sellerSteamId: String(item.sellerSteamId),
    assetId: String(item.assetId),
    classId: String(item.classId),
    instanceId: String(item.instanceId),
    marketHashName: String(item.marketHashName),
  });
}

export function offerIdHash(tradeOfferId: string | number | bigint): string {
  return canonicalHash(String(tradeOfferId));
}

export function evidenceHash(evidence: OfferEvidence): string {
  return canonicalHash(evidence);
}
