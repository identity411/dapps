/**
 * E1 — local gas collection for SkinPactMarket.
 *
 * Runs on the in-process Hardhat network (chainId 31337), deploys a fresh
 * contract, and measures gasUsed for the 11 operations listed in the course
 * delivery spec. Setup transactions are excluded; only the target operation is
 * measured. Every measured transaction uses a fixed 1 gwei gas price so that the
 * fee column is reproducible; this is a reporting convention, not a market price.
 *
 * Outputs (relative to the repository root):
 *   experiments/e1/local-gas.csv
 *   experiments/e1/local-gas.json
 *
 * Usage:
 *   cd contracts && npx hardhat run scripts/e1-local-gas.ts
 *   # or from the root: npm run e1:gas
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, parseEther, parseUnits, toUtf8Bytes } from "ethers";

const PRICE = parseEther("0.01");
const MAX_PRICE = parseEther("0.1");
const MIN_BOND = parseEther("0.001");
const OFFER_WINDOW = 600;
const CHALLENGE_WINDOW = 300;
const DELIVERY_WINDOW = 3_600;
const GAS_PRICE = parseUnits("1", "gwei");
const OUT_DIR = path.resolve(__dirname, "../../experiments/e1");

interface GasRow {
  operation: string;
  scenario: string;
  gasUsed: string;
  gasPriceWei: string;
  feeWei: string;
  txHash: string;
  notes: string;
}

const rows: GasRow[] = [];

function hash(label: string): string {
  return keccak256(toUtf8Bytes(`e1-${label}`));
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function measure(
  operation: string,
  scenario: string,
  action: () => Promise<any>,
  notes: string,
): Promise<void> {
  const tx = await action();
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`${operation}: no receipt`);
  const gasUsed = BigInt(receipt.gasUsed);
  const gasPriceWei = BigInt(receipt.gasPrice ?? GAS_PRICE);
  const feeWei = gasUsed * gasPriceWei;
  rows.push({
    operation,
    scenario,
    gasUsed: gasUsed.toString(),
    gasPriceWei: gasPriceWei.toString(),
    feeWei: feeWei.toString(),
    txHash: String(receipt.hash),
    notes,
  });
  console.log(
    `${operation.padEnd(16)} gasUsed=${gasUsed
      .toString()
      .padStart(9)}  feeWei=${feeWei.toString()}`,
  );
}

async function main(): Promise<void> {
  const [seller, buyer, outsider, arbiter] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("SkinPactMarket");
  const market: any = await Factory.deploy(
    MAX_PRICE,
    MIN_BOND,
    OFFER_WINDOW,
    CHALLENGE_WINDOW,
    DELIVERY_WINDOW,
    await arbiter.getAddress(),
  );
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) throw new Error(`expected chainId 31337, got ${chainId}`);

  const bond = BigInt(await market.quoteBond(PRICE));
  const value = { value: bond, gasPrice: GAS_PRICE };
  const gas = { gasPrice: GAS_PRICE };

  async function create(label: string): Promise<bigint> {
    const tx = await market
      .connect(seller)
      .createListing(hash(`${label}-item`), PRICE, value);
    await tx.wait();
    const id = BigInt(await market.nextListingId()) - 1n;
    return id;
  }

  async function createBuy(label: string): Promise<bigint> {
    const id = await create(label);
    await (await market.connect(buyer).buy(id, { value: PRICE, gasPrice: GAS_PRICE })).wait();
    return id;
  }

  async function createBuyMark(label: string): Promise<bigint> {
    const id = await createBuy(label);
    await (await market.connect(seller).markOfferSent(id, hash(`${label}-offer`), gas)).wait();
    return id;
  }

  // 1. createListing — seller locks the bond.
  await measure(
    "createListing",
    "seller creates a listing at 0.01 test ETH",
    () => market.connect(seller).createListing(hash("op-create-item"), PRICE, value),
    "bond = max(price/10, minBond) = 0.001 test ETH",
  );

  // 2. buy — buyer funds the listing.
  {
    const id = await create("op-buy");
    await measure(
      "buy",
      "buyer funds an Active listing",
      () => market.connect(buyer).buy(id, { value: PRICE, gasPrice: GAS_PRICE }),
      "price = 0.01 test ETH",
    );
  }

  // 3. markOfferSent — seller declares the Steam offer.
  {
    const id = await createBuy("op-mark");
    await measure(
      "markOfferSent",
      "seller marks a funded order as offer-sent",
      () => market.connect(seller).markOfferSent(id, hash("op-mark-offer"), gas),
      "does not release escrow; stores offer hash and delivery deadline",
    );
  }

  // 4. confirmReceipt — buyer fast path after OfferSent.
  {
    const id = await createBuyMark("op-confirm");
    await measure(
      "confirmReceipt",
      "buyer confirms receipt from OfferSent",
      () => market.connect(buyer).confirmReceipt(id, gas),
      "credits price + bond to the seller's pull-payment balance",
    );
  }

  // 5. claimAccepted — seller reports Steam Accepted(3).
  {
    const id = await createBuyMark("op-claim");
    await measure(
      "claimAccepted",
      "seller claims acceptance after OfferSent",
      () => market.connect(seller).claimAccepted(id, hash("op-claim-evidence"), gas),
      "starts the challenge window; no payout yet",
    );
  }

  // 6. finalizeClaim — permissionless payout after the challenge window.
  {
    const id = await createBuyMark("op-finalize");
    await (await market.connect(seller).claimAccepted(id, hash("op-finalize-evidence"), gas)).wait();
    await time.increase(CHALLENGE_WINDOW + 1);
    await measure(
      "finalizeClaim",
      "outsider finalizes after the challenge window",
      () => market.connect(outsider).finalizeClaim(id, gas),
      "permissionless; credits price + bond to the seller",
    );
  }

  // 7. expireOrder — permissionless refund when no offer was marked.
  {
    const id = await createBuy("op-expire");
    await time.increase(OFFER_WINDOW + 1);
    await measure(
      "expireOrder",
      "outsider expires a Funded order after the offer window",
      () => market.connect(outsider).expireOrder(id, gas),
      "refunds the buyer price and seller bond as pull payments",
    );
  }

  // 8. cancelListing — seller cancels an unsold Active listing.
  {
    const id = await create("op-cancel");
    await measure(
      "cancelListing",
      "seller cancels an Active listing",
      () => market.connect(seller).cancelListing(id, gas),
      "refunds the bond as a pull payment; frees the item hash",
    );
  }

  // 9. openDispute — buyer disputes from OfferSent.
  {
    const id = await createBuyMark("op-dispute");
    await measure(
      "openDispute",
      "buyer disputes from OfferSent",
      () => market.connect(buyer).openDispute(id, hash("op-dispute-evidence"), gas),
      "stores only a dispute hash; funds stay in escrow",
    );
  }

  // 10. resolveDispute — arbiter refunds the buyer and slashes the bond.
  {
    const id = await createBuyMark("op-resolve");
    await (await market.connect(buyer).openDispute(id, hash("op-resolve-dispute"), gas)).wait();
    await measure(
      "resolveDispute",
      "arbiter grants buyer win with bond slashed to the buyer",
      () => market.connect(arbiter).resolveDispute(id, false, true, gas),
      "buyer receives price + bond as pull payments",
    );
  }

  // 11. withdraw — credited seller withdraws.
  {
    const id = await create("op-withdraw");
    await (await market.connect(seller).cancelListing(id, gas)).wait();
    await measure(
      "withdraw",
      "seller withdraws a credited bond",
      () => market.connect(seller).withdraw(gas),
      "pull payment; ReentrancyGuard + zeroed credit before the call",
    );
  }

  const metadata = {
    experiment: "E1",
    network: "hardhat (in-process)",
    chainId,
    contract: marketAddress,
    date: new Date().toISOString(),
    codeCommit: execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(__dirname, "../.."),
    })
      .toString()
      .trim(),
    node: process.version,
    gasPriceWei: GAS_PRICE.toString(),
    config: {
      maxPrice: MAX_PRICE.toString(),
      minBond: MIN_BOND.toString(),
      offerWindow: OFFER_WINDOW,
      challengeWindow: CHALLENGE_WINDOW,
      deliveryWindow: DELIVERY_WINDOW,
      arbiter: await arbiter.getAddress(),
    },
    scenario: {
      price: PRICE.toString(),
      bond: bond.toString(),
    },
    rows,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const header = "operation,scenario,gasUsed,gasPriceWei,feeWei,txHash,notes";
  const csv = [
    header,
    ...rows.map((row) =>
      [
        row.operation,
        csvEscape(row.scenario),
        row.gasUsed,
        row.gasPriceWei,
        row.feeWei,
        row.txHash,
        csvEscape(row.notes),
      ].join(","),
    ),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "local-gas.csv"), `${csv}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "local-gas.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  console.log(`\nWrote ${rows.length} rows to experiments/e1/local-gas.csv`);
  console.log("Steam/Relay/helper are not involved: this is a direct contract gas run.");
  console.log(`Contract: ${marketAddress} (ephemeral Hardhat network, not Sepolia)`);
  console.log(`Commit: ${metadata.codeCommit}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
