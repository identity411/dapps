import { useState } from "react";
import { SteamAccountPicker } from "./SteamAccountPicker";
import { useWallet } from "./wallet";

export function Accounts() {
  const { account, relayToken, authState, connect, reauthenticate } = useWallet();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  return (
    <section className="page narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">STEAM ACCOUNTS</p>
          <h1>我的 Steam 账户</h1>
          <p className="muted">
            每个 MetaMask 钱包可以绑定多个收货 Steam 账户。购买时选择头像与昵称即可，
            Trade URL 不需要每次重新填写。
          </p>
        </div>
      </div>

      {!account ? (
        <div className="empty-state">
          <p>连接 MetaMask 以管理当前钱包绑定的 Steam 账户。</p>
          <button className="button primary" onClick={() => void connect()}>连接 MetaMask</button>
        </div>
      ) : !relayToken ? (
        <div className="empty-state">
          <p>Relay 未登录。请完成钱包签名，以读取当前钱包绑定的 Steam 账户。</p>
          {authState !== "signing" ? (
            <button className="button primary" onClick={() => void reauthenticate()}>
              钱包签名登录
            </button>
          ) : (
            <p className="muted small">签名登录中…</p>
          )}
        </div>
      ) : (
        <div className="panel">
          <SteamAccountPicker
            token={relayToken}
            selectedId={selectedAccountId}
            onSelect={setSelectedAccountId}
            manageOnly
          />
          <div className="divider" />
          <h2>安全边界</h2>
          <ul className="checklist">
            <li>添加账户时，Relay 只接受一次 Trade URL 并立即加密；列表接口永远不会把 URL 返回给 Web。</li>
            <li>Trade URL 的 partner 与 SteamID64 必须属于同一个 Steam 账户，用于防止填错账户。</li>
            <li>昵称与头像来自 Steam 公开资料；Relay 不保存 Steam 密码、cookie 或移动令牌。</li>
            <li>Relay 不验证 Steam 登录，只校验 Trade URL 与 SteamID64 属于同一账户；请只添加你控制的账户。</li>
            <li>账户只绑定当前钱包。删除绑定不会删除已关联订单中的加密 URL；订单终态后自动清理。</li>
            <li>卖家发货用的 Steam 账户在 Sell 页通过 helper 扫码绑定，不在这里管理。</li>
          </ul>
        </div>
      )}
    </section>
  );
}
