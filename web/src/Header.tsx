import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, CONTRACT_CONFIGURED } from "./config";
import { getSignerContract, readWithdrawable } from "./contract";
import { useWallet } from "./wallet";
import { errorText, formatEth, shortAddress } from "./utils";

export function Header() {
  const {
    account,
    chainId,
    signer,
    relayToken,
    authState,
    authError,
    connecting,
    connect,
    switchToLocal,
    reauthenticate,
  } = useWallet();
  const [withdrawable, setWithdrawable] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshWithdrawable = useCallback(async () => {
    if (!account || !CONTRACT_CONFIGURED) {
      setWithdrawable(null);
      return;
    }
    try {
      setWithdrawable(await readWithdrawable(account));
    } catch {
      setWithdrawable(null);
    }
  }, [account]);

  useEffect(() => {
    void refreshWithdrawable();
    if (!account) return;
    const timer = setInterval(() => {
      void refreshWithdrawable();
    }, 5_000);
    return () => clearInterval(timer);
  }, [account, refreshWithdrawable]);

  async function withdraw() {
    if (!signer || !account) return;
    setBusy(true);
    setMessage(null);
    try {
      const contract = getSignerContract(signer);
      const tx = await contract.withdraw();
      await tx.wait();
      setMessage("已提现到钱包");
      await refreshWithdrawable();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <a href="#/market" className="brand-mark">
          Skin<span>Pact</span>
        </a>
        <span className="badge badge-local">S1 · LOCAL {CHAIN_ID}</span>
      </div>

      <nav className="nav">
        <a href="#/market">Market</a>
        <a href="#/orders">Orders</a>
        <a href="#/accounts">Steam 账户</a>
        <a href="#/sell">Sell</a>
      </nav>

      <div className="wallet-area">
        {account ? (
          <>
            <div className="withdraw-chip" title="结算后进入 withdrawable，需要主动 withdraw">
              <span className="muted">Withdrawable</span>
              <strong>{withdrawable === null ? "—" : `${formatEth(withdrawable)} ETH`}</strong>
              <button
                className="button tiny"
                disabled={busy || !withdrawable || withdrawable === 0n}
                onClick={() => void withdraw()}
              >
                {busy ? "…" : "Withdraw"}
              </button>
            </div>

            <div className="account-chip">
              <span className={`status-dot ${chainId === CHAIN_ID ? "ok" : "bad"}`} />
              <span>{shortAddress(account)}</span>
              {chainId !== CHAIN_ID ? (
                <button className="button tiny" onClick={() => void switchToLocal()}>
                  切换到 {CHAIN_ID}
                </button>
              ) : null}
              {relayToken ? (
                <span className="badge badge-ok">Relay 已登录</span>
              ) : authState === "signing" ? (
                <span className="badge">签名登录中…</span>
              ) : (
                <button className="button tiny" onClick={() => void reauthenticate()}>
                  重试 Relay 登录
                </button>
              )}
            </div>
          </>
        ) : (
          <button className="button primary" disabled={connecting} onClick={() => void connect()}>
            {connecting ? "连接中…" : "连接 MetaMask"}
          </button>
        )}
      </div>

      {authError ? <div className="banner error compact">{authError}</div> : null}
      {message ? <div className="banner compact">{message}</div> : null}
    </header>
  );
}
