import { useCallback, useEffect, useRef, useState } from "react";
import { parseEther } from "ethers";
import { CONTRACT_CONFIGURED } from "./config";
import { getReadContract, getSignerContract } from "./contract";
import {
  getHelperStatus,
  pairHelper,
  startHelperLogin,
  HelperError,
  type HelperStatus,
} from "./helper";
import {
  RelayError,
  createPairingCode,
  getInventory,
  getRelayProfile,
  prepareItem,
  saveRelayProfile,
  type InventoryItem,
} from "./relay";
import { useWallet } from "./wallet";
import { errorText, formatEth, shortAddress } from "./utils";

const HELPER_RETRY_MS = 6_000;
/** Steam QR codes are short-lived; the helper rotates a code older than 18s. */
const QR_REFRESH_MS = 22_000;

function inventoryErrorText(error: unknown): string {
  if (error instanceof RelayError) {
    if (error.code === "relay_timeout" || error.code === "steam_inventory_timeout") {
      return `库存读取超时（${error.code}）：Relay 所在网络无法及时访问 steamcommunity.com。请确认 Relay 能访问 Steam 社区（开启系统级 VPN/TUN 后重启 Relay），然后重试。`;
    }
    if (error.code === "steam_inventory_unavailable" || error.code === "relay_unreachable") {
      return `库存读取失败（${error.code}）：检查 Relay 网络、Steam 库存是否公开，以及 Relay 终端日志。`;
    }
  }
  return errorText(error);
}

function helperErrorText(error: unknown): string {
  if (error instanceof HelperError) {
    switch (error.code) {
      case "helper_unreachable":
        return "本地 helper 未启动。请在一个终端运行 npm run helper；helper 启动后本页会自动重试。";
      case "helper_timeout":
        return "本地 helper 响应超时。检查终端里的 helper 是否仍在运行。";
      case "pairing_code_invalid":
        return "自动配对失败（一次性配对码已失效）。请点击重试。";
      case "helper_active_offers_other_seller":
        return "helper 还有未完成的 Steam offer，不能切换到另一个钱包。请先处理完当前挂单，或重启 helper。";
      case "helper_not_paired":
        return "helper 尚未与当前钱包配对，请稍等自动重试。";
      case "steam_qr_start_failed":
        return "无法生成 Steam 二维码。确认 helper 所在网络能访问 Steam 社区后重试。";
      case "helper_api_port_in_use":
        return "本地 helper API 端口被占用。请关闭另一个 helper 进程后重试。";
      case "relay_unreachable":
      case "relay_timeout":
        return `helper 无法联系 Relay（${error.code}）。检查 Relay 是否在运行。`;
      default:
        return `本地 helper 出错（${error.code}）。`;
    }
  }
  return errorText(error);
}

function steamErrorText(code: string | null): string | null {
  switch (code) {
    case "steam_qr_timeout":
      return "Steam 二维码已过期，请重新获取。";
    case "steam_qr_error":
      return "Steam 扫码登录未完成，请重试。";
    case "steam_qr_start_failed":
      return "无法生成 Steam 二维码，请检查 Steam 社区网络后重试。";
    case "steam_login_state_conflict":
      return "helper 的 Steam 登录状态发生变化，请重启 helper 后重试。";
    case null:
      return null;
    default:
      return `Steam 登录未完成（${code}）。`;
  }
}

