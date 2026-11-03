import { useEffect, useState } from "react";
import { ListingStatus } from "@skinpact/shared";
import { CONTRACT_CONFIGURED } from "./config";
import { readAllListings, type ListingWithId } from "./contract";
import { getMetadata, type PublicMetadata } from "./relay";
import { errorText, formatEth, shortAddress, shortHash, statusName } from "./utils";
import { useWallet } from "./wallet";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface OrderRow extends ListingWithId {
  metadata: PublicMetadata | null;
}

function statusTone(status: ListingStatus): string {
  switch (status) {
    case ListingStatus.Active:
    case ListingStatus.Funded:
    case ListingStatus.OfferSent:
      return "live";
    case ListingStatus.ClaimPending:
      return "warn";
    case ListingStatus.Completed:
      return "ok";
    default:
      return "neutral";
  }
}

function roleLabel(row: OrderRow, account: string | null): string | null {
  if (!account) return null;
  if (row.listing.seller.toLowerCase() === account.toLowerCase()) return "我卖的";
  if (
    row.listing.buyer !== ZERO_ADDRESS &&
    row.listing.buyer.toLowerCase() === account.toLowerCase()
  ) {
    return "我买的";
  }
  return null;
}

export function Orders() {
  const { account } = useWallet();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!CONTRACT_CONFIGURED) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const all = await readAllListings();
        const enriched = await Promise.all(
          all.map(async (entry): Promise<OrderRow> => {
            let metadata: PublicMetadata | null = null;
            try {
              metadata = await getMetadata(entry.listing.itemHash);
            } catch {
              metadata = null;
            }
            return { ...entry, metadata };
          }),
        );
        if (!cancelled) {
          setRows(enriched);
          setError(null);
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
  }, [reloadKey]);

  const mine = account
    ? rows.filter(
        (row) =>
          row.listing.seller.toLowerCase() === account.toLowerCase() ||
          (row.listing.buyer !== ZERO_ADDRESS &&
            row.listing.buyer.toLowerCase() === account.toLowerCase()),
      )
    : [];
  const visible = onlyMine ? mine : rows;
  const empty = !loading && visible.length === 0;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORDERS · ALL LISTINGS</p>
          <h1>订单</h1>
          <p className="muted">
            从 Active 到 Completed/Refunded 的每一笔链上订单都在这里；切换 MetaMask 账户可查看对应买家或卖家订单。
          </p>
        </div>
        <div className="orders-toolbar">
          <button
            className={`button tiny${onlyMine ? " primary" : ""}`}
            onClick={() => setOnlyMine((value) => !value)}
          >
            只看我的
          </button>
          <button className="button" onClick={() => setReloadKey((value) => value + 1)}>
            刷新
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <div className="empty-state">读取链上订单…</div>
      ) : empty ? (
        <div className="empty-state">
          <h2>{onlyMine ? "当前钱包还没有订单" : "暂无订单"}</h2>
          <p>
            {onlyMine
              ? "买家付款后订单会出现在这里；也可以先到市场看看。"
              : "前往 Sell 挂牌，或在 Market 购买一件物品。"}
          </p>
          <div className="orders-toolbar">
            <a className="button" href="#/market">
              去市场
            </a>
            <a className="button primary" href="#/sell">
              去挂牌
            </a>
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((row) => {
            const role = roleLabel(row, account);
            return (
              <article className="skin-card" key={row.listingId}>
                <div className="skin-image">
                  {row.metadata?.imageUrl ? (
                    <img src={row.metadata.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="placeholder">CS2 ITEM</span>
                  )}
                  <span className="listing-id">#{row.listingId}</span>
                </div>
                <div className="skin-body">
                  <div className="meta-line">
                    <span className={`status-pill ${statusTone(row.listing.status)}`}>
                      {statusName(row.listing.status)}
                    </span>
                    {role ? <span className="badge">{role}</span> : null}
                  </div>
                  <h2 title={row.listing.itemHash}>
                    {row.metadata?.marketHashName || shortHash(row.listing.itemHash)}
                  </h2>
                  <div className="price-row">
                    <div>
                      <span className="label">Price</span>
                      <strong>{formatEth(row.listing.price)} ETH</strong>
                    </div>
                    <div>
                      <span className="label">Seller bond</span>
                      <span>{formatEth(row.listing.bond)} ETH</span>
                    </div>
                  </div>
                  <div className="meta-line">
                    <span>Seller</span>
                    <code>{shortAddress(row.listing.seller)}</code>
                  </div>
                  <div className="meta-line">
                    <span>Buyer</span>
                    <code>
                      {row.listing.buyer === ZERO_ADDRESS
                        ? "尚未购买"
                        : shortAddress(row.listing.buyer)}
                    </code>
                  </div>
                  <a className="button primary wide" href={`#/order/${row.listingId}`}>
                    打开 Trade Room
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
