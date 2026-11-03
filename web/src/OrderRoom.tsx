import { useCallback, useEffect, useState } from "react";
import { ListingStatus, type Listing } from "@skinpact/shared";
import { CHAIN_ID, CONTRACT_CONFIGURED } from "./config";
import { getSignerContract, readListing } from "./contract";
import { useNow } from "./hooks";
import {
  RelayError,
  getBuyerAccountLink,
  getMetadata,
  getSellerReport,
  linkSavedSteamAccount,
  type BuyerAccountLink,
  type PublicMetadata,
  type SellerReport,
} from "./relay";
import { SteamAccountPicker, accountErrorText } from "./SteamAccountPicker";
import { useWallet } from "./wallet";
import {
  countdown,
  errorText,
  formatEth,
  isPast,
  sameAddress,
  shortAddress,
  shortHash,
  statusName,
  timestampLabel,
} from "./utils";

const TERMINAL = new Set([ListingStatus.Completed, ListingStatus.Refunded]);
const TIMELINE = [
  ListingStatus.Active,
  ListingStatus.Funded,
  ListingStatus.OfferSent,
  ListingStatus.ClaimPending,
  ListingStatus.Completed,
];

function statusTone(status: ListingStatus): string {
  if (status === ListingStatus.Completed) return "ok";
  if (status === ListingStatus.Refunded) return "neutral";
  if (status === ListingStatus.ClaimPending) return "warn";
  return "live";
}

