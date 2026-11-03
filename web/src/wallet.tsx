import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { CHAIN_ID, RPC_URL } from "./config";
import { authenticateRelay } from "./relay";
import { errorText } from "./utils";

type AuthState = "idle" | "signing" | "ready" | "error";

interface WalletContextValue {
  hasWallet: boolean;
  account: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  provider: BrowserProvider | null;
  relayToken: string | null;
  authState: AuthState;
  authError: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  switchToLocal: () => Promise<void>;
  reauthenticate: () => Promise<void>;
  clearAuthError: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function requestAccounts(): Promise<string[]> {
  if (!window.ethereum) throw new Error("MetaMask 未安装");
  return (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
}

async function switchChain(): Promise<void> {
  if (!window.ethereum) throw new Error("MetaMask 未安装");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
    });
  } catch (error: any) {
    if (error?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: `Hardhat Local ${CHAIN_ID}`,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [RPC_URL],
          },
        ],
      });
      return;
    }
    throw error;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [hasWallet] = useState(Boolean(window.ethereum));
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [relayToken, setRelayToken] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const runRelayAuth = useCallback(async (nextSigner: JsonRpcSigner, address: string) => {
    setAuthState("signing");
    setAuthError(null);
    try {
      const token = await authenticateRelay(address, nextSigner);
      setRelayToken(token);
      setAuthState("ready");
    } catch (error) {
      setRelayToken(null);
      setAuthState("error");
      setAuthError(errorText(error));
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setAuthError(null);
    try {
      if (!window.ethereum) throw new Error("请先安装 MetaMask 浏览器扩展");
      const accounts = await requestAccounts();
      const nextProvider = new BrowserProvider(window.ethereum);
      const network = await nextProvider.getNetwork();
      const nextChainId = Number(network.chainId);
      setProvider(nextProvider);
      setChainId(nextChainId);
      const nextAccount = accounts[0] || null;
      setAccount(nextAccount);

      if (nextChainId !== CHAIN_ID) {
        await switchChain();
        const refreshed = new BrowserProvider(window.ethereum);
        const refreshedNetwork = await refreshed.getNetwork();
        setProvider(refreshed);
        setChainId(Number(refreshedNetwork.chainId));
        const nextSigner = await refreshed.getSigner();
        setSigner(nextSigner);
        if (nextAccount) await runRelayAuth(nextSigner, nextAccount);
        return;
      }

      const nextSigner = await nextProvider.getSigner();
      setSigner(nextSigner);
      if (nextAccount) await runRelayAuth(nextSigner, nextAccount);
    } catch (error) {
      setAuthError(errorText(error));
    } finally {
      setConnecting(false);
    }
  }, [runRelayAuth]);

  const switchToLocal = useCallback(async () => {
    try {
      await switchChain();
    } catch (error) {
      setAuthError(errorText(error));
    }
  }, []);

  const reauthenticate = useCallback(async () => {
    if (!account || !signer) {
      throw new Error("请先连接 MetaMask");
    }
    await runRelayAuth(signer, account);
  }, [account, signer, runRelayAuth]);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const refreshWalletHandle = async () => {
      if (!window.ethereum) return;
      const nextProvider = new BrowserProvider(window.ethereum);
      const network = await nextProvider.getNetwork();
      setProvider(nextProvider);
      setChainId(Number(network.chainId));
      const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
      const nextAccount = accounts[0] || null;
      setAccount(nextAccount);
      if (nextAccount) setSigner(await nextProvider.getSigner());
      else setSigner(null);
    };
    const onAccountsChanged = async (...args: unknown[]) => {
      const accounts = (args[0] as string[]) || [];
      setAccount(accounts[0] || null);
      setRelayToken(null);
      setAuthState("idle");
      setAuthError(null);
      // A BrowserProvider keeps a stale account list; rebuild provider and signer
      // so the next Relay signature/transaction uses the new MetaMask account.
      try {
        await refreshWalletHandle();
      } catch (error) {
        setSigner(null);
        setAuthError(errorText(error));
      }
    };
    const onChainChanged = async (...args: unknown[]) => {
      const raw = String(args[0] ?? "0x0");
      setChainId(Number.parseInt(raw, 16));
      setRelayToken(null);
      setAuthState("idle");
      setAuthError(null);
      try {
        await refreshWalletHandle();
      } catch (error) {
        setSigner(null);
        setAuthError(errorText(error));
      }
    };
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  return (
    <WalletContext.Provider
      value={{
        hasWallet,
        account,
        chainId,
        signer,
        provider,
        relayToken,
        authState,
        authError,
        connecting,
        connect,
        switchToLocal,
        reauthenticate,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
