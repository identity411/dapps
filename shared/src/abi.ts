/**
 * Human-readable ABI for SkinPactMarket (S1).
 * Keep in sync with contracts/contracts/SkinPactMarket.sol.
 */
export const SKINPACT_ABI = [
  "function createListing(bytes32 itemHash, uint256 price) payable returns (uint256)",
  "function buy(uint256 listingId) payable",
  "function markOfferSent(uint256 listingId, bytes32 offerIdHash)",
  "function confirmReceipt(uint256 listingId)",
  "function claimAccepted(uint256 listingId, bytes32 evidenceHash)",
  "function finalizeClaim(uint256 listingId)",
  "function expireOrder(uint256 listingId)",
  "function withdraw()",
  "function quoteBond(uint256 price) view returns (uint256)",
  "function getListing(uint256 listingId) view returns (tuple(address seller, address buyer, uint256 price, uint256 bond, bytes32 itemHash, bytes32 offerIdHash, bytes32 evidenceHash, uint64 offerDeadline, uint64 challengeDeadline, uint8 status))",
  "function withdrawable(address account) view returns (uint256)",
  "function activeItemHash(bytes32 itemHash) view returns (uint256)",
  "function usedOfferIdHash(bytes32 offerIdHash) view returns (bool)",
  "function nextListingId() view returns (uint256)",
  "function maxPrice() view returns (uint256)",
  "function minBond() view returns (uint256)",
  "function offerWindow() view returns (uint64)",
  "function challengeWindow() view returns (uint64)",
  "event ListingCreated(uint256 indexed listingId, address indexed seller, bytes32 indexed itemHash, uint256 price, uint256 bond)",
  "event ListingBought(uint256 indexed listingId, address indexed buyer, uint256 price)",
  "event OfferMarked(uint256 indexed listingId, bytes32 offerIdHash)",
  "event ReceiptConfirmed(uint256 indexed listingId, address indexed buyer)",
  "event ClaimAccepted(uint256 indexed listingId, bytes32 evidenceHash, uint64 challengeDeadline)",
  "event ClaimFinalized(uint256 indexed listingId)",
  "event OrderExpired(uint256 indexed listingId)",
  "event Withdrawn(address indexed account, uint256 amount)",
] as const;
