import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { parseEther } from "ethers";

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`Refusing to deploy S1 outside local chain 31337 (got ${network.chainId})`);
  }

  const [deployer] = await ethers.getSigners();
  const maxPrice = parseEther(process.env.MAX_PRICE_ETH || "0.1");
  const minBond = parseEther(process.env.MIN_BOND_ETH || "0.001");
  const offerWindow = Number(process.env.OFFER_WINDOW_SECONDS || "600");
  const challengeWindow = Number(process.env.CHALLENGE_WINDOW_SECONDS || "300");

  const Factory = await ethers.getContractFactory("SkinPactMarket");
  const market = await Factory.deploy(maxPrice, minBond, offerWindow, challengeWindow);
  await market.waitForDeployment();

  const address = await market.getAddress();
  const outDir = path.resolve(process.cwd(), "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "local.json");
  const payload = {
    chainId: Number(network.chainId),
    network: "hardhat-local",
    address,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    config: {
      maxPrice: maxPrice.toString(),
      minBond: minBond.toString(),
      offerWindow,
      challengeWindow,
    },
  };
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`SkinPactMarket deployed at ${address}`);
  console.log(`Deployment written to ${outFile}`);
  console.log("S1 contract is local-only; do not deploy it to Sepolia.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
