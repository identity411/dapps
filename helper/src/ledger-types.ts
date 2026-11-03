export type LedgerStatus =
  | "sending"
  | "sent"
  | "accepted_reported"
  | "held"
  | "failed"
  | "blocked"
  | "needs_review";

/**
 * Local helper ledger. NEVER put a Buyer Trade URL or Steam session here.
 * Buyer/seller SteamIDs and trade offer IDs are not bearer secrets, but are still local-only.
 */
export interface LedgerEntry {
  listingId: string;
  status: LedgerStatus;
  tradeOfferId?: string;
  offerIdHash?: string;
  offerReported: boolean;
  evidenceHash?: string;
  buyerSteamId?: string;
  assetId?: string;
  lastState?: number;
  note?: string;
  updatedAt?: string;
}
