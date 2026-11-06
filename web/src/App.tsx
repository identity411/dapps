import { useEffect, useState } from "react";
import { Accounts } from "./Accounts";
import { Header } from "./Header";
import { Market } from "./Market";
import { OrderRoom } from "./OrderRoom";
import { Orders } from "./Orders";
import { Sell } from "./Sell";
import { CONTRACT_CONFIGURED, CHAIN_ID, NETWORK_NAME } from "./config";
import { useWallet } from "./wallet";

function currentRoute(): string {
  return window.location.hash.replace(/^#/, "") || "/market";
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const { hasWallet, chainId } = useWallet();

  useEffect(() => {
    if (!window.location.hash) window.location.hash = "#/market";
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const orderMatch = /^\/order\/(\d{1,12})$/.exec(route);

  let page;
  if (route === "/market") page = <Market />;
  else if (route === "/orders") page = <Orders />;
  else if (route === "/accounts") page = <Accounts />;
  else if (route === "/sell") page = <Sell />;
  else if (orderMatch) page = <OrderRoom listingId={orderMatch[1]!} />;
  else {
    page = (
      <section className="page narrow">
        <div className="empty-state">
          <h1>Page not found</h1>
          <p>这个 S2-mini 演示只有 Market、Orders、Accounts、Sell 和 Trade Room。</p>
          <a className="button primary" href="#/market">返回市场</a>
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      {!hasWallet ? (
        <div className="setup-banner">
          未检测到 MetaMask。请安装浏览器扩展；本 DApp 只在 Hardhat 本地链或 Sepolia 测试网运行，
          不需要真实资金。
        </div>
      ) : null}
      {!CONTRACT_CONFIGURED ? (
        <div className="setup-banner">
          没有找到部署地址。本地请先运行 <code>npm run chain</code> 和
          <code> npm run deploy:local</code>，再重启 <code>npm run web</code>；Sepolia 请配置
          <code> web/.env.sepolia</code> 并运行 <code>npm run web:sepolia</code>。
        </div>
      ) : null}
      {hasWallet && chainId !== null && chainId !== CHAIN_ID ? (
        <div className="setup-banner">
          钱包网络为 chainId {chainId}。当前 DApp 配置为 {NETWORK_NAME}（{CHAIN_ID}）；请在顶部切换。
        </div>
      ) : null}
      <main>{page}</main>
      <footer className="footer">
        <span>SkinPact S2-mini · {NETWORK_NAME} {CHAIN_ID} · test ETH only</span>
        <span>Steam 交付由卖家本地 helper 发起；平台不托管物品、不保存 Trade URL 明文。</span>
      </footer>
    </div>
  );
}
