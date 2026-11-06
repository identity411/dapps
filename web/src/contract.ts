import { Contract, JsonRpcProvider, type Signer } from "ethers";
import { SKINPACT_ABI, ListingStatus, type Listing } from "@skinpact/shared";
import { CHAIN_ID, CONTRACT_ADDRESS, CONTRACT_CONFIGURED, RPC_URL } from "./config";

export const readProvider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });

export class ContractNotConfiguredError extends Error {
  constructor() {
    super("合约地址未配置。请先运行本地链与 npm run deploy:local，然后重启 npm run web。");
  }
}

export function getReadContract(): Contract {
  if (!CONTRACT_CONFIGURED) throw new ContractNotConfiguredError();
  return new Contract(CONTRACT_ADDRESS, SKINPACT_ABI, readProvider);
}

export function getSignerContract(signer: Signer): Contract {
  if (!CONTRACT_CONFIGURED) throw new ContractNotConfiguredError();
  return new Contract(CONTRACT_ADDRESS, SKINPACT_ABI, signer);
}

export function normalizeListing(raw: any): Listing {
  return {
    seller: String(raw.seller),
    buyer: String(raw.buyer),
    price: BigInt(raw.price),
    bond: BigInt(raw.bond),
    itemHash: String(raw.itemHash),
    offerIdHash: String(raw.offerIdHash),
    evidenceHash: String(raw.evidenceHash),
    offerDeadline: BigInt(raw.offerDeadline),
    challengeDeadline: BigInt(raw.challengeDeadline),
    status: Number(raw.status) as ListingStatus,
    deliveryDeadline: BigInt(raw.deliveryDeadline),
    disputeHash: String(raw.disputeHash),
    disputer: String(raw.disputer),
  };
}

export async function readListing(listingId: string): Promise<Listing> {
  const contract = getReadContract();
  return normalizeListing(await contract.getListing(BigInt(listingId)));
}

export interface ListingWithId {
  listingId: string;
  listing: Listing;
}

export async function readAllListings(): Promise<ListingWithId[]> {
  const contract = getReadContract();
  const next = Number(await contract.nextListingId());
  if (!Number.isSafeInteger(next) || next <= 1) return [];
  const out: ListingWithId[] = [];
  const limit = Math.min(next, 500);
  for (let id = 1; id < limit; id += 1) {
    try {
      const raw = await contract.getListing(id);
      const listing = normalizeListing(raw);
      if (listing.status !== ListingStatus.None) out.push({ listingId: String(id), listing });
    } catch {
      // Skip a listing that cannot be read; the next refresh may recover.
    }
  }
  return out.sort((a, b) => Number(BigInt(b.listingId) - BigInt(a.listingId)));
}

export async function readWithdrawable(account: string): Promise<bigint> {
  const contract = getReadContract();
  return BigInt(await contract.withdrawable(account));
}

export async function readArbiter(): Promise<string> {
  const contract = getReadContract();
  return String(await contract.arbiter());
}
