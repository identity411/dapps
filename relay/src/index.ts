import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createApp, cleanupTerminalBuyerUrls } from "./app.js";
import { EthersChain, makeProvider } from "./chain.js";
import { SteamInventoryProvider } from "./inventory.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = makeProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(config.chainId)) {
    throw new Error(
      `RPC chain id ${network.chainId} does not match CHAIN_ID ${config.chainId}; refusing to start`,
    );
  }
  const code = await provider.getCode(config.contractAddress);
  if (!code || code === "0x") {
    throw new Error("No contract code at CONTRACT_ADDRESS; deploy the local contract first");
  }

  const db = createDb(config.dbPath);
  const chain = new EthersChain(provider, config.contractAddress, config.deploymentBlock);
  const app = createApp({
    db,
    chain,
    inventory: new SteamInventoryProvider(),
    config,
  });

  const server = app.listen(config.port, "127.0.0.1", () => {
    console.log(`SkinPact relay listening on http://127.0.0.1:${config.port}`);
    console.log(`RPC ${config.rpcUrl} chain ${config.chainId}`);
    console.log(`Contract ${config.contractAddress}`);
  });

  const cleanupTimer = setInterval(() => {
    void cleanupTerminalBuyerUrls(db, chain).catch((error) => {
      console.error("[relay] buyer URL cleanup failed", {
        name: error instanceof Error ? error.name : typeof error,
      });
    });
  }, 5_000);

  const shutdown = () => {
    clearInterval(cleanupTimer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[relay] startup failed", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exit(1);
});
