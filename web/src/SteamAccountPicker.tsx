import { useCallback, useEffect, useState } from "react";
import { parseSteamInventoryId, parseTradeUrl } from "@skinpact/shared";
import {
  RelayError,
  createSteamAccount,
  deleteSteamAccount,
  listSteamAccounts,
  type SavedSteamAccount,
} from "./relay";
import { errorText } from "./utils";

interface Props {
  token: string;
  selectedId: string | null;
  onSelect: (accountId: string | null) => void;
  disabled?: boolean;
  manageOnly?: boolean;
}

export function accountErrorText(error: unknown): string {
  if (error instanceof RelayError) {
    switch (error.code) {
      case "trade_url_invalid":
        return "Trade URL 无效。请使用 https://steamcommunity.com/tradeoffer/new/?partner=…&token=… 链接。";
      case "inventory_id_invalid":
        return "SteamID64 无效。请输入 SteamID64 或 https://steamcommunity.com/profiles/<SteamID64>/inventory/ 链接。";
      case "steam_account_mismatch":
        return "Trade URL 与 SteamID64 不属于同一个 Steam 账户。";
      case "steam_account_not_found":
        return "该 Steam 账户不存在或不属于当前钱包。";
      case "auth_required":
      case "auth_invalid":
        return "钱包登录已过期，请重新签名登录。";
      case "rate_limited":
        return "操作太频繁，请稍后再试。";
      default:
        return `Relay 返回错误：${error.code}`;
    }
  }
  return errorText(error);
}

