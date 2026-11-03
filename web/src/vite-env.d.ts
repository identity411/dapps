/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_URL?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __SKINPACT_LOCAL_DEPLOY__: { address: string; chainId: number } | null;

interface Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
    on?(event: string, listener: (...args: any[]) => void): void;
    removeListener?(event: string, listener: (...args: any[]) => void): void;
  };
}
