/**
 * Sepolia deployment preflight.
 *
 * Reads local env only. Prints public addresses, balances and missing settings;
 * it never prints private keys. Run after filling the repository-root .env:
 *
 *   npm run preflight:sepolia
 */
import fs from "node:fs";
import {
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  formatEther,
  getAddress,
  isAddress,
} from "ethers";

const SEPOLIA_CHAIN_ID = 11155111n;

try {
  process.loadEnvFile(process.env.SKINPACT_ENV_FILE || ".env");
} catch {
  // Shell-provided env is fine.
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function walletFrom(name: string): Wallet | null {
  const key = env(name);
  if (!key) return null;
  try {
    return new Wallet(key);
  } catch {
    throw new Error(`${name} is not a valid private key`);
  }
}

async function main(): Promise<void> {
  const rpcUrl = env("SEPOLIA_RPC_URL");
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is missing in .env");
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is not Sepolia: expected ${SEPOLIA_CHAIN_ID}, got ${network.chainId}`);
  }

  const deployer = walletFrom("DEPLOYER_PRIVATE_KEY");
  const seller = walletFrom("SMOKE_SELLER_PRIVATE_KEY");
  const buyer = walletFrom("SMOKE_BUYER_PRIVATE_KEY");
  let arbiter: Wallet | null = null;
  if (env("ARBITER_PRIVATE_KEY")) {
    try {
      arbiter = new Wallet(env("ARBITER_PRIVATE_KEY"));
    } catch {
      console.log("ARBITER_PRIVATE_KEY is invalid; dispute smoke will be skipped.");
    }
  }
  const arbiterAddress = env("ARBITER_ADDRESS");
  let arbiterAddressValid = false;
  if (arbiterAddress) {
    if (!isAddress(arbiterAddress)) {
      console.log("ARBITER_ADDRESS is not a valid address.");
    } else if (getAddress(arbiterAddress) === ZeroAddress) {
      console.log("ARBITER_ADDRESS must not be the zero address.");
    } else {
      arbiterAddressValid = true;
    }
  }

  const rows: Array<{ role: string; address: string; balance: string; ok: boolean }> = [];
  for (const [role, wallet] of [
    ["deployer", deployer],
    ["seller", seller],
    ["buyer", buyer],
    ["arbiter", arbiter],
  ] as const) {
    if (!wallet) continue;
    const balance = await provider.getBalance(wallet.address);
    rows.push({
      role,
      address: wallet.address,
      balance: formatEther(balance),
      ok: balance > 0n,
    });
  }

  console.log("Sepolia preflight");
  console.log(`RPC chain: ${network.chainId}`);
  console.log(`Deployment file: ${fs.existsSync("deployments/sepolia.json") ? "present" : "missing"}`);
  console.log("");

  if (rows.length === 0) {
    console.log("No private keys found. Fill DEPLOYER_PRIVATE_KEY and smoke keys in .env.");
  } else {
    for (const row of rows) {
      console.log(
        `${row.role.padEnd(9)} ${row.address}  ${row.balance.padStart(12)} ETH  ${row.ok ? "OK" : "NO FUNDS"}`,
      );
    }
  }

  console.log("");
  console.log(`DEPLOYER_PRIVATE_KEY: ${deployer ? "set" : "MISSING"}`);
  console.log(`SMOKE_SELLER_PRIVATE_KEY: ${seller ? "set" : "missing (smoke only)"}`);
  console.log(`SMOKE_BUYER_PRIVATE_KEY: ${buyer ? "set" : "missing (smoke only)"}`);
  console.log(`ARBITER_ADDRESS: ${arbiterAddress || "MISSING"}`);
  console.log(`ARBITER_PRIVATE_KEY: ${arbiter ? "set" : "missing (dispute smoke only)"}`);
  console.log(`ETHERSCAN_API_KEY: ${env("ETHERSCAN_API_KEY") ? "set" : "missing (manual verify possible)"}`);

  if (arbiter && arbiterAddress && arbiter.address.toLowerCase() !== arbiterAddress.toLowerCase()) {
    console.log("WARNING: ARBITER_PRIVATE_KEY does not match ARBITER_ADDRESS.");
  }

  const isFunded = (role: string): boolean =>
    Boolean(rows.find((row) => row.role === role && row.ok));
  if (!deployer) {
    console.log("NOT READY: deployment requires DEPLOYER_PRIVATE_KEY.");
  } else if (!isFunded("deployer")) {
    console.log("NOT READY: deployer has 0 Sepolia ETH.");
  } else if (!seller) {
    console.log("NOT READY: smoke requires SMOKE_SELLER_PRIVATE_KEY.");
  } else if (!isFunded("seller")) {
    console.log("NOT READY: smoke seller has 0 Sepolia ETH.");
  } else if (!buyer) {
    console.log("NOT READY: smoke requires SMOKE_BUYER_PRIVATE_KEY.");
  } else if (!isFunded("buyer")) {
    console.log("NOT READY: smoke buyer has 0 Sepolia ETH.");
  } else if (!arbiterAddressValid) {
    console.log("NOT READY: a valid ARBITER_ADDRESS is required for Sepolia.");
  } else {
    console.log("READY for deployment + smoke.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
