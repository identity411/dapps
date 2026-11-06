/**
 * E1 completion smoke on Sepolia.
 *
 * The original 2026-11-06 smoke covered 7 unique operations. This script adds
 * the four missing ones:
 *   claimAccepted -> finalizeClaim
 *   expireOrder
 *   withdraw
 *
 * It deliberately reuses the existing verified contract and its real windows
 * (offerWindow 600 s, challengeWindow 300 s), so the run waits ~10 minutes.
 * Steam/Relay/helper are not involved. Private keys are read from .env and are
 * never written to the output.
 *
 * Usage:
 *   npm run smoke:sepolia:e1
 *
 * Output:
 *   experiments/e1/sepolia-smoke-missing.json
 *
 * Required env: SEPOLIA_RPC_URL, SMOKE_SELLER_PRIVATE_KEY, SMOKE_BUYER_PRIVATE_KEY.
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
const PRICE = parseEther("0.01");
const WAIT_BUFFER_SECONDS = 10;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  if (deployment.chainId !== Number(SEPOLIA_CHAIN_ID)) {
    throw new Error(`Deployment chainId must be ${SEPOLIA_CHAIN_ID}`);
  }

  const provider = new JsonRpcProvider(required("SEPOLIA_RPC_URL"));
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is not Sepolia: got ${network.chainId}`);
  }

  const seller = new Wallet(required("SMOKE_SELLER_PRIVATE_KEY"), provider);
  const buyer = new Wallet(required("SMOKE_BUYER_PRIVATE_KEY"), provider);
  const contract: any = new Contract(deployment.address, SKINPACT_ABI, provider);
  const sellerMarket: any = contract.connect(seller);
  const buyerMarket: any = contract.connect(buyer);

  const bond = BigInt(await contract.quoteBond(PRICE));
  const offerWindow = Number(await contract.offerWindow());
  const challengeWindow = Number(await contract.challengeWindow());
  const deliveryWindow = Number(await contract.deliveryWindow());
  const sellerBalance = await provider.getBalance(seller.address);
  const buyerBalance = await provider.getBalance(buyer.address);
  console.log(`Contract: ${deployment.address}`);
  console.log(`Seller: ${seller.address} (${sellerBalance.toString()} wei)`);
  console.log(`Buyer:  ${buyer.address} (${buyerBalance.toString()} wei)`);
  console.log(`Price:  ${PRICE.toString()} wei; bond: ${bond.toString()} wei`);
  console.log(`Windows: offer ${offerWindow}s, challenge ${challengeWindow}s, delivery ${deliveryWindow}s`);

  // Two buys are needed (claim path + expiry path); check before sending.
  if (buyerBalance < PRICE * 2n) {
    throw new Error(`Buyer needs at least ${(PRICE * 2n).toString()} wei for two buys`);
  }
  if (sellerBalance < bond * 3n) {
    throw new Error(`Seller needs at least ${(bond * 3n).toString()} wei for three bonds`);
  }

  const records: TxRecord[] = [];
  async function send(step: string, txPromise: Promise<ContractTransactionResponse>): Promise<void> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`${step}: not mined`);
    const gasPrice = BigInt(receipt.gasPrice ?? 0n);
    records.push({
      step,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: gasPrice.toString(),
      feeWei: (BigInt(receipt.gasUsed) * gasPrice).toString(),
    });
    console.log(`${step}: ${tx.hash} (gas ${receipt.gasUsed.toString()}, block ${receipt.blockNumber})`);
  }

  async function nextListingId(): Promise<bigint> {
    return BigInt(await contract.nextListingId()) - 1n;
  }

  async function waitForDeadline(label: string, deadline: bigint): Promise<void> {
    const target = deadline + BigInt(WAIT_BUFFER_SECONDS);
    for (;;) {
      const block = await provider.getBlock("latest");
      const now = BigInt(block?.timestamp ?? 0);
      if (now >= target) {
        console.log(`${label}: deadline reached (block timestamp ${now.toString()})`);
        return;
      }
      const remaining = Number(target - now);
      const sleepSeconds = Math.min(15, Math.max(1, remaining));
      console.log(`${label}: waiting ~${remaining}s for deadline...`);
      await sleep(sleepSeconds * 1000);
    }
  }

  // -----------------------------------------------------------------------
  // 1) Expiry path. Start this first because its offer window is 600 s.
  // -----------------------------------------------------------------------
  const expiryItemHash = keccak256(randomBytes(32));
  await send(
    "createListing(expiry)",
    sellerMarket.createListing(expiryItemHash, PRICE, { value: bond }),
  );
  const expiryId = await nextListingId();
  await send("buy(expiry)", buyerMarket.buy(expiryId, { value: PRICE }));

  // -----------------------------------------------------------------------
  // 2) Claim path: create -> buy -> mark -> claimAccepted.
  // -----------------------------------------------------------------------
  const claimItemHash = keccak256(randomBytes(32));
  await send(
    "createListing(claim)",
    sellerMarket.createListing(claimItemHash, PRICE, { value: bond }),
  );
  const claimId = await nextListingId();
  await send("buy(claim)", buyerMarket.buy(claimId, { value: PRICE }));
  await send("markOfferSent(claim)", sellerMarket.markOfferSent(claimId, keccak256(randomBytes(32))));
  await send("claimAccepted", sellerMarket.claimAccepted(claimId, keccak256(randomBytes(32))));

  // -----------------------------------------------------------------------
  // 3) Withdraw path: create -> cancel -> withdraw.
  // -----------------------------------------------------------------------
  const withdrawItemHash = keccak256(randomBytes(32));
  await send(
    "createListing(withdraw)",
    sellerMarket.createListing(withdrawItemHash, PRICE, { value: bond }),
  );
  const withdrawId = await nextListingId();
  await send("cancelListing(withdraw)", sellerMarket.cancelListing(withdrawId));
  await send("withdraw", sellerMarket.withdraw());

  // -----------------------------------------------------------------------
  // 4) Wait for the claim challenge window, finalize, then expire.
  // -----------------------------------------------------------------------
  const claimListing = await contract.getListing(claimId);
  await waitForDeadline("finalizeClaim", BigInt(claimListing.challengeDeadline));
  await send("finalizeClaim", sellerMarket.finalizeClaim(claimId));

  const expiryListing = await contract.getListing(expiryId);
  await waitForDeadline("expireOrder", BigInt(expiryListing.offerDeadline));
  await send("expireOrder", buyerMarket.expireOrder(expiryId));

  const out = {
    generatedAt: new Date().toISOString(),
    network: "sepolia",
    chainId: Number(network.chainId),
    contract: deployment.address,
    deploymentBlock: deployment.blockNumber ?? null,
    seller: seller.address,
    buyer: buyer.address,
    priceWei: PRICE.toString(),
    bondWei: bond.toString(),
    windows: { offerWindow, challengeWindow, deliveryWindow },
    transactions: records,
    note: "E1 completion smoke: claimAccepted, finalizeClaim, expireOrder, withdraw. Steam/Relay/helper were not involved. Listing IDs are included for traceability; tx hashes are the settlement evidence.",
    listingIds: { claim: claimId.toString(), expiry: expiryId.toString(), withdraw: withdrawId.toString() },
  };
  const outDir = path.resolve("experiments", "e1");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "sepolia-smoke-missing.json");
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${records.length} transactions to ${outFile}`);
  console.log("Steam/Relay/helper were not used in this smoke run.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
