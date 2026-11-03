# SkinPact

一个面向 CS2 饰品的 DApp 课程项目原型：用 **测试 ETH** 托管交易款，用 **Steam trade offer** 交付饰品，绕开第三方平台手续费，同时不把 Steam 登录态或买家 Trade URL 交给平台托管。

> **S1 只允许本地 Hardhat 链（chainId 31337）。**
> 当前合约没有争议、仲裁、卖家取消和 `OfferSent` 后超时退款，**绝对不能部署到 Sepolia 或其他公开网络**。S2 补齐这些路径后才考虑 testnet。

## 当前状态

| 部分 | 状态 |
|---|---|
| `SkinPactMarket` S1 合约 + 状态机 | ✅ 本地部署可用，20 个测试通过 |
| 共享 TypeScript 包（哈希 / ABI / Trade URL 解析） | ✅ 1 个测试通过 |
| Relay（钱包登录 / 库存 / 加密 Buyer URL vault / 买家 Steam 账户 / helper 配对 / 证据） | ✅ 18 个测试通过 |
| 卖家本地 helper（Steam 登录态、发 offer、观测 Accepted、本地账本、loopback 扫码 API） | ✅ 12 个单元测试通过；Web 扫码登录/自动配对已接入；已用真实 Steam 账号跑通发 offer 与 Accepted 证据 |
| React Web（Market / Orders / Accounts / Sell / Trade Room / withdraw） | ✅ 构建通过；手动 UI 走查待 review |
| 本地链 P1–P4 E2E（合约 + Relay） | ✅ `npm run e2e:local` 通过；Steam 传输为明确标注的 mock |
| Stage 0 真实 Steam offer | ✅ 已完成（见 Stage 0 spec）；S1 helper 已用真实账号复测 |

真实 Steam 交付需要卖家扫码登录自己的 Steam 账号并由买家在手机 Steam Guard 中接受，不能由自动化测试代替，也不应伪造。

## 架构

```mermaid
flowchart LR
    Buyer["Buyer Web<br/>MetaMask"] -->|price| Contract["SkinPactMarket<br/>Hardhat 31337"]
    Seller["Seller Web<br/>MetaMask"] -->|bond + listing| Contract
    Buyer -->|"加密 Trade URL"| Relay["Relay<br/>Express + SQLite"]
    Seller -->|"SteamID64 (auto from QR) / metadata"| Relay
    Seller -->|"127.0.0.1: auto-pair + Steam QR"| Helper["Seller Local Helper<br/>steam-session"]
    Helper -->|"one-time pairing code (auto) → scoped token"| Relay
    Relay -->|"Funded orders + Buyer URL"| Helper
    Helper -->|"trade offer from seller account"| Steam["Steam"]
    Steam -->|"buyer accepts + Steam Guard"| Buyer
    Helper -->|"offer ID hash / Accepted(3) evidence"| Relay
    Seller -->|"markOfferSent / claimAccepted"| Contract
    Contract -->|"pull payments"| Seller
    Contract -->|"refund if no offer"| Buyer
```

- **Relay 不托管资金或饰品，也不保存 Steam session。**
- **Helper 不接收卖家钱包私钥，不自动签链上交易，不替买家接受 offer。**
- **Buyer Trade URL 是 bearer secret**：Relay 用 AES-256-GCM 加密保存，只在链上 `Funded` 后向该 listing 的卖家/helper 揭示；API 不记录请求体/URL，listing 终态后删除。Web 的卖家界面不展示 URL。

## 快速开始（本地）

前置：Node.js ≥ 20、npm、MetaMask 浏览器扩展。真实 Steam 手动测试另需两个启用 Steam Guard Mobile Authenticator > 7 天的测试账号。

```bash
npm install
cp .env.example .env

# 生成并填入 .env 的两个 Relay 密钥
openssl rand -hex 32     # JWT_SECRET
openssl rand -base64 32  # RELAY_ENCRYPTION_KEY
```

