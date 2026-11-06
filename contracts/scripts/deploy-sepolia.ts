import fs from "node:fs";
import path from "node:path";
import { ethers, network, run } from "hardhat";
import { parseEther } from "ethers";

const SEPOLIA_CHAIN_ID = 11155111n;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function writeDeployment(file: string, payload: Record<string, unknown>): void {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (network.name !== "sepolia") {
    throw new Error("This script only deploys to Sepolia. Run with --network sepolia.");
  }

  for (const name of ["SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY", "ARBITER_ADDRESS"]) {
    if (!(process.env[name] || "").trim()) {
      throw new Error(`${name} is required in the repository-root .env for Sepolia deployment.`);
    }
  }

  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Refusing to deploy: expected Sepolia ${SEPOLIA_CHAIN_ID}, got ${chain.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer. Set DEPLOYER_PRIVATE_KEY in the repository-root .env.");
  }
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has 0 Sepolia ETH; fund it before deploying.`);
  }

  const arbiterRaw = (process.env.ARBITER_ADDRESS || "").trim();
  if (!arbiterRaw) {
    throw new Error("ARBITER_ADDRESS is required for a Sepolia deployment.");
  }
  if (!ethers.isAddress(arbiterRaw)) {
    throw new Error(`ARBITER_ADDRESS is not a valid address: ${arbiterRaw}`);
  }
  const arbiter = ethers.getAddress(arbiterRaw);
  if (arbiter === ethers.ZeroAddress) {
    throw new Error("ARBITER_ADDRESS must not be the zero address.");
  }
  if (arbiter.toLowerCase() === deployer.address.toLowerCase()) {
    console.warn("WARNING: arbiter is the deployer. Use a dedicated EOA or Safe for shared demos.");
  }

  const maxPrice = parseEther(process.env.MAX_PRICE_ETH || "0.1");
  const minBond = parseEther(process.env.MIN_BOND_ETH || "0.001");
  const offerWindow = positiveInt(process.env.OFFER_WINDOW_SECONDS, 600, "OFFER_WINDOW_SECONDS");
  const challengeWindow = positiveInt(
    process.env.CHALLENGE_WINDOW_SECONDS,
    300,
    "CHALLENGE_WINDOW_SECONDS",
  );
  const deliveryWindow = positiveInt(
    process.env.DELIVERY_WINDOW_SECONDS,
    3_600,
    "DELIVERY_WINDOW_SECONDS",
  );
  if (maxPrice <= 0n || minBond <= 0n) {
    throw new Error("MAX_PRICE_ETH and MIN_BOND_ETH must be positive.");
  }

  console.log(`Network: ${network.name} (${chain.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Arbiter: ${arbiter}`);
  console.log(
    `Windows: offer=${offerWindow}s challenge=${challengeWindow}s delivery=${deliveryWindow}s`,
  );

  const Factory = await ethers.getContractFactory("SkinPactMarket");
  const market = await Factory.deploy(
    maxPrice,
    minBond,
    offerWindow,
    challengeWindow,
    deliveryWindow,
    arbiter,
  );
  const deploymentTx = market.deploymentTransaction();
  if (!deploymentTx) throw new Error("Deployment transaction was not created.");
  const receipt = await deploymentTx.wait();
  await market.waitForDeployment();

  const address = await market.getAddress();
  const blockNumber = receipt?.blockNumber ?? 0;
  const constructorArguments = [
    maxPrice.toString(),
    minBond.toString(),
    offerWindow,
    challengeWindow,
    deliveryWindow,
    arbiter,
  ];

  const outDir = path.resolve(__dirname, "..", "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "sepolia.json");
  const payload: Record<string, unknown> = {
    chainId: Number(chain.chainId),
    network: "sepolia",
    address,
    deployer: deployer.address,
    arbiter,
    txHash: deploymentTx.hash,
    blockNumber,
    deploymentBlock: blockNumber,
    deployedAt: new Date().toISOString(),
    config: {
      maxPrice: maxPrice.toString(),
      minBond: minBond.toString(),
      offerWindow,
      challengeWindow,
      deliveryWindow,
    },
    constructorArguments,
    verifiedUrl: "",
  };
  writeDeployment(outFile, payload);

  console.log(`SkinPactMarket deployed at ${address}`);
  console.log(`Tx: ${deploymentTx.hash}`);
  console.log(`Block: ${blockNumber}`);
  console.log(`Deployment written to ${outFile}`);
  console.log(`Set Relay DEPLOYMENT_BLOCK=${blockNumber}`);
  console.log(`Explorer: https://sepolia.etherscan.io/address/${address}`);

  if (!process.env.ETHERSCAN_API_KEY) {
    console.log("ETHERSCAN_API_KEY is not set; verify manually with:");
    console.log(
      `npx hardhat verify --network sepolia ${address} ${constructorArguments.join(" ")}`,
    );
    return;
  }

  try {
    await run("verify:verify", { address, constructorArguments });
    payload.verifiedUrl = `https://sepolia.etherscan.io/address/${address}#code`;
    writeDeployment(outFile, payload);
    console.log(`Verified: ${payload.verifiedUrl}`);
  } catch (error) {
    console.warn(
      `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.warn("The deployment is valid; retry verify manually with:");
    console.warn(
      `npx hardhat verify --network sepolia ${address} ${constructorArguments.join(" ")}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
