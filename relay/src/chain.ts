import { Contract, JsonRpcProvider, type Provider } from "ethers";
import { SKINPACT_ABI, ListingStatus, type Listing } from "@skinpact/shared";

export interface ChainReader {
  getListing(listingId: string): Promise<Listing>;
  findFundedBySeller(seller: string): Promise<Array<{ listingId: string; listing: Listing }>>;
}

function normalizeListing(raw: any): Listing {
  return {
    seller: String(raw.seller).toLowerCase(),
    buyer: String(raw.buyer).toLowerCase(),
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
    disputer: String(raw.disputer).toLowerCase(),
  };
}

export class EthersChain implements ChainReader {
  private readonly contract: Contract;

  constructor(
    private readonly provider: Provider,
    address: string,
    private readonly deploymentBlock = 0,
  ) {
    this.contract = new Contract(address, SKINPACT_ABI, provider);
  }

  static fromRpc(rpcUrl: string, address: string, deploymentBlock = 0): EthersChain {
    const provider = new JsonRpcProvider(rpcUrl);
    return new EthersChain(provider, address, deploymentBlock);
  }

  async getListing(listingId: string): Promise<Listing> {
    const raw = await (this.contract as any).getListing(BigInt(listingId));
    return normalizeListing(raw);
  }

  async findFundedBySeller(seller: string): Promise<Array<{ listingId: string; listing: Listing }>> {
    // Event filters are dynamically generated on ethers Contract instances.
    const contract = this.contract as any;
    const filter = contract.filters.ListingCreated(null, seller);
    const events = await contract.queryFilter(filter, this.deploymentBlock, "latest");
    const ids: string[] = [
      ...new Set<string>(
        events.map((event: any) => String(event.args?.listingId)).filter(Boolean),
      ),
    ];
    const out: Array<{ listingId: string; listing: Listing }> = [];
    for (const id of ids) {
      const listing = await this.getListing(id);
      if (
        listing.status === ListingStatus.Funded &&
        listing.seller.toLowerCase() === seller.toLowerCase()
      ) {
        out.push({ listingId: id, listing });
      }
    }
    return out;
  }
}

export function makeProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl);
}