export function SteamAccountPicker({
  token,
  selectedId,
  onSelect,
  disabled = false,
  manageOnly = false,
}: Props) {
  const [accounts, setAccounts] = useState<SavedSteamAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tradeUrl, setTradeUrl] = useState("");
  const [inventoryId, setInventoryId] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await listSteamAccounts(token));
    } catch (loadError) {
      setError(accountErrorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId && accounts.length > 0 && !accounts.some((account) => account.id === selectedId)) {
      onSelect(null);
    }
  }, [accounts, selectedId, onSelect]);

  async function saveAccount() {
    setError(null);
    setNotice(null);
    if (!tradeUrl.trim()) {
      setError("请输入 Steam 交易链接（Trade URL）。");
      return;
    }
    if (!inventoryId.trim()) {
      setError("请输入 SteamID64 或库存页面 URL。");
      return;
    }
    let parsedUrl: ReturnType<typeof parseTradeUrl>;
    try {
      parsedUrl = parseTradeUrl(tradeUrl.trim());
    } catch {
      setError(
        "Trade URL 无效。请使用 https://steamcommunity.com/tradeoffer/new/?partner=…&token=… 链接。",
      );
      return;
    }

    let inventorySteamId: string;
    try {
      inventorySteamId = parseSteamInventoryId(inventoryId.trim());
    } catch {
      setError(
        "SteamID64 无效。请输入 SteamID64 或 https://steamcommunity.com/profiles/<SteamID64>/inventory/ 链接。",
      );
      return;
    }
    if (parsedUrl.steamId64 !== inventorySteamId) {
      setError("Trade URL 与 SteamID64 不属于同一个 Steam 账户。");
      return;
    }

    setBusy("save");
    try {
      const account = await createSteamAccount(token, tradeUrl.trim(), inventoryId.trim());
      setAccounts((current) => [
        account,
        ...current.filter((candidate) => candidate.id !== account.id),
      ]);
      onSelect(account.id);
      setTradeUrl("");
      setInventoryId("");
      setShowForm(false);
      setNotice(`已保存 Steam 账户 ${account.nickname}（${account.steamId64}）。`);
    } catch (saveError) {
      setError(accountErrorText(saveError));
    } finally {
      setBusy(null);
    }
  }

  async function removeAccount(account: SavedSteamAccount) {
    if (!window.confirm(`移除 Steam 账户 ${account.nickname}？已关联订单中的加密 Trade URL 不会被删除。`)) {
      return;
    }
    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      await deleteSteamAccount(token, account.id);
      setAccounts((current) => current.filter((candidate) => candidate.id !== account.id));
      if (selectedId === account.id) onSelect(null);
      setNotice(`已移除 ${account.nickname}。`);
    } catch (deleteError) {
      setError(accountErrorText(deleteError));
    } finally {
      setBusy(null);
    }
  }

  const selected = accounts.find((account) => account.id === selectedId) ?? null;

  return (
    <div className="subpanel steam-account-panel">
      <div className="steam-account-heading">
        <div>
          <h3>{manageOnly ? "管理我的 Steam 账户" : "收货 Steam 账户"}</h3>
          <p className="muted small">
            {manageOnly
              ? "这些账户绑定到当前 MetaMask 钱包；购买时可直接选择，不需要重新粘贴 Trade URL。"
              : "选择当前钱包绑定的收货账户，付款时自动关联订单，不需要重新粘贴 Trade URL。"}
          </p>
        </div>
        <button
          type="button"
          className="button tiny"
          disabled={disabled || busy !== null}
          onClick={() => {
            if (showForm) {
              setTradeUrl("");
              setInventoryId("");
            }
            setShowForm((value) => !value);
            setError(null);
            setNotice(null);
          }}
        >
          {showForm ? "取消" : "添加账户"}
        </button>
      </div>

      {error ? <div className="banner error compact-inline">{error}</div> : null}
      {notice ? <p className="ok-text small">{notice}</p> : null}

      {loading ? (
        <p className="muted small">读取已保存的 Steam 账户…</p>
      ) : error && accounts.length === 0 ? null : accounts.length === 0 ? (
        <p className="muted small">
          还没有保存 Steam 账户。添加后，购买任意商品时可直接选择，无需重复填写 Trade URL。
        </p>
      ) : (
        <div
          className="steam-account-grid"
          role={manageOnly ? undefined : "radiogroup"}
          aria-label={manageOnly ? "已保存的 Steam 账户" : "选择收货 Steam 账户"}
        >
          {accounts.map((account) => {
            const isSelected = !manageOnly && account.id === selectedId;
            const avatar = account.avatarUrl ? (
              <img
                className="steam-avatar"
                src={account.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="steam-avatar fallback" aria-hidden="true">
                {account.nickname.slice(0, 1).toUpperCase()}
              </span>
            );
            const copy = (
              <span className="steam-account-copy">
                <strong>{account.nickname}</strong>
                <span className="muted small">{account.steamId64}</span>
              </span>
            );
            return (
              <div
                key={account.id}
                className={`steam-account-card${isSelected ? " selected" : ""}${
                  manageOnly ? " manage" : ""
                }`}
              >
                {manageOnly ? (
                  <div className="steam-account-main">
                    {avatar}
                    {copy}
                  </div>
                ) : (
                  <label className="steam-account-main">
                    <input
                      type="radio"
                      name="buyer-steam-account"
                      checked={isSelected}
                      disabled={disabled || busy !== null}
                      onChange={() => {
                        onSelect(account.id);
                        setError(null);
                        setNotice(null);
                      }}
                    />
                    {avatar}
                    {copy}
                  </label>
                )}
                <button
                  type="button"
                  className="link-button danger"
                  disabled={disabled || busy !== null}
                  onClick={() => void removeAccount(account)}
                >
                  移除
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!manageOnly && selected ? (
        <p className="ok-text small">
          已选择 {selected.nickname} · SteamID64 {selected.steamId64}
        </p>
      ) : !manageOnly && accounts.length > 0 ? (
        <p className="warning-text small">请选择一个收货 Steam 账户后再付款。</p>
      ) : null}

      {showForm ? (
        <div className="steam-account-form">
          <p className="muted small">
            添加时只把 Trade URL 发送给 Relay 一次并加密保存；之后界面只显示昵称、头像和 SteamID64。
            链上 Funded 后，完整 URL 只会向该订单卖家的本地 helper 揭示；卖家 Web 不显示。
          </p>
          <label className="field">
            <span>Steam 交易链接（Trade URL）</span>
            <input
              value={tradeUrl}
              onChange={(event) => setTradeUrl(event.target.value)}
              placeholder="https://steamcommunity.com/tradeoffer/new/?partner=…&token=…"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled || busy !== null}
            />
          </label>
          <label className="field">
            <span>SteamID64（或库存页面 URL）</span>
            <input
              value={inventoryId}
              onChange={(event) => setInventoryId(event.target.value)}
              placeholder="SteamID64 或 https://steamcommunity.com/profiles/<SteamID64>/inventory/"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled || busy !== null}
            />
          </label>
          <p className="muted small">
            Trade URL 的 partner 与 SteamID64 必须属于同一个 Steam 账户。Relay 会读取该账户的公开昵称与头像用于展示。
          </p>
          <button
            type="button"
            className="button primary"
            disabled={disabled || busy !== null}
            onClick={() => void saveAccount()}
          >
            {busy === "save" ? "验证并保存中…" : "验证并保存"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
