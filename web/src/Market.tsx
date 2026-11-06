import { useEffect, useState } from "react";
import { ListingStatus } from "@skinpact/shared";
import { CONTRACT_CONFIGURED, NETWORK_NAME } from "./config";
import { readAllListings, type ListingWithId } from "./contract";
import { getMetadata, type PublicMetadata } from "./relay";
import { errorText, formatEth, shortAddress } from "./utils";

interface MarketRow {
  listingId: string;
  listing: ListingWithId["listing"];
  metadata: PublicMetadata | null;
}

export function Market() {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const active = all.filter((entry) => entry.listing.status === ListingStatus.Active);
        const enriched = await Promise.all(
          active.map(async (entry): Promise<MarketRow> => {
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
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reloadKey]);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARKET · ACTIVE LISTINGS</p>
          <h1>现货市场</h1>
          <p className="muted">
            价格与卖家保证金在 {NETWORK_NAME} 托管。物品交付仍通过 Steam trade offer。
          </p>
        </div>
        <button className="button" onClick={() => setReloadKey((value) => value + 1)}>
          刷新
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <div className="empty-state">读取链上 listings…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h2>暂无 Active 挂牌</h2>
          <p>前往 Sell 绑定 SteamID64、选一个可交易 CS2 物品并定价。</p>
          <a className="button primary" href="#/sell">
            去挂牌
          </a>
        </div>
      ) : (
        <div className="card-grid">
          {rows.map((row) => (
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
                <h2>{row.metadata?.marketHashName || "Metadata 未在 Relay 中找到"}</h2>
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
                <a className="button primary wide" href={`#/order/${row.listingId}`}>
                  打开 Trade Room
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
