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
          <p className="eyebrow">BUYER PROFILE</p>
          <h1>买家 Steam 账户</h1>
          <p className="muted">
            每个 MetaMask 钱包可以保存多个买家 Steam 账户。购买时选择头像与昵称即可，
            Trade URL 不需要每次重新填写。
          </p>
        </div>
      </div>

      {!account ? (
        <div className="empty-state">
          <p>连接 MetaMask 以管理当前钱包的买家 Steam 账户。</p>
          <button className="button primary" onClick={() => void connect()}>连接 MetaMask</button>
        </div>
      ) : !relayToken ? (
        <div className="empty-state">
          <p>Relay 未登录。请完成钱包签名，以读取该钱包保存的 Steam 账户。</p>
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
            <li>Trade URL 与库存 ID / SteamID64 必须属于同一个 Steam 账户，用于防止填错账户。</li>
            <li>昵称与头像来自 Steam 公开资料；Relay 不保存 Steam 密码、cookie 或移动令牌。</li>
            <li>账户只属于当前钱包。删除已保存账户不会删除已关联订单中的加密 URL；订单终态后自动清理。</li>
          </ul>
        </div>
      )}
    </section>
  );
}