`npm run chain/deploy:local/relay/helper` 都会显式读取**仓库根目录**的 `.env`（即使 npm workspace 把 cwd 切到了子目录），不需要把 `.env` 复制到 `relay/` 或 `helper/`。

打开三个终端：

```bash
# 1) 本地链
npm run chain

# 2) 部署（会写出 deployments/local.json，gitignored）
npm run deploy:local

# 把 deployments/local.json 里的 address 填入 .env 的 CONTRACT_ADDRESS
# 然后启动 Relay
npm run relay
```

```bash
# 3) Web
npm run web
# http://localhost:5173
```

MetaMask 添加本地网络：

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: ETH

从 `npm run chain` 的输出导入两个 **Hardhat 测试账户**，分别作为 seller 和 buyer。这些私钥是公开的开发助记词，**只能用于本地链，绝不能用于真实资金**。

### 卖家本地 helper（扫码登录）

1. 另开一个终端启动 helper 并保持运行：

```bash
npm run helper
```

helper 只在 `127.0.0.1:8788` 提供本地 API，不监听公网。
2. 打开 Web 的 **Sell** 页，连接 MetaMask 并完成 Relay 钱包签名登录。页面会通过 loopback 自动把 helper 配对到当前钱包（配对码不可见，无需复制），随后显示 Steam 二维码。
3. 用**卖家账号**的 Steam 手机令牌扫码。helper 在本机保存 Steam 登录态，Web 自动绑定扫码得到的 SteamID64 并加载 CS2 库存。
4. 选择物品、定价并创建 Listing。helper 显示“已就绪”后才会允许挂牌。

helper 会把 helper token、Steam refresh token 和本地发送账本写入 `helper/.skinpact-helper/`（600 权限、gitignored），**不会**把 Steam session 发给 Relay，也不会存 Buyer Trade URL。浏览器只拿到 QR 图片与公开的 SteamID64，不能拿到 Steam token/refresh token。

`npm run helper -- --cli` 是旧的无浏览器终端流程；`--check` 只检查本地状态，不登录 Steam、不发 offer；`--once` 只跑一轮轮询（仅旧 CLI 流程）。

## 最小交易流程

Market 只展示 `Active` 挂牌；**Orders** 页展示所有状态的订单，并可按当前 MetaMask 钱包筛选“只看我的”。**Accounts** 页按当前 MetaMask 钱包管理买家 Steam 账户，可在下单前先添加。买卖双方都可以从订单卡进入同一个 Trade Room。

1. **卖家挂牌**：Sell 页扫码登录 Steam，Web 自动绑定 SteamID64 → Relay 读取公开库存并生成 `itemHash` → web 调 `createListing(itemHash, price)` 并锁定 bond。
2. **买家选择已保存的 Steam 账户**：一个 MetaMask 钱包可保存多个买家 Steam 账户。首次添加时输入该账户的 Trade URL 和库存 ID / SteamID64，Relay 校验两者属于同一账户后加密保存；选择时展示 Steam 头像与昵称。Trade URL 不会回传到 Web，之后买其他 Listing 只需选择账户，不需要重新粘贴 URL。
3. **买家付款**：点击 Buy 时先把所选账户关联到该 Listing，再调用 `buy(listingId)` 精确支付 price，listing 进入 `Funded`，offer deadline 开始。若 Funded 订单仍缺少关联账户，可在卖家发 offer 前从 Trade Room 补充。
4. **helper 发 offer**：卖家 helper 拉取该卖家的 `Funded` 订单，校验 buyer SteamID/物品，从卖家 Steam 登录态创建 offer，并向 Relay 上报 offer ID hash。
5. **卖家 mark**：卖家在 Trade Room 看到 helper 上报的 hash 后签 `markOfferSent`。**此动作不放款**，只是链上声明。`OfferSent` 之前买家不要接受 Steam offer。
6. 交付完成后，三条路径之一：
   - **Buyer confirm**：买家勾选“已收到物品”并调 `confirmReceipt`，立即 `Completed`，seller withdrawable += price + bond。
   - **Seller claim**：helper 观测到 Steam `Accepted(3)` 并上报证据；卖家调 `claimAccepted(evidenceHash)` 进入 `ClaimPending`；挑战窗口结束后任何人可 `finalizeClaim`。
   - **No offer**：若卖家在 offer window 内未 mark，截止后任何人可 `expireOrder`，buyer price 与 seller bond 分别进入 pull payment。
