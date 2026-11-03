const localDeploy =
  typeof __SKINPACT_LOCAL_DEPLOY__ === "undefined" ? null : __SKINPACT_LOCAL_DEPLOY__;

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || localDeploy?.chainId || 31337);
export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
export const RELAY_URL = (import.meta.env.VITE_RELAY_URL || "http://127.0.0.1:8787").replace(
  /\/+$/,
  "",
);
export const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || localDeploy?.address || "";
export const CONTRACT_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);
