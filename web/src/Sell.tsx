import { useCallback, useEffect, useState } from "react";
import { parseEther } from "ethers";
import { CONTRACT_CONFIGURED } from "./config";
import { getReadContract, getSignerContract } from "./contract";
import { useNow } from "./hooks";
import {
  RelayError,
  createPairingCode,
  getInventory,
  getRelayProfile,
  prepareItem,
  saveRelayProfile,
  type InventoryItem,
  type PairingCode,
} from "./relay";
import { useWallet } from "./wallet";
import {
  countdown,
  errorText,
  extractSteamId64,
  formatEth,
  shortAddress,
} from "./utils";

function inventoryErrorText(error: unknown): string {
  if (error instanceof RelayError) {
    if (error.code === "relay_timeout" || error.code === "steam_inventory_timeout") {
      return `库存读取超时（${error.code}）：Relay 所在网络无法及时访问 steamcommunity.com。请确认 Relay 能访问 Steam 社区（必要时开启 VPN/代理并重启 Relay），然后重试。`;
    }
    if (error.code === "steam_inventory_unavailable" || error.code === "relay_unreachable") {
      return `库存读取失败（${error.code}）：检查 Relay 网络、Steam 库存是否公开，以及 Relay 终端日志。`;
    }
  }
  return errorText(error);
}