export function OrderRoom({ listingId }: { listingId: string }) {
  const { account, chainId, signer, relayToken, authState, connect, reauthenticate } = useWallet();
  const now = useNow(1_000);
  const [listing, setListing] = useState<Listing | null>(null);
  const [metadata, setMetadata] = useState<PublicMetadata | null>(null);
  const [report, setReport] = useState<SellerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [linkedAccount, setLinkedAccount] = useState<BuyerAccountLink | null>(null);
  const [receiptAcknowledged, setReceiptAcknowledged] = useState(false);

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    setReceiptAcknowledged(false);
  }, [listing?.status, account]);

  useEffect(() => {
    setSelectedAccountId(null);
    setLinkedAccount(null);
  }, [account]);

  useEffect(() => {
    if (!CONTRACT_CONFIGURED) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const next = await readListing(listingId);
        if (cancelled) return;
        if (next.status === ListingStatus.None) {
          setNotFound(true);
          setListing(null);
          return;
        }
        setNotFound(false);
        setListing(next);

        try {
          setMetadata(await getMetadata(next.itemHash));
        } catch {
          if (!cancelled) setMetadata(null);
        }

        if (
          relayToken &&
          account &&
          sameAddress(account, next.seller)
        ) {
          try {
            const nextReport = await getSellerReport(relayToken, listingId);
            if (!cancelled) setReport(nextReport);
          } catch (reportError) {
            if (!cancelled) {
              setReport(null);
              if (!(reportError instanceof RelayError && [401, 403, 404].includes(reportError.status))) {
                setError(errorText(reportError));
              }
            }
          }
        } else if (!cancelled) {
          setReport(null);
        }

        if (relayToken && account && !sameAddress(account, next.seller)) {
          try {
            const link = await getBuyerAccountLink(relayToken, listingId);
            if (!cancelled) {
              setLinkedAccount(link);
              if (link.linked && link.steamAccountId) {
                setSelectedAccountId((current) => current ?? link.steamAccountId);
              }
            }
          } catch (linkError) {
            if (!cancelled) {
              setLinkedAccount(null);
              if (
                !(
                  linkError instanceof RelayError &&
                  [401, 403, 404, 409].includes(linkError.status)
                )
              ) {
                setError(errorText(linkError));
              }
            }
          }
        } else if (!cancelled) {
          setLinkedAccount(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(errorText(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [listingId, account, relayToken, reloadKey]);

  async function runAction(key: string, action: () => Promise<void>) {
    setActionBusy(key);
    setError(null);
    setMessage(null);
    try {
      await action();
      refresh();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setActionBusy(null);
    }
  }

  async function linkSelectedAccount(): Promise<void> {
    if (!relayToken) {
      throw new Error("Relay 未登录。请先在右上角完成钱包签名登录。");
    }
    if (!selectedAccountId) {
      throw new Error("请先选择一个买家 Steam 账户。");
    }
    try {
      // Always copy the current encrypted secret so an account whose URL was
      // re-saved after a previous link cannot leave the order on a stale URL.
      await linkSavedSteamAccount(relayToken, listingId, selectedAccountId);
    } catch (error) {
      throw new Error(accountErrorText(error));
    }
  }

  async function saveSelectedAccountToOrder() {
    await runAction("link-account", async () => {
      await linkSelectedAccount();
      setMessage("已把所选 Steam 账户加密关联到该订单；Trade URL 只会在付款后向卖家 helper 揭示。");
    });
  }

  async function buy() {
    if (!signer || !listing) return;
    if (sameAddress(account, listing.seller)) return;
    await runAction("buy", async () => {
      // Link before paying so a funded order can never lack delivery details.
      await linkSelectedAccount();
      const contract = getSignerContract(signer);
      const tx = await contract.buy(BigInt(listingId), { value: listing.price });
      await tx.wait();
      setMessage("所选 Steam 账户已关联订单，付款已锁定到合约。等待卖家本地 helper 发送 Steam offer。");
    });
  }

  async function markOfferSent() {
    if (!signer || !report?.offer) return;
    await runAction("mark", async () => {
      const contract = getSignerContract(signer);
      const tx = await contract.markOfferSent(BigInt(listingId), report.offer!.offerIdHash);
      await tx.wait();
      setMessage("已记录 offer hash。现在可以让买家接受 Steam offer；你仍可稍后领取。");
    });
  }

  async function confirmReceipt() {
    if (!signer || !receiptAcknowledged) return;
    await runAction("confirm", async () => {
      const contract = getSignerContract(signer);
      const tx = await contract.confirmReceipt(BigInt(listingId));
      await tx.wait();
      setReceiptAcknowledged(false);
      setMessage("已确认收货。合约完成，款项进入卖家 withdrawable。");
    });
  }

  async function claimAccepted() {
    if (!signer || !report?.evidence) return;
    await runAction("claim", async () => {
      const contract = getSignerContract(signer);
      const tx = await contract.claimAccepted(BigInt(listingId), report.evidence!.evidenceHash);
      await tx.wait();
      setMessage("已提交 Accepted(3) 证据。挑战窗口结束后任何人可 finalize。");
    });
  }

  async function finalizeClaim() {
    if (!signer) return;
    await runAction("finalize", async () => {
      const contract = getSignerContract(signer);
      const tx = await contract.finalizeClaim(BigInt(listingId));
      await tx.wait();
      setMessage("挑战窗口已过，已结算给卖家。");
    });
  }

  async function expireOrder() {
    if (!signer) return;
    await runAction("expire", async () => {
      const contract = getSignerContract(signer);
      const tx = await contract.expireOrder(BigInt(listingId));
      await tx.wait();
      setMessage("已退款：买家可取回价格，卖家可取回 Bond（进入 withdrawable）。");
    });
  }

  if (!CONTRACT_CONFIGURED) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h1>本地合约未配置</h1>
          <p>请先启动 Hardhat 本地链并运行 npm run deploy:local，然后重启 Web。</p>
          <a className="button" href="#/market">返回市场</a>
        </div>
      </section>
    );
  }

  if (loading && !listing) {
    return <section className="page narrow"><div className="empty-state">读取 listing #{listingId}…</div></section>;
  }

  if (notFound || !listing) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h1>Listing #{listingId} 不存在</h1>
          <p>它可能尚未创建，或链上状态无法读取。</p>
          <a className="button" href="#/market">返回市场</a>
        </div>
      </section>
    );
  }

  const isSeller = sameAddress(account, listing.seller);
  const isBuyer = sameAddress(account, listing.buyer);
  const wrongChain = chainId !== null && chainId !== CHAIN_ID;
  const offerOpen = !isPast(listing.offerDeadline);
  const challengeOpen = listing.challengeDeadline > 0n && !isPast(listing.challengeDeadline);
  const terminal = TERMINAL.has(listing.status);
  const selectedAccountLinked = Boolean(
    linkedAccount?.linked &&
      selectedAccountId &&
      linkedAccount.steamAccountId === selectedAccountId,
  );
  const offerHashMatches =
    report?.offer &&
    listing.offerIdHash !== `0x${"0".repeat(64)}` &&
    report.offer.offerIdHash.toLowerCase() === listing.offerIdHash.toLowerCase();

  function renderTimeline() {
    if (listing!.status === ListingStatus.Refunded) {
      return (
        <div className="timeline">
          <div className="timeline-step done"><span>Active</span><small>挂牌</small></div>
          <div className="timeline-step done"><span>Funded</span><small>付款</small></div>
          <div className="timeline-step refunded"><span>Refunded</span><small>已退款</small></div>
        </div>
      );
    }
    const currentIndex = TIMELINE.indexOf(listing!.status);
    return (
      <div className="timeline">
        {TIMELINE.map((step, index) => (
          <div
            key={step}
            className={`timeline-step ${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}`}
          >
            <span>{statusName(step)}</span>
            <small>
              {index < currentIndex ? "已完成" : index === currentIndex ? "当前" : "待处理"}
            </small>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="page">
      <div className="room-heading">
        <div>
          <a href="#/market" className="back-link">← Market</a>
          <p className="eyebrow">TRADE ROOM · LOCAL CHAIN</p>
          <h1>Listing #{listingId}</h1>
          <p className="muted">
            链上状态 <span className={`status-pill ${statusTone(listing.status)}`}>{statusName(listing.status)}</span>
            {" "}· 物品交付通过 Steam offer，链上只记录承诺与证据。
          </p>
        </div>
        <button className="button" onClick={refresh} disabled={loading}>刷新</button>
      </div>

      {wrongChain ? (
        <div className="banner warn">
          当前钱包网络不是本地链 {CHAIN_ID}。请在顶部切换到 {CHAIN_ID} 后再执行链上操作。
        </div>
      ) : null}
      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner">{message}</div> : null}

      {renderTimeline()}

      <div className="room-grid">
        <div className="stack">
          <div className="panel item-panel">
            <div className="selected-item large">
              {metadata?.imageUrl ? <img src={metadata.imageUrl} alt="" /> : <span className="placeholder">CS2 ITEM</span>}
              <div>
                <p className="eyebrow">ITEM</p>
                <h2>{metadata?.marketHashName || "物品元数据未找到"}</h2>
                {metadata ? (
                  <p className="muted small">asset {metadata.assetId} · class {metadata.classId}</p>
                ) : (
                  <p className="muted small">Relay 中没有该 itemHash 的元数据；链上交易仍然可读。</p>
                )}
              </div>
            </div>

            <div className="detail-grid">
              <div><span className="label">Price</span><strong>{formatEth(listing.price)} ETH</strong></div>
              <div><span className="label">Seller bond</span><span>{formatEth(listing.bond)} ETH</span></div>
              <div><span className="label">Seller</span><code>{shortAddress(listing.seller)}</code></div>
              <div><span className="label">Buyer</span><code>{listing.buyer === `0x${"0".repeat(40)}` ? "尚未购买" : shortAddress(listing.buyer)}</code></div>
              <div><span className="label">Item hash</span><code title={listing.itemHash}>{shortHash(listing.itemHash)}</code></div>
              <div><span className="label">Offer hash</span><code title={listing.offerIdHash}>{shortHash(listing.offerIdHash)}</code></div>
              <div><span className="label">Evidence hash</span><code title={listing.evidenceHash}>{shortHash(listing.evidenceHash)}</code></div>
              <div>
                <span className="label">Offer deadline</span>
                <span>
                  {listing.status === ListingStatus.Funded
                    ? `${countdown(listing.offerDeadline, now)} · ${timestampLabel(listing.offerDeadline)}`
                    : timestampLabel(listing.offerDeadline)}
                </span>
              </div>
              <div>
                <span className="label">Challenge deadline</span>
                <span>{timestampLabel(listing.challengeDeadline)}</span>
              </div>
            </div>
          </div>

          {isSeller ? (
            <div className="panel">
              <h2>卖家证据 / helper 状态</h2>
              <p className="muted small">
                helper 在成交前会读取买家的 Trade URL。你在这里只能看到 hash 与证据摘要，不会看到完整
                URL。
              </p>
              {!relayToken ? (
                <div className="banner warn">
                  Relay 未登录，无法读取 helper 报告。
                  <button className="button tiny" onClick={() => void reauthenticate()}>登录</button>
                </div>
              ) : report ? (
                <div className="report">
                  <div className="kv"><span>Offer 记录</span><span>{report.offer ? `#${report.offer.tradeOfferId}` : "尚未上报"}</span></div>
                  <div className="kv"><span>上报的 offer hash</span><code title={report.offer?.offerIdHash}>{shortHash(report.offer?.offerIdHash)}</code></div>
                  <div className="kv">
                    <span>与链上 mark 一致</span>
                    <span>{offerHashMatches ? "是" : listing.offerIdHash === `0x${"0".repeat(64)}` ? "尚未 mark" : "不匹配"}</span>
                  </div>
                  <div className="kv"><span>Accepted(3) 证据</span><span>{report.evidence ? `已记录 · ${timestampLabel(Math.floor(Date.parse(report.evidence.observedAt) / 1000))}` : "尚未记录"}</span></div>
                  {report.evidence ? (
                    <div className="kv"><span>Evidence hash</span><code title={report.evidence.evidenceHash}>{shortHash(report.evidence.evidenceHash)}</code></div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state small">
                  没有 helper 报告。请在另一终端运行 <code>npm run helper</code> 并完成配对；helper 在
                  Funded 订单中发送 Steam offer 后自动上报。
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="stack">
          <div className="panel action-panel">
            <h2>操作</h2>
            {!account ? (
              <div className="action-block">
                <p>连接 MetaMask 以参与这笔交易。</p>
                <button className="button primary wide" onClick={() => void connect()}>连接 MetaMask</button>
              </div>
            ) : null}

            {listing.status === ListingStatus.Active && account ? (
              <div className="action-block">
                {isSeller ? (
                  <>
                    <p className="muted">
                      等待买家。请先让 helper 保持在线：买家锁款后，helper 会读取其 Trade URL 并发送
                      Steam offer。
                    </p>
                    <p className="muted small">
                      要自测买家流程：在 MetaMask 切到另一个本地账户（需有 test ETH），刷新本页后选择或添加
                      买家 Steam 账户，再点购买。卖家钱包不能购买自己的 Listing。
                    </p>
                  </>
                ) : (
                  <>
                    {relayToken ? (
                      <SteamAccountPicker
                        token={relayToken}
                        selectedId={selectedAccountId}
                        onSelect={setSelectedAccountId}
                        disabled={actionBusy !== null}
                      />
                    ) : (
                      <div className="banner warn">
                        Relay 未登录，无法读取或保存买家 Steam 账户。
                        {authState !== "signing" ? (
                          <button className="link-button" onClick={() => void reauthenticate()}>钱包签名</button>
                        ) : null}
                      </div>
                    )}

                    {selectedAccountLinked ? (
                      <p className="ok-text small">所选 Steam 账户已关联本 Listing，无需再次填写 Trade URL。</p>
                    ) : linkedAccount?.linked ? (
                      <p className="warning-text small">
                        本订单当前关联了另一个 Steam 账户；点击购买会改用所选账户（仅付款前允许更换）。
                      </p>
                    ) : null}

                    <h3>付款并锁定 Price</h3>
                    <p className="muted small">
                      付款后 10 分钟内卖家必须让 helper 发 offer 并 mark；否则任何人都能触发退款。S1
                      没有买家主动取消，请确认金额与物品。
                    </p>
                    <button
                      className="button primary wide"
                      disabled={
                        actionBusy !== null ||
                        wrongChain ||
                        !relayToken ||
                        !selectedAccountId
                      }
                      onClick={() => void buy()}
                    >
                      {actionBusy === "buy" ? "等待交易…" : `Buy · ${formatEth(listing.price)} ETH`}
                    </button>
                    {!selectedAccountId ? (
                      <p className="warning-text small">
                        请先选择一个已保存的买家 Steam 账户。购买时会先加密关联 Trade URL 再付款，避免付款后无交付信息。
                      </p>
                    ) : !selectedAccountLinked ? (
                      <p className="muted small">点击购买会先把所选账户关联到订单，再打开 MetaMask 付款。</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {listing.status === ListingStatus.Funded && account ? (
              <div className="action-block">
                {isSeller ? (
                  <>
                    <div className="banner warn">
                      买家已付款。先让本地 helper 发送 Steam offer，并在 helper 上报后立刻在链上 mark。
                      <strong> mark 之前不要让买家接受 offer。</strong>
                    </div>
                    <div className="kv"><span>Offer window</span><strong>{countdown(listing.offerDeadline, now)}</strong></div>
                    {report?.offer ? (
                      <button
                        className="button primary wide"
                        disabled={actionBusy === "mark" || wrongChain || !offerOpen}
                        onClick={() => void markOfferSent()}
                      >
                        {actionBusy === "mark" ? "等待交易…" : "Mark helper 上报的 Offer"}
                      </button>
                    ) : (
                      <p className="muted small">
                        暂无 helper 上报的 offer。启动 <code>npm run helper</code>，它会处理这笔 Funded
                        订单。不要自行输入未知 hash。
                      </p>
                    )}
                    {report?.offer && offerOpen ? (
                      <p className="muted small">
                        mark 会记录交易 hash 并重置为 OfferSent；它不释放托管资金。
                      </p>
                    ) : null}
                  </>
                ) : null}

                {isBuyer ? (
                  <>
                    <div className="banner warn">
                      等待卖家 mark 为 OfferSent 后，再接受 Steam offer。过早接受会跳过卖家的
                      Accepted 证据流程；若你确认已收到物品，仍可使用下方的确认收货。
                    </div>
                    {linkedAccount?.linked ? (
                      <div className="subpanel">
                        <p className="ok-text small">
                          已关联买家 Steam 账户{" "}
                          {linkedAccount.nickname || `SteamID64 ${linkedAccount.steamId64}`}。
                          helper 会使用该账户的加密 Trade URL 发送 offer。
                        </p>
                        {relayToken ? (
                          <details>
                            <summary className="muted small">更换/更新关联账户</summary>
                            <p className="warning-text small">
                              仅在 helper 尚未发送 Steam offer 时使用。若卖家已在 Steam 发送报价，
                              更换账户会导致该报价作废；请先联系卖家。
                            </p>
                            <SteamAccountPicker
                              token={relayToken}
                              selectedId={selectedAccountId}
                              onSelect={setSelectedAccountId}
                              disabled={actionBusy !== null}
                            />
                            <button
                              type="button"
                              className="button wide"
                              disabled={!selectedAccountId || actionBusy !== null}
                              onClick={() => void saveSelectedAccountToOrder()}
                            >
                              {actionBusy === "link-account"
                                ? "更新中…"
                                : "更新订单关联账户"}
                            </button>
                          </details>
                        ) : null}
                      </div>
                    ) : linkedAccount?.linked === false ? (
                      <div className="subpanel">
                        <h3>补充买家 Steam 账户</h3>
                        <p className="muted small">
                          你付款时没有关联 Trade URL。请在卖家发送 offer 前选择/添加账户并关联；若
                          helper 已经发送 offer，请勿更换账户，否则无法按原报价交付。
                        </p>
                        {relayToken ? (
                          <>
                            <SteamAccountPicker
                              token={relayToken}
                              selectedId={selectedAccountId}
                              onSelect={setSelectedAccountId}
                              disabled={actionBusy !== null}
                            />
                            <button
                              type="button"
                              className="button wide"
                              disabled={!selectedAccountId || actionBusy !== null}
                              onClick={() => void saveSelectedAccountToOrder()}
                            >
                              {actionBusy === "link-account"
                                ? "关联中…"
                                : "关联所选账户到订单"}
                            </button>
                          </>
                        ) : (
                          <p className="warning-text small">Relay 未登录，请先完成钱包签名登录。</p>
                        )}
                      </div>
                    ) : (
                      <p className="muted small">正在读取订单关联的买家 Steam 账户…</p>
                    )}
                    <div className="kv"><span>卖家 offer deadline</span><strong>{offerOpen ? countdown(listing.offerDeadline, now) : "已过期，可退款"}</strong></div>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={receiptAcknowledged}
                        onChange={(event) => setReceiptAcknowledged(event.target.checked)}
                      />
                      <span>我已在 Steam 中收到物品；确认后 Listing 立即 Completed，不可撤销。</span>
                    </label>
                    <button
                      className="button primary wide"
                      disabled={!receiptAcknowledged || actionBusy === "confirm" || wrongChain}
                      onClick={() => void confirmReceipt()}
                    >
                      {actionBusy === "confirm" ? "等待交易…" : "确认收货（不可逆）"}
                    </button>
                  </>
                ) : null}

                {!offerOpen ? (
                  <div className="subpanel">
                    <h3>退款</h3>
                    <p className="muted small">
                      卖家未在 offer window 内 mark。任何人都可以触发退款；买家 Price、卖家 Bond 进入各自
                      withdrawable，需要主动 withdraw。
                    </p>
                    <button className="button wide" disabled={actionBusy === "expire" || wrongChain} onClick={() => void expireOrder()}>
                      {actionBusy === "expire" ? "等待交易…" : "Expire 并退款"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {listing.status === ListingStatus.OfferSent && account ? (
              <div className="action-block">
                {isSeller ? (
                  <>
                    <p className="muted small">
                      Offer 已在链上 mark。等待买家在 Steam 接受；helper 观测到 Accepted(3) 后会把证据
                      hash 上报到 Relay，届时你才能 claim。
                    </p>
                    {report?.evidence ? (
                      <button
                        className="button primary wide"
                        disabled={actionBusy === "claim" || wrongChain}
                        onClick={() => void claimAccepted()}
                      >
                        {actionBusy === "claim" ? "等待交易…" : "Claim Accepted 证据"}
                      </button>
                    ) : (
                      <div className="banner warn">
                        还没有 Accepted(3) 证据。确认 helper 在线，且买家已在 Steam 接受 offer。
                      </div>
                    )}
                  </>
                ) : null}
                {isBuyer ? (
                  <>
                    <p className="muted small">
                      卖家已记录 offer hash。现在可以接受 Steam offer；确认收到物品后再确认收货。
                    </p>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={receiptAcknowledged}
                        onChange={(event) => setReceiptAcknowledged(event.target.checked)}
                      />
                      <span>我已在 Steam 中收到物品；确认后不可撤销。</span>
                    </label>
                    <button
                      className="button primary wide"
                      disabled={!receiptAcknowledged || actionBusy === "confirm" || wrongChain}
                      onClick={() => void confirmReceipt()}
                    >
                      {actionBusy === "confirm" ? "等待交易…" : "确认收货（不可逆）"}
                    </button>
                  </>
                ) : null}
                {!isSeller && !isBuyer ? <p className="muted">等待买卖双方处理。</p> : null}
              </div>
            ) : null}

            {listing.status === ListingStatus.ClaimPending && account ? (
              <div className="action-block">
                <div className="banner warn">
                  卖家已提交证据，进入 {countdown(listing.challengeDeadline, now)} 挑战窗口。
                  {challengeOpen ? " 窗口结束后任何人都可 finalize。" : " 现在可以 finalize。"}
                </div>
                {isBuyer ? (
                  <>
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={receiptAcknowledged}
                        onChange={(event) => setReceiptAcknowledged(event.target.checked)}
                      />
                      <span>我确认已收到物品，可立即结算给卖家（不可逆）。</span>
                    </label>
                    <button
                      className="button"
                      disabled={!receiptAcknowledged || actionBusy === "confirm" || wrongChain}
                      onClick={() => void confirmReceipt()}
                    >
                      {actionBusy === "confirm" ? "等待交易…" : "确认收货"}
                    </button>
                  </>
                ) : null}
                <button
                  className="button primary wide"
                  disabled={challengeOpen || actionBusy === "finalize" || wrongChain}
                  onClick={() => void finalizeClaim()}
                >
                  {actionBusy === "finalize" ? "等待交易…" : challengeOpen ? "挑战窗口未结束" : "Finalize 结算"}
                </button>
                <p className="muted small">finalize 是 permissionless：任何地址都能调用，结算进入卖家 withdrawable。</p>
              </div>
            ) : null}

            {terminal && account ? (
              <div className="action-block">
                <h3>{listing.status === ListingStatus.Completed ? "交易完成" : "已退款"}</h3>
                <p className="muted small">
                  {listing.status === ListingStatus.Completed
                    ? "款项已进入卖家 withdrawable。若你是卖家，请在顶部 Withdraw。"
                    : "买家 Price 与卖家 Bond 已进入各自 withdrawable；请在顶部 Withdraw。"}
                </p>
                <p className="muted small">Relay 会在 5 秒内清理该 listing 的买家 Trade URL 密文。</p>
              </div>
            ) : null}

            {!account ? <p className="muted small">连接钱包后才会显示与你身份相关的操作。</p> : null}
          </div>

          <div className="panel">
            <h2>S1 安全边界</h2>
            <ul className="checklist">
              <li>只在 Hardhat 本地链 / 测试 ETH 上运行，不部署到 Sepolia。</li>
              <li>链上不保存完整 Trade URL、Steam 凭据或平台托管资产。</li>
              <li>买家在 Steam 接受 offer，并使用手机 Steam Guard 确认；helper 不会代买家接受。</li>
              <li>卖家本地 helper 不持有钱包私钥，不会自动签 mark/claim。</li>
              <li>Seller claim 后存在挑战窗口；S1 没有争议仲裁，超时后任何人都能 finalize。</li>
              <li>金额结算为 pull payment，必须主动 withdraw；S1 不支持取消/仲裁。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
