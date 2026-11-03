export enum ListingStatus {
  None = 0,
  Active = 1,
  Funded = 2,
  OfferSent = 3,
  ClaimPending = 4,
  Completed = 5,
  Refunded = 6,
}

export interface Listing {
  seller: string;
  buyer: string;
  price: bigint;
  bond: bigint;
  itemHash: string;
  offerIdHash: string;
  evidenceHash: string;
  offerDeadline: bigint;
  challengeDeadline: bigint;
  status: ListingStatus;
}

export interface ItemMetadata {
  sellerSteamId: string;
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  inspectLink?: string;
  imageUrl?: string;
}

export interface StoredItem extends ItemMetadata {
  itemHash: string;
  preparedAt: string;
  verified: boolean;
}

export interface OfferEvidence {
  listingId: string;
  tradeOfferId: string;
  state: 3;
  observedAt: string;
  sellerSteamId: string;
  buyerSteamId: string;
  items: Array<{
    assetId: string;
    classId: string;
    instanceId: string;
    marketHashName?: string;
  }>;
}

export interface HelperOrder {
  listingId: string;
  seller: string;
  buyer: string;
  sellerSteamId: string;
  buyerSteamId: string;
  buyerTradeUrl: string;
  item: ItemMetadata;
  price: string;
  bond: string;
  offerDeadline: number;
}