7. 在 Header 查看 withdrawable 并主动 `withdraw()`。

`OfferSent` 后买家不确认、卖家不 claim 的场景在 S1 会锁住资金；S1 不做争议或超时退款，只用于本地受控演示。

### 真实 Steam 手动验收（已跑通一次）

1. 用两个自己的测试账号：卖家在 helper 扫码，买家手机 Steam Guard 可用。
2. 使用低价值、自己拥有的物品；买家库存需可交易。
3. 买家选择已保存的 Steam 账户并付款（账户在付款前关联）→ 启动 helper → 确认 helper 只发目标物品。
4. **等卖家在 Web 完成 `markOfferSent` 后**，买家再接受 Steam offer。
5. helper 观测到 `Accepted(3)` 后在 Relay 写入证据，卖家 claim；或买家直接确认收货。
6. 录屏/截图中遮挡 Steam 个人信息、Trade URL token、钱包私钥和 session。

如果真实链路阻塞，S1 的 E2E 使用**明确标注的 mock**（不接触 Steam），不能把 mock 当作真实 Accept 证据。

## 测试与验证

```bash
npm test          # shared + contract + relay + helper
npm run e2e:local # P1 buyer confirm / P2 claim+finalize / P3 expire / P4 privacy
npm run typecheck # shared + relay + helper + web + E2E scripts
npm run build     # Web TypeScript + Vite build
```

E2E 会启动一个临时的 Hardhat 节点、部署合约、以内存 SQLite 启动真实 Relay，并覆盖：

- P1：create → buy → 加密 URL → mock helper offer → mark → buyer confirm → Completed；seller withdrawable = price + bond。
- P2：claim → ClaimPending → 窗口前 finalize revert → 时间推进 → permissionless finalize。
- P3：不 mark → 超时 expire → Refunded；buyer price、seller bond 退回 pull payment；`OfferSent` 不可 expire。
- P4：未 Funded/错误 seller/错误 scope 拒绝 reveal；DB、metadata、report 无 URL token；终态清理。

## 环境变量

见 [`.env.example`](./.env.example)。关键项：

| 变量 | 说明 |
|---|---|
| `CONTRACT_ADDRESS` | 本地部署地址；复制自 `deployments/local.json` |
| `JWT_SECRET` | Relay 钱包登录 JWT；≥ 16 字符 |
| `RELAY_ENCRYPTION_KEY` | AES-256-GCM 密钥；32 bytes，base64 或 64 hex |
| `DB_PATH` | SQLite 路径，默认 `data/skinpact.db`（gitignored） |
| `SKINPACT_RELAY_URL` | helper 访问 Relay 的地址；非本地地址必须 HTTPS |
| `SKINPACT_HELPER_DIR` | helper 本地状态目录，默认 `helper/.skinpact-helper` |
| `HELPER_API_PORT` | helper 本地 API 端口，默认 `8788`，仅绑定 `127.0.0.1` |
| `HELPER_WEB_ORIGINS` | 允许调用 helper API 的 loopback Web origin，逗号分隔 |
| `VITE_HELPER_URL` | Web 访问本地 helper 的地址，默认 `http://127.0.0.1:8788` |

Web 的 Vite 默认读取 `deployments/local.json` 与本地默认地址，通常无需额外 env。

## S1 安全边界与已知限制

