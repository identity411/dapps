/**
 * Sepolia smoke + gas capture.
 *
 * Runs a minimal on-chain flow directly against the deployed contract:
 *   create -> buy -> mark -> confirm
 *   create -> cancel
 *   (optional) create -> buy -> mark -> openDispute -> resolveDispute
 *
 * Steam/Relay/helper are NOT involved. The Steam delivery demo is separate.
 * This script only reads public addresses and tx hashes; private keys stay in
 * the local env file and are never written to the output.
 *
 * Usage:
 *   set -a; source .env.sepolia; set +a
 *   npm run smoke:sepolia
 *
 * Required env: SEPOLIA_RPC_URL, SMOKE_SELLER_PRIVATE_KEY, SMOKE_BUYER_PRIVATE_KEY.
 * Optional: SMOKE_PRICE_ETH (default 0.01), ARBITER_PRIVATE_KEY (dispute smoke),
 *           SKINPACT_ENV_FILE (default ".env"), SEPOLIA_DEPLOYMENT.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  parseEther,
  type ContractTransactionResponse,
} from "ethers";
import { SKINPACT_ABI } from "@skinpact/shared";

const SEPOLIA_CHAIN_ID = 11155111n;

try {
  process.loadEnvFile(process.env.SKINPACT_ENV_FILE || ".env");
} catch {
  // Shell-provided env is also fine; required values are checked below.
}

function required(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface Deployment {
  chainId: number;
  address: string;
  blockNumber?: number;
  arbiter?: string;
}

interface TxRecord {
  step: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  gasPrice: string;
  feeWei: string;
}

async function main(): Promise<void> {
  const deploymentPath = path.resolve(
    process.env.SEPOLIA_DEPLOYMENT || "deployments/sepolia.json",
  );
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `Missing ${deploymentPath}. Deploy first with "npm run deploy:sepolia".`,
    );
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  if (deployment.chainId !== Number(SEPOLIA_CHAIN_ID)) {
    throw new Error(`Deployment chainId must be ${SEPOLIA_CHAIN_ID}, got ${deployment.chainId}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.address || "")) {
    throw new Error("deployments/sepolia.json has no valid contract address");
  }

  const provider = new JsonRpcProvider(required("SEPOLIA_RPC_URL"));
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is not Sepolia: expected ${SEPOLIA_CHAIN_ID}, got ${network.chainId}`);
  }

  const seller = new Wallet(required("SMOKE_SELLER_PRIVATE_KEY"), provider);
  const buyer = new Wallet(required("SMOKE_BUYER_PRIVATE_KEY"), provider);
  const arbiterKey = (process.env.ARBITER_PRIVATE_KEY || "").trim();
  const arbiter = arbiterKey ? new Wallet(arbiterKey, provider) : null;

  const sellerBalance = await provider.getBalance(seller.address);
  const buyerBalance = await provider.getBalance(buyer.address);
  if (sellerBalance === 0n) throw new Error(`Seller ${seller.address} has 0 Sepolia ETH`);
  if (buyerBalance === 0n) throw new Error(`Buyer ${buyer.address} has 0 Sepolia ETH`);

  // Dynamic contract handle: ethers v6 types the index signature as possibly
  // undefined, so use any for the smoke-script method calls.
  const contract: any = new Contract(deployment.address, SKINPACT_ABI, provider);
  const sellerMarket: any = contract.connect(seller);
  const buyerMarket: any = contract.connect(buyer);

  const maxPrice = BigInt(await contract.maxPrice());
  const price = parseEther(process.env.SMOKE_PRICE_ETH || "0.01");
  if (price <= 0n || price > maxPrice) {
    throw new Error(`SMOKE_PRICE_ETH must be > 0 and <= maxPrice ${maxPrice.toString()}`);
  }
  const bond = BigInt(await contract.quoteBond(price));

  const records: TxRecord[] = [];

  async function send(
    step: string,
    txPromise: Promise<ContractTransactionResponse>,
  ): Promise<void> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`${step}: transaction was not mined`);
    const gasPrice = BigInt(receipt.gasPrice ?? tx.gasPrice ?? 0n);
    const feeWei = BigInt(receipt.gasUsed) * gasPrice;
    records.push({
      step,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: gasPrice.toString(),
      feeWei: feeWei.toString(),
    });
    console.log(`${step}: ${tx.hash} (gas ${receipt.gasUsed.toString()})`);
  }

  async function nextListingId(): Promise<bigint> {
    return BigInt(await contract.nextListingId()) - 1n;
  }

  console.log(`Contract: ${deployment.address}`);
  console.log(`Seller: ${seller.address}`);
  console.log(`Buyer: ${buyer.address}`);
  console.log(`Price: ${price.toString()} wei; bond: ${bond.toString()} wei`);

  // 1) Happy path: create -> buy -> mark -> confirm.
  const itemHash = keccak256(randomBytes(32));
  await send(
    "createListing",
    sellerMarket.createListing(itemHash, price, { value: bond }),
  );
  const listingId = await nextListingId();
  await send("buy", buyerMarket.buy(listingId, { value: price }));
  const offerHash = keccak256(randomBytes(32));
  await send("markOfferSent", sellerMarket.markOfferSent(listingId, offerHash));
  await send("confirmReceipt", buyerMarket.confirmReceipt(listingId));

  // 2) Cancel an unsold Active listing.
  const cancelItemHash = keccak256(randomBytes(32));
  await send(
    "createListing(cancel)",
    sellerMarket.createListing(cancelItemHash, price, { value: bond }),
  );
  const cancelListingId = await nextListingId();
  await send("cancelListing", sellerMarket.cancelListing(cancelListingId));

  // 3) Optional dispute path: buyer wins, bond is slashed to the buyer.
  const onChainArbiter = String(await contract.arbiter());
  if (arbiter && onChainArbiter.toLowerCase() === arbiter.address.toLowerCase()) {
    const arbiterMarket: any = contract.connect(arbiter);
    const disputeItemHash = keccak256(randomBytes(32));
    await send(
      "createListing(dispute)",
      sellerMarket.createListing(disputeItemHash, price, { value: bond }),
    );
    const disputeListingId = await nextListingId();
    await send("buy(dispute)", buyerMarket.buy(disputeListingId, { value: price }));
    await send(
      "markOfferSent(dispute)",
      sellerMarket.markOfferSent(disputeListingId, keccak256(randomBytes(32))),
    );
    await send(
      "openDispute",
      buyerMarket.openDispute(disputeListingId, keccak256(randomBytes(32))),
    );
    await send(
      "resolveDispute(buyerWins+slash)",
      arbiterMarket.resolveDispute(disputeListingId, false, true),
    );
  } else {
    console.log(
      "Skipping dispute smoke: ARBITER_PRIVATE_KEY missing or does not match arbiter().",
    );
  }

  const outDir = path.resolve("experiments", "e1");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "sepolia-smoke.json");
  const payload = {
    generatedAt: new Date().toISOString(),
    network: "sepolia",
    chainId: Number(network.chainId),
    contract: deployment.address,
    deploymentBlock: deployment.blockNumber ?? null,
    seller: seller.address,
    buyer: buyer.address,
    arbiter: onChainArbiter,
    priceWei: price.toString(),
    bondWei: bond.toString(),
    transactions: records,
  };
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`\nWrote ${records.length} transactions to ${outFile}`);
  console.log("Steam/Relay/helper were not used in this smoke run.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
