import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, CONTRACT_CONFIGURED, NETWORK_NAME } from "./config";
import { getSignerContract, readWithdrawable } from "./contract";
import { getRelayProfile, listSteamAccounts } from "./relay";
import { useWallet } from "./wallet";
import { errorText, formatEth, shortAddress } from "./utils";

interface SteamIdentity {
  steamId64: string;
  nickname: string;
  avatarUrl: string | null;
}

function shortSteamId(steamId64: string): string {
  return steamId64.length <= 10
    ? steamId64
    : `${steamId64.slice(0, 4)}…${steamId64.slice(-4)}`;
}

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
  const [steamIdentity, setSteamIdentity] = useState<SteamIdentity | null>(null);
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

  useEffect(() => {
    setSteamIdentity(null);
    if (!relayToken) return;
    let cancelled = false;

    void (async () => {
      // Prefer the wallet's bound seller profile; fall back to its saved
      // receiving accounts when this wallet has only bought so far.
      const [profileResult, accountsResult] = await Promise.allSettled([
        getRelayProfile(relayToken, { includeSteam: true }),
        listSteamAccounts(relayToken),
      ]);
      if (cancelled) return;

      const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
      const accounts = accountsResult.status === "fulfilled" ? accountsResult.value : [];

      if (profile?.steamId64) {
        const matchingAccount = accounts.find(
          (candidate) => candidate.steamId64 === profile.steamId64,
        );
        if (!profile.avatarUrl && matchingAccount) {
          setSteamIdentity({
            steamId64: matchingAccount.steamId64,
            nickname: matchingAccount.nickname,
            avatarUrl: matchingAccount.avatarUrl,
          });
          return;
        }
        setSteamIdentity({
          steamId64: profile.steamId64,
          nickname: profile.nickname || `Steam ${profile.steamId64.slice(-6)}`,
          avatarUrl: profile.avatarUrl ?? null,
        });
        return;
      }

      const firstAccount = accounts[0];
      if (firstAccount) {
        setSteamIdentity({
          steamId64: firstAccount.steamId64,
          nickname: firstAccount.nickname,
          avatarUrl: firstAccount.avatarUrl,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relayToken, account]);

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
        <span className="badge badge-local">
          S2-mini · {NETWORK_NAME.toUpperCase()} {CHAIN_ID}
        </span>
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
            <div className={`account-chip${steamIdentity ? " stacked" : ""}`}>
              {steamIdentity ? (
                <div className="steam-identity">
                  {steamIdentity.avatarUrl ? (
                    <img
                      className="steam-avatar"
                      src={steamIdentity.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="steam-avatar fallback" aria-hidden="true">
                      {steamIdentity.nickname.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="steam-identity-copy">
                    <strong title={steamIdentity.nickname}>{steamIdentity.nickname}</strong>
                    <span className="muted small">
                      SteamID64 {shortSteamId(steamIdentity.steamId64)}
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="account-wallet-row">
                <span className={`status-dot ${chainId === CHAIN_ID ? "ok" : "bad"}`} />
                <span title="当前 MetaMask 钱包">{shortAddress(account)}</span>
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
            </div>

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