- 只支持本地链和测试 ETH；不允许真实货币、贵重饰品或公开网络。
- Buyer Trade URL 是私密 bearer URL：链上永不保存，Web 卖家 UI 不展示，Relay 加密保存并在终态删除；日志不打印 URL/请求体。买家 Steam 账户按钱包隔离，列表 API 只返回昵称、头像、SteamID64 与账户 ID，绝不返回 Trade URL；移除已保存账户不会删除已关联订单中的加密 URL，订单终态后仍按原逻辑清理。
- 没有 `Disputed`、Arbiter、`openDispute`/`resolveDispute`、`abortBySeller`、卖家取消。
- `OfferSent` 后买家一直不接受且卖家不 claim 时，资金会锁在合约中；S1 不退款。
- 卖家在 `markOfferSent` 之前买家可以接受 Steam offer，会造成链上状态与事实不一致；流程和 UI 强调“先 mark 再接受”，S1 只用受控账号。
- 卖家可以 mark 但实际上不发 offer；S1 无链上仲裁，只用于本地 demo。
- `claimAccepted` 证据是链下声明；S2 才补挑战/仲裁与更严格的证据策略。
- 结算使用 pull payment：双方必须主动 `withdraw()`。
- helper 是单卖家、单机组件：已登录的 Steam 账号会绑定到当前配对的钱包。请勿在共用/不受信任的电脑上运行；切换卖家钱包前先关闭 helper 并清除 `helper/.skinpact-helper/` 中的本地 Steam 登录态。
- helper 不自动确认 Steam Mobile Guard，不自动签链、不自动提现、不替买家接受。

## 仓库结构

```
contracts/       Solidity + Hardhat tests + local deploy
shared/          ABI、canonical JSON/keccak、hash、Trade URL parser
relay/           Express + SQLite，钱包登录、inventory、URL vault、helper API
helper/          卖家本地 Node helper（steam-session + trade offer manager）
web/             React + Vite + ethers v6
scripts/stage0/  Stage 0 可行性演示（只作参考，不复用于 S1）
scripts/         local E2E
specs/           MVP / Stage 0 / Stage 1 review specs
```

相关 spec：

- [MVP spec](./specs/2026-11-01-dapp-project-mvp-spec.md)
- [Stage 0 Steam feasibility](./specs/2026-11-02-stage-0-steam-tradeoffer-spec.md)
- [Stage 1 vertical slice](./specs/2026-11-03-stage-1-vertical-slice-spec.md)

## 常见问题

- **Web 显示“本地合约未配置”**：先 `npm run chain`、`npm run deploy:local`，再重启 `npm run web`。
- **绑定 SteamID 后库存为空或 `relay_timeout`**：Relay 需要访问 `steamcommunity.com` 读取公开库存。先验证：
  ```bash
  curl -4 -I --max-time 10 https://steamcommunity.com/
  ```
  如果超时，不是库存设置问题，而是 Relay 所在网络访问不了 Steam 社区。请开启系统级 VPN 的 TUN/全局模式（例如 iKuuuVPN）后重启 Relay。Relay 的库存读取按系统路由直连，不读取 `HTTPS_PROXY`；浏览器能打开 Steam 社区不代表 Node/Relay 也能访问。卖家 helper 也会连接 Steam Community，必须在同样的网络环境下启动。
- **Relay 启动报 RPC/合约错误**：检查本地链是否运行、`.env` 的 `CONTRACT_ADDRESS` 是否与当前 `deployments/local.json` 一致；链重启后地址会变。
- **MetaMask 交易失败/网络错误**：切到 31337；重启本地链后需要在 MetaMask 中重置账户 nonce（设置 → 高级 → 清除活动标签页数据）或重新导入。
- **Sell 页一直提示 helper 未连接**：确认 `npm run helper` 仍在运行，并且网页 origin 是 `http://localhost:5173` 或 `http://127.0.0.1:5173`。helper API 只允许这两个 loopback origin，且只绑定 `127.0.0.1:8788`。
- **Steam 二维码不出现**：先看 helper 终端是否报 Relay 配对/Steam 网络错误；Relay 必须在运行。二维码过期后 Web 会自动重新获取，也可以点“重新获取二维码”。
- **helper 提示 active offers**：helper 本地账本还有未完成的 offer，不能切换到另一个卖家钱包；先处理当前挂单或重启 helper。
- **真实 Steam offer 被暂挂**：确认两个账号 Steam Guard Mobile Authenticator 已启用 > 7 天；不要用真实贵重物品测试。