export function Sell() {
  const { account, signer, relayToken, authState, connecting, connect, reauthenticate } =
    useWallet();
  const [profileSteamId, setProfileSteamId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [priceEth, setPriceEth] = useState("");
  const [bond, setBond] = useState<bigint | null>(null);
  const [maxPrice, setMaxPrice] = useState<bigint | null>(null);
  const [minBond, setMinBond] = useState<bigint | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [helperStatus, setHelperStatus] = useState<HelperStatus | null>(null);
  const [helperConnectionError, setHelperConnectionError] = useState<string | null>(null);
  const [helperActionError, setHelperActionError] = useState<string | null>(null);
  const [helperBusy, setHelperBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const autoBusyRef = useRef(false);
  const lastAutoAttemptRef = useRef(0);
  const bindingRef = useRef<string | null>(null);
  const qrEpochRef = useRef(0);
  const qrDataRef = useRef<string | null>(null);

  const helperError = helperActionError || helperConnectionError;
  const helperReady = Boolean(helperStatus?.polling);

  useEffect(() => {
    setProfileSteamId(null);
    setInventory([]);
    setSelectedAsset(null);
    setMessage(null);
    setError(null);
    setHelperStatus(null);
    setHelperActionError(null);
    setHelperConnectionError(null);
    qrDataRef.current = null;
    setQrDataUrl(null);
    if (!relayToken) return;
    let cancelled = false;
    async function loadProfile() {
      try {
        const profile = await getRelayProfile(relayToken!);
        if (cancelled) return;
        if (profile.steamId64) setProfileSteamId(profile.steamId64);
      } catch (profileError) {
        if (profileError instanceof RelayError && profileError.status === 404) {
          // No profile yet; the QR login will create it.
        } else if (!cancelled) {
          setError(errorText(profileError));
        }
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [relayToken, account]);

  useEffect(() => {
    if (!relayToken || !account) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (cancelled) return;
      const qrEpoch = qrEpochRef.current;
      try {
        const status = await getHelperStatus();
        if (cancelled) return;
        setHelperStatus(status);
        setHelperConnectionError(null);
        // A status requested before the current QR was issued must not clear it;
        // otherwise restarting the helper still removes a stale QR on the first
        // fresh poll (logged_out/logged_in/error all mean no QR is outstanding).
        if (status.steam.status !== "qr_pending" && qrEpochRef.current === qrEpoch) {
          qrDataRef.current = null;
          setQrDataUrl(null);
        }
      } catch (pollError) {
        if (cancelled) return;
        setHelperStatus(null);
        setHelperConnectionError(helperErrorText(pollError));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

  const bindSteamProfile = useCallback(
    async (steamId64: string) => {
      if (!relayToken) return;
      if (profileSteamId === steamId64) return;
      if (bindingRef.current === steamId64) return;
      bindingRef.current = steamId64;
      try {
        const saved = await saveRelayProfile(relayToken, steamId64);
        const bound = saved.steamId64 || steamId64;
        setProfileSteamId(bound);
        setError(null);
        setMessage("已绑定扫码登录的 Steam 账号，正在加载库存…");
      } finally {
        bindingRef.current = null;
      }
    },
    [relayToken, profileSteamId],
  );

  const connectHelper = useCallback(async () => {
    if (!account || !relayToken) return;
    if (autoBusyRef.current) return;
    autoBusyRef.current = true;
    lastAutoAttemptRef.current = Date.now();
    setHelperBusy(true);
    setHelperActionError(null);
    try {
      let status = helperStatus;
      if (!status) {
        status = await getHelperStatus();
        setHelperStatus(status);
      }
      const sellerMatches = Boolean(
        status.seller && account && status.seller.toLowerCase() === account.toLowerCase(),
      );
      if (!sellerMatches) {
        const pairing = await createPairingCode(relayToken);
        await pairHelper(pairing.code);
        status = await getHelperStatus();
        setHelperStatus(status);
      }

      if (status.steam.status === "logged_in" && status.steam.steamId64) {
        qrEpochRef.current += 1;
        qrDataRef.current = null;
        setQrDataUrl(null);
        await bindSteamProfile(status.steam.steamId64);
        return;
      }

      const started = await startHelperLogin();
      if (started.status === "logged_in" && started.steamId64) {
        qrEpochRef.current += 1;
        qrDataRef.current = null;
        setQrDataUrl(null);
        await bindSteamProfile(started.steamId64);
        return;
      }
      if (started.qrDataUrl) {
        qrEpochRef.current += 1;
        qrDataRef.current = started.qrDataUrl;
        setQrDataUrl(started.qrDataUrl);
        // Let the next poll act immediately once the scan has logged in, rather
        // than waiting out the pairing/QR retry backoff before auto-binding.
        lastAutoAttemptRef.current = 0;
      } else {
        setHelperActionError("Steam 登录没有返回二维码，请重试。");
      }
    } catch (connectError) {
      setHelperActionError(helperErrorText(connectError));
    } finally {
      autoBusyRef.current = false;
      setHelperBusy(false);
    }
  }, [account, relayToken, helperStatus, bindSteamProfile]);

  useEffect(() => {
    if (!account || !relayToken || !helperStatus) return;
    if (autoBusyRef.current) return;

    const sellerMatches = Boolean(
      helperStatus.seller && helperStatus.seller.toLowerCase() === account.toLowerCase(),
    );
    const steamLoggedIn = Boolean(
      helperStatus.steam.status === "logged_in" && helperStatus.steam.steamId64,
    );
    const needsPair = !sellerMatches;
    const needsLogin = sellerMatches && !steamLoggedIn && !qrDataUrl;
    const needsBind =
      sellerMatches &&
      steamLoggedIn &&
      Boolean(helperStatus.steam.steamId64) &&
      helperStatus.steam.steamId64 !== profileSteamId;

    if (!needsPair && !needsLogin && !needsBind) return;
    if (Date.now() - lastAutoAttemptRef.current < HELPER_RETRY_MS) return;
    void connectHelper();
  }, [account, relayToken, helperStatus, qrDataUrl, profileSteamId, connectHelper]);

  const hasQr = Boolean(qrDataUrl);
  const helperQrPending = helperStatus?.steam.status === "qr_pending";

  useEffect(() => {
    if (!hasQr || !helperQrPending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refreshQr() {
      if (cancelled) return;
      try {
        const started = await startHelperLogin();
        if (cancelled) return;
        if (started.status === "qr" && started.qrDataUrl && started.qrDataUrl !== qrDataRef.current) {
          qrEpochRef.current += 1;
          qrDataRef.current = started.qrDataUrl;
          setQrDataUrl(started.qrDataUrl);
        }
      } catch {
        // The status poll surfaces helper errors; the auto-retry effect recovers.
      } finally {
        if (!cancelled) timer = setTimeout(() => void refreshQr(), QR_REFRESH_MS);
      }
    }

    timer = setTimeout(() => void refreshQr(), QR_REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasQr, helperQrPending]);

  async function listItem() {
    if (!signer || !account || !relayToken || !profileSteamId) {
      setError("需要连接 MetaMask、完成 Relay 登录并通过 Steam 扫码登录。");
      return;
    }
    if (!helperReady) {
      setError("本地 helper 尚未就绪，请先完成左侧的 Steam 扫码登录并等待 helper 校验。");
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
      setError(`价格超过合约上限 ${formatEth(maxPrice)} ETH。`);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const prepared = await prepareItem(relayToken, profileSteamId, selected.assetId);
      const contract = getSignerContract(signer);
      const activeListingId = BigInt(await contract.activeItemHash(prepared.itemHash));
      if (activeListingId !== 0n) {
        setMessage(`该物品已在 Listing #${activeListingId.toString()} 活跃挂单中，正在打开 Trade Room…`);
        window.location.hash = `#/order/${activeListingId.toString()}`;
        return;
      }
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

  const selected = inventory.find((item) => item.assetId === selectedAsset) || null;
  const steamLoggedIn = Boolean(
    helperStatus?.steam.status === "logged_in" && helperStatus.steam.steamId64,
  );
  const steamError = steamErrorText(helperStatus?.steam.error ?? null);
  const showQr = Boolean(qrDataUrl);

  if (!account) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h1>卖家挂牌</h1>
          <p>先连接 MetaMask；测试 ETH，无需真实资金。</p>
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
          <p className="eyebrow">SELL · SELLER</p>
          <h1>挂牌 CS2 物品</h1>
          <p className="muted">
            扫码登录 Steam → 选择库存物品 → 定价并锁定保证金。物品不会转给平台；成交后由你的本地
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
          <h2>1. Steam 扫码登录</h2>
          <p className="muted small">
            二维码由你自己的本地 helper 生成，只在 127.0.0.1 上显示。扫码后会自动绑定当前钱包并加载库存，
            不需要复制配对码。
          </p>

          {!relayToken ? (
            <div className="empty-state small">先完成钱包签名登录，再扫码登录 Steam。</div>
          ) : helperStatus ? (
            <>
              {steamLoggedIn && helperStatus.steam.steamId64 ? (
                <div className="helper-status">
                  <p className="ok-text">Steam 已登录 · {helperStatus.steam.steamId64}</p>
                  <p className="muted small">
                    钱包 {shortAddress(account)} · 登录态只保存在本机 helper，不上传 Relay。
                  </p>
                  {helperStatus.profile.matches ? (
                    <p className="ok-text">本地 helper 已就绪；买家付款后会自动发送 Steam offer。</p>
                  ) : (
                    <p className="muted small">正在把扫码账号同步到当前钱包…</p>
                  )}
                  {helperError ? <p className="warning-text small">{helperError}</p> : null}
                  {!helperStatus.paired ||
                  helperStatus.seller?.toLowerCase() !== account.toLowerCase() ? (
                    <p className="muted small">正在把本地 helper 自动配对到当前钱包…</p>
                  ) : null}
                </div>
              ) : showQr ? (
                <div className="qr-login">
                  <img
                    className="steam-qr"
                    src={qrDataUrl ?? undefined}
                    alt="Steam 扫码登录二维码"
                    draggable={false}
                  />
                  <div>
                    <strong>
                      {helperStatus.steam.remoteInteraction ? "已扫码，等待手机确认" : "用 Steam 手机令牌扫码"}
                    </strong>
                    {helperStatus.steam.remoteInteraction ? (
                      <p className="ok-text small">
                        请在 Steam 手机 App 中点击「确认登录」。若长时间未确认，本页会自动换新二维码。
                      </p>
                    ) : (
                      <p className="muted small">
                        打开 Steam 手机 App → 令牌 → 扫码登录，登录卖家账号。扫码后本页会自动绑定
                        SteamID64 并加载库存。
                      </p>
                    )}
                    <p className="muted small warning-text">
                      二维码是一次性登录凭证，约每 22 秒自动换新，请直接扫当前屏幕上的码，不要截图分享。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="empty-state small">
                  <p>
                    {helperError ||
                      steamError ||
                      (helperStatus.steam.status === "logged_out"
                        ? "正在请求 Steam 登录二维码…"
                        : "正在等待 Steam 扫码登录…")}
                  </p>
                  <button
                    className="button tiny"
                    disabled={helperBusy}
                    onClick={() => void connectHelper()}
                  >
                    {helperBusy ? "连接中…" : "重新获取二维码"}
                  </button>
                </div>
              )}
              {helperBusy && !showQr ? (
                <p className="muted small">正在连接本地 helper…</p>
              ) : null}
              {!steamLoggedIn &&
              (!helperStatus.paired ||
                helperStatus.seller?.toLowerCase() !== account.toLowerCase()) ? (
                <p className="muted small">正在把本地 helper 自动配对到当前钱包…</p>
              ) : null}
            </>
          ) : (
            <div className="empty-state small">
              <p>{helperError || "正在连接本地 helper…"}</p>
              <p>
                请在一个终端运行 <code>npm run helper</code>。helper 启动后，本页会自动配对并显示
                Steam 二维码。
              </p>
              <button className="button tiny" onClick={() => void connectHelper()}>
                重试
              </button>
            </div>
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
          ) : profileSteamId ? (
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
          ) : (
            <div className="empty-state small">扫码登录成功后会自动加载你的 CS2 库存。</div>
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
          <div className="kv">
            <span>本地 helper</span>
            <strong className={helperReady ? "ok-text" : undefined}>
              {helperReady ? "已就绪" : "未就绪"}
            </strong>
          </div>
          <p className="muted small">
            Bond = max(minBond, price × 10%)，由合约锁定。创建后需随交易发送该保证金；退款/成交后进入
            withdrawable。
          </p>

          <button
            className="button primary wide"
            disabled={
              busy ||
              !relayToken ||
              !profileSteamId ||
              !helperReady ||
              !selectedAsset ||
              bond === null
            }
            onClick={() => void listItem()}
          >
            {busy ? "提交中…" : "锁定 Bond 并创建 Listing"}
          </button>
          {!helperReady ? (
            <p className="muted small warning-text">
              本地 helper 尚未就绪：先完成左侧 Steam 扫码登录，helper 校验绑定后才能创建 Listing。
            </p>
          ) : (
            <p className="muted small warning-text">
              创建 Listing 后物品仍留在 Steam 库存。买家付款后，本地 helper 才会读取买家 Trade URL
              并发 offer。请先让 helper 发 offer，再由你在 Web 标记，最后让买家接受。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
