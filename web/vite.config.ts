import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const deploymentFile = fileURLToPath(new URL("../deployments/local.json", import.meta.url));

function readLocalDeployment(): { address: string; chainId: number } | null {
  try {
    const data = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    if (typeof data.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(data.address)) return null;
    return { address: data.address, chainId: Number(data.chainId || 31337) };
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __SKINPACT_LOCAL_DEPLOY__: JSON.stringify(readLocalDeployment()),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