export function Sell() {
  const { account, signer, relayToken, authState, connecting, connect, reauthenticate } =
    useWallet();
  const now = useNow(1_000);
  const [profileSteamId, setProfileSteamId] = useState<string | null>(null);
  const [steamIdInput, setSteamIdInput] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [priceEth, setPriceEth] = useState("");
  const [bond, setBond] = useState<bigint | null>(null);
  const [maxPrice, setMaxPrice] = useState<bigint | null>(null);
  const [minBond, setMinBond] = useState<bigint | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);

  useEffect(() => {
    setProfileSteamId(null);
    setInventory([]);
    setSelectedAsset(null);
    setMessage(null);
    setError(null);
    if (!relayToken) return;
    let cancelled = false;
    async function loadProfile() {
      setLoadingProfile(true);
      try {
        const profile = await getRelayProfile(relayToken!);
        if (cancelled) return;
        if (profile.steamId64) {
          setProfileSteamId(profile.steamId64);
          setSteamIdInput(profile.steamId64);
        }
      } catch (profileError) {
        if (profileError instanceof RelayError && profileError.status === 404) {
          // No profile yet.
        } else if (!cancelled) {
          setError(errorText(profileError));
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [relayToken, account]);

  const loadInventory = useCallback(async (steamId64: string) => {
    setLoadingInventory(true);
    setError(null);
    try {
      const items = await getInventory(steamId64);
      setInventory(items);
    } catch (inventoryError) {
      setInventory([]);
      setError(inventoryErrorText(inventoryError));
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  useEffect(() => {
    if (profileSteamId) void loadInventory(profileSteamId);
  }, [profileSteamId, loadInventory]);

  useEffect(() => {
    if (!CONTRACT_CONFIGURED) return;
    let cancelled = false;
    async function loadConfig() {
      try {
        const contract = getReadContract();
        const [nextMax, nextMin] = await Promise.all([contract.maxPrice(), contract.minBond()]);
        if (!cancelled) {
          setMaxPrice(BigInt(nextMax));
          setMinBond(BigInt(nextMin));
        }
      } catch {
        // The setup banner covers a missing contract/chain.
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!priceEth || !CONTRACT_CONFIGURED) {
      setBond(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const parsed = parseEther(priceEth);
          if (parsed <= 0n) {
            setBond(null);
            return;
          }
          const result = await getReadContract().quoteBond(parsed);
          if (!cancelled) setBond(BigInt(result));
        } catch {
          if (!cancelled) setBond(null);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [priceEth]);

  async function bindProfile() {
    if (!relayToken) {
      setError("请先完成 Relay 钱包签名登录。");
      return;
    }
    const steamId64 = extractSteamId64(steamIdInput);
    if (!steamId64) {
      setError("请粘贴 17 位 SteamID64，或包含 SteamID64 的 inventory/profile 链接。");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveRelayProfile(relayToken, steamId64);
      setProfileSteamId(saved.steamId64 || steamId64);
      setMessage("卖家 SteamID64 已绑定到当前钱包。");
    } catch (bindError) {
      setError(errorText(bindError));
    } finally {
      setBusy(false);
    }
  }

  async function listItem() {
    if (!signer || !account || !relayToken || !profileSteamId) {
      setError("需要连接 MetaMask、完成 Relay 登录并绑定 SteamID64。");
      return;
    }
    if (!selectedAsset) {
      setError("请选择一个可交易物品。");
      return;
    }
    const selected = inventory.find((item) => item.assetId === selectedAsset);
    if (!selected) {
      setError("选中的物品不在当前库存列表中，请刷新。");
      return;
    }
    let priceWei: bigint;
    try {
      priceWei = parseEther(priceEth || "0");
    } catch {
      setError("价格格式无效。");
      return;
    }
    if (priceWei <= 0n) {
      setError("价格必须大于 0。");
      return;
    }
    if (maxPrice !== null && priceWei > maxPrice) {
      setError(`价格超过本地合约上限 ${formatEth(maxPrice)} ETH。`);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const prepared = await prepareItem(relayToken, profileSteamId, selected.assetId);
      const contract = getSignerContract(signer);
      const requiredBond = BigInt(await contract.quoteBond(priceWei));
      const tx = await contract.createListing(prepared.itemHash, priceWei, { value: requiredBond });
      await tx.wait();
      const next = BigInt(await contract.nextListingId());
      const listingId = next > 0n ? next - 1n : 0n;
      setMessage(`挂牌成功，listing #${listingId.toString()}。正在打开 Trade Room…`);
      window.location.hash = `#/order/${listingId.toString()}`;
    } catch (listError) {
      setError(errorText(listError));
    } finally {
      setBusy(false);
    }
  }

  async function generatePairingCode() {
    if (!relayToken) {
      setError("请先完成 Relay 钱包签名登录。");
      return;
    }
    setError(null);
    try {
      setPairing(await createPairingCode(relayToken));
    } catch (pairingError) {
      setError(errorText(pairingError));
    }
  }

  const selected = inventory.find((item) => item.assetId === selectedAsset) || null;

  if (!account) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h1>卖家挂牌</h1>
          <p>先连接 MetaMask；本地链无需真实资金。</p>
          <button className="button primary" disabled={connecting} onClick={() => void connect()}>
            连接 MetaMask
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SELL · LOCAL SELLER</p>
          <h1>挂牌 CS2 物品</h1>
          <p className="muted">
            绑定 SteamID64 → 选择库存物品 → 定价并锁定保证金。物品不会转给平台；成交后由你的本地
            helper 从你的 Steam 登录态发 offer。
          </p>
        </div>
      </div>

      {authState !== "ready" || !relayToken ? (
        <div className="banner warn">
          Relay 未登录。Web 需要你的钱包签名来获取库存与元数据。
          <button className="button tiny" onClick={() => void reauthenticate()}>
            钱包签名登录
          </button>
        </div>
      ) : null}
      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner">{message}</div> : null}

      <div className="two-column">
        <div className="panel">
          <h2>1. 绑定卖家身份</h2>
          <p className="muted small">
            S1 只保存钱包与 SteamID64 的绑定，不做 Steam 所有权证明。请使用你自己的账号与低价值物品。
          </p>
          <div className="inline-form">
            <input
              value={steamIdInput}
              onChange={(event) => setSteamIdInput(event.target.value)}
              placeholder="7656119… 或 profile/inventory 链接"
              spellCheck={false}
            />
            <button className="button" disabled={busy || loadingProfile || !relayToken} onClick={() => void bindProfile()}>
              {loadingProfile ? "读取中…" : "绑定"}
            </button>
          </div>
          {profileSteamId ? (
            <p className="ok-text">已绑定 SteamID64 {profileSteamId} · 钱包 {shortAddress(account)}</p>
          ) : (
            <p className="muted small">尚未绑定。绑定后才会加载公开 CS2 库存。</p>
          )}

          <div className="divider" />
          <h2>2. 选择物品</h2>
          {loadingInventory ? (
            <div className="empty-state small">读取 Steam 库存…</div>
          ) : profileSteamId && inventory.length === 0 ? (
            <div className="empty-state small">
              {error ? (
                <>
                  <p>库存读取失败，请先处理上方错误。</p>
                  <button className="button tiny" onClick={() => void loadInventory(profileSteamId)}>
                    重新读取库存
                  </button>
                </>
              ) : (
                "没有找到可交易 CS2 物品。检查库存是否公开、物品是否处于交易冷却。"
              )}
            </div>
          ) : (
            <div className="inventory-grid">
              {inventory.map((item) => (
                <button
                  key={item.assetId}
                  className={`inventory-item ${selectedAsset === item.assetId ? "selected" : ""}`}
                  onClick={() => setSelectedAsset(item.assetId)}
                >
                  {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="placeholder">ITEM</span>}
                  <span>{item.marketHashName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h2>3. 定价与保证金</h2>
          {selected ? (
            <div className="selected-item">
              {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : null}
              <div>
                <strong>{selected.marketHashName}</strong>
                <p className="muted small">asset {selected.assetId}</p>
              </div>
            </div>
          ) : (
            <p className="muted small">先从左侧选择物品。</p>
          )}

          <label className="field">
            <span>Price (ETH)</span>
            <input
              value={priceEth}
              onChange={(event) => setPriceEth(event.target.value)}
              placeholder="0.01"
              inputMode="decimal"
            />
          </label>

          <div className="kv">
            <span>Bond（合约计算）</span>
            <strong>{bond === null ? "—" : `${formatEth(bond)} ETH`}</strong>
          </div>
          <div className="kv">
            <span>Max price / min bond</span>
            <span>
              {maxPrice === null ? "—" : `${formatEth(maxPrice)} ETH`} /{" "}
              {minBond === null ? "—" : `${formatEth(minBond)} ETH`}
            </span>
          </div>
          <p className="muted small">
            Bond = max(minBond, price × 10%)，由合约锁定。创建后需随交易发送该保证金；退款/成交后进入
            withdrawable。
          </p>

          <button
            className="button primary wide"
            disabled={busy || !relayToken || !profileSteamId || !selectedAsset || bond === null}
            onClick={() => void listItem()}
          >
            {busy ? "提交中…" : "锁定 Bond 并创建 Listing"}
          </button>
          <p className="muted small warning-text">
            创建 Listing 后物品仍留在 Steam 库存。买家付款后，你的本地 helper 才会读取买家 Trade URL
            并发 offer。请先让 helper 发 offer，再由你在 Web 标记，最后让买家接受。
          </p>
        </div>
      </div>

      <div className="panel helper-panel">
        <h2>卖家本地 helper 配对</h2>
        <p className="muted small">
          在另一个终端运行 <code>npm run helper</code>，粘贴这里生成的一次性 6 位配对码。helper 使用你的
          Steam 登录态，不持有你的钱包私钥；Token 只保存在本地。
        </p>
        <div className="inline-form">
          <button className="button" onClick={() => void generatePairingCode()}>
            生成一次性配对码
          </button>
          {pairing ? (
            <div className="pairing-code">
              <strong>{pairing.code}</strong>
              <span className="muted small">
                {now < pairing.expiresAt ? `${countdown(Math.floor(pairing.expiresAt / 1000), now)} 后过期` : "已过期"}
              </span>
            </div>
          ) : null}
        </div>
        <p className="muted small">
          helper 不会自动签链上交易或接受买家 offer。买家必须先等你在 Trade Room 执行
          <code> markOfferSent</code> 再接受 Steam offer。
        </p>
      </div>
    </section>
  );
}
