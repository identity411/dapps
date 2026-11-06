# Sepolia Deployment Spec · S2-mini 上公开测试网（SkinPact）

**状态**：已部署 · Etherscan verified · smoke 通过（2026-11-06）
**版本**：v0.3
**日期**：2026-11-06
**目标网络**：Sepolia（chainId `11155111`），**禁止主网**
**上游**：[MVP Spec §2 / §6](./2026-11-01-dapp-project-mvp-spec.md)、[S2-mini Spec §11](./2026-11-06-stage-2-minimal-refund-dispute-spec.md)
**课程截止**：2026-11-08 23:59

---

## 1. 当前状态与缺口

S2-mini 合约已经在本地链完成，但尚未部署到任何公开网络：

| 项 | 当前 | 缺口 |
|---|---|---|
| 合约部署 | 仅 Hardhat 31337 | Sepolia 网络、部署脚本、verify |
| `deploy:local` | 显式拒绝非 31337 | Sepolia 需要独立部署脚本 |
| Hardhat 配置 | 只有 `hardhat` / `localhost` | 缺 `sepolia` network + Etherscan 配置 |
| Web | Vite 自动注入 `deployments/local.json` | 需要 Sepolia 的 `VITE_*` 配置与网络文案 |
| Relay | 支持任意 `RPC_URL` / `CHAIN_ID` / `CONTRACT_ADDRESS` | 需要 Sepolia env；必须设置 `DEPLOYMENT_BLOCK` |
| Helper | 通过 Relay 工作 | Relay 本地运行时无需改代码 |
| 部署产物 | 没有 `deployments/sepolia.json` | 需要地址、tx、block、constructor args、verify URL |
| 链上操作 | 只有本地 E2E | 需要至少一次真实 Sepolia 交易 |

课程硬性要求：**Sepolia + verified 地址 + 至少一次有意义的链上操作**。本 spec 完成后才能满足。

---

## 2. 前置条件

部署前先准备：

1. **Sepolia RPC**：Alchemy / Infura / 公共 RPC；记录 URL，不提交。
2. **部署账户**：专用测试私钥（`DEPLOYER_PRIVATE_KEY`），不要用主钱包；需要少量 Sepolia ETH。
3. **卖家/买家 smoke 账户**：各自需要 Sepolia ETH；可用 `SMOKE_SELLER_PRIVATE_KEY` / `SMOKE_BUYER_PRIVATE_KEY`。
4. **Arbiter 地址**：专用 EOA 或 2-of-3 Safe；需要 Sepolia ETH 支付 `resolveDispute` gas。**必填，不能默认为 deployer。**
5. **Etherscan API Key**：用于 verify；若失败则手动 verify。
6. **MetaMask**：添加 Sepolia 网络；准备卖家、买家、arbiter 三个账户（或导入测试私钥）。
7. **Steam 测试账号**（可选）：真实交付演示用；若受阻，按规范标注 mock。
8. **网络环境**：Relay/helper 需要能访问 Steam Community；Sepolia RPC 可用。

所有私钥只写入本地 `.env` 或 `.env.sepolia`，**绝不能提交**。

---

## 3. 代码与配置改动

### 3.1 `contracts/hardhat.config.ts`

追加：

```ts
networks: {
  // existing hardhat / localhost...
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL || "",
    accounts: process.env.DEPLOYER_PRIVATE_KEY
      ? [process.env.DEPLOYER_PRIVATE_KEY]
      : [],
    chainId: 11155111,
  },
},
etherscan: {
  apiKey: process.env.ETHERSCAN_API_KEY || "",
},
```

要求：

- `SEPOLIA_RPC_URL` 未设置时，部署脚本必须 fail fast，而不是落到空 URL。
- 只允许 `chainId === 11155111`；脚本内再次校验，防止误部署主网。
- `hardhat-toolbox` 已包含 verify 插件，无需新增依赖。

### 3.2 新增 `contracts/scripts/deploy-sepolia.ts`

职责：

1. 校验 `network.chainId === 11155111n`，否则直接拒绝。
2. 校验 `ARBITER_ADDRESS` 非零且是合法地址；Sepolia **不允许**回退到 deployer。
3. 校验 deployer 余额足够支付部署 gas。
4. 读取构造函数参数：
   - `MAX_PRICE_ETH`（建议 `0.1`）
   - `MIN_BOND_ETH`（建议 `0.001`）
   - `OFFER_WINDOW_SECONDS`（demo 建议 `600`）
   - `CHALLENGE_WINDOW_SECONDS`（demo 建议 `300`）
   - `DELIVERY_WINDOW_SECONDS`（demo 建议 `3600`）
   - `ARBITER_ADDRESS`（必填）
5. 部署 `SkinPactMarket`，等待 receipt。
6. 写入 `deployments/sepolia.json`：

```json
{
  "chainId": 11155111,
  "network": "sepolia",
  "address": "0x...",
  "deployer": "0x...",
  "arbiter": "0x...",
  "txHash": "0x...",
  "blockNumber": 12345678,
  "deployedAt": "2026-11-06T...",
  "config": {
    "maxPrice": "...",
    "minBond": "...",
    "offerWindow": 600,
    "challengeWindow": 300,
    "deliveryWindow": 3600
  },
  "verifiedUrl": "https://sepolia.etherscan.io/address/0x...#code"
}
```

7. 若 `ETHERSCAN_API_KEY` 存在，调用 `hre.run("verify:verify", { address, constructorArguments })`；失败时打印手动 verify 命令，不阻塞部署结果。
8. 打印：
   - 合约地址
   - Etherscan 链接
   - `DEPLOYMENT_BLOCK=<blockNumber>`（Relay 必须使用）
   - constructor args（报告附录需要）

### 3.3 根 `package.json`

新增：

```json
"deploy:sepolia": "npm run deploy:sepolia -w @skinpact/contracts",
"smoke:sepolia": "tsx scripts/sepolia-smoke.ts",
"web:sepolia": "npm run dev:sepolia -w @skinpact/web",
"build:sepolia": "npm run build:sepolia -w @skinpact/web"
```

`contracts/package.json` 对应新增：

```json
"deploy:sepolia": "hardhat run scripts/deploy-sepolia.ts --network sepolia"
```

### 3.4 环境变量

在 `.env.example` 增加注释项（不填真实值）：

```bash
# --- Sepolia deployment (never commit real values) ---
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
ARBITER_ADDRESS=
ETHERSCAN_API_KEY=

# --- Sepolia runtime (Relay) ---
# CHAIN_ID=11155111
# RPC_URL=https://sepolia...
# CONTRACT_ADDRESS=0x...
# DEPLOYMENT_BLOCK=12345678
```

推荐用独立 `.env.sepolia`（gitignored）保存 Sepolia 运行时配置。启动 Relay 时用 shell 覆盖：

```bash
set -a; source .env.sepolia; set +a
npm run relay
```

或者使用 `dotenv-cli` / 自定义脚本；不要依赖 `.env` 覆盖已有 shell 变量（dotenv 默认不覆盖）。

### 3.5 Web 配置

最小改动（推荐先做）：

1. 新增 `web/.env.sepolia`（gitignored）：

```bash
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://sepolia...
VITE_CONTRACT_ADDRESS=0x...
VITE_RELAY_URL=http://127.0.0.1:8787
VITE_HELPER_URL=http://127.0.0.1:8788
```

2. `web/package.json` 新增：

```json
"dev:sepolia": "vite --mode sepolia",
"build:sepolia": "vite build --mode sepolia"
```

3. `web/src/config.ts` 已支持 `VITE_*` 覆盖，无需改逻辑；`VITE_CONTRACT_ADDRESS` 会优先于 `deployments/local.json` 注入值。

需要一起修的文案/网络逻辑：

| 文件 | 当前 | 改为 |
|---|---|---|
| `web/src/wallet.tsx` | 添加网络时固定 `Hardhat Local ${CHAIN_ID}` | 按 chainId 选择名称：31337 → Hardhat Local；11155111 → Sepolia；带 block explorer |
| `web/src/Header.tsx` | `S1 · LOCAL {CHAIN_ID}` | `S2-mini · {SEPOLIA/LOCAL} {CHAIN_ID}` |
| `web/src/OrderRoom.tsx` | “本地合约未配置”“本地链 {CHAIN_ID}” | 通用“合约未配置”“当前网络不是 {CHAIN_ID}” |
| `web/src/Market.tsx` | “Hardhat 本地链” | “当前配置网络（本地 / Sepolia）” |
| `README.md` | “S2-mini 仍只允许本地链” | 部署后改为 Sepolia 地址与说明 |

可选清理（非必需）：把 `web/vite.config.ts` 的 `__SKINPACT_LOCAL_DEPLOY__` 改成按 mode 读取 `deployments/local.json` 或 `deployments/sepolia.json`，避免名字误导。时间是第一位，先保证 `VITE_*` 能跑通。

### 3.6 Relay

代码无需改（启动时已校验 RPC chainId 与 `CHAIN_ID` 一致）。Sepolia 运行时设置：

```bash
CHAIN_ID=11155111
RPC_URL=https://sepolia...
CONTRACT_ADDRESS=0x...
DEPLOYMENT_BLOCK=<deploy block>
WEB_ORIGIN=http://localhost:5173
```

**必须设置 `DEPLOYMENT_BLOCK`**：`findFundedBySeller` 从该 block 查询 `ListingCreated` 事件；用 0 会在 Sepolia 上从创世块扫描，慢且可能被 RPC 限流。

### 3.7 Helper

代码无需改。若 Relay 继续跑在 `127.0.0.1`，`SKINPACT_RELAY_URL` 保持本地即可。若把 Relay 部署到远端，必须 HTTPS，并更新 `SKINPACT_RELAY_URL` 与 `HELPER_WEB_ORIGINS`。

### 3.8 Sepolia smoke / gas 脚本

新增 `scripts/sepolia-smoke.ts`：

- 读取 `deployments/sepolia.json`。
- 读取 `SMOKE_SELLER_PRIVATE_KEY`、`SMOKE_BUYER_PRIVATE_KEY`；只读本地 env。
- 场景：
  1. `createListing`（seller）
  2. `buy`（buyer）
  3. `markOfferSent`（seller，使用合成 offer hash）
  4. `confirmReceipt`（buyer）
  5. 第二个 listing：`createListing` → `cancelListing`
  6. 可选：第三个 listing：buy → mark → `openDispute` → `resolveDispute`（需要 `ARBITER_PRIVATE_KEY` 或通过 Web 操作）
- 每笔交易输出：tx hash、block、gasUsed、gasPrice、总费用。
- 写入 `experiments/e1/sepolia-smoke.json`（或 `experiments/e1/sepolia-txs.csv`）。
- 脚本不打印私钥；不把 env 写进产物。

如果为了节省时间，也可以直接用 Web UI 完成上述操作，手动记录 tx hash；脚本更适合 E1 的可复现数据。

---

## 4. 部署流程

### 4.1 本地预检

```bash
npm test
npm run typecheck
npm run build
npm run e2e:local
```

全部通过后再部署。

### 4.2 配置

```bash
cp .env.example .env     # 若还没有
# 填写 JWT_SECRET / RELAY_ENCRYPTION_KEY
# 填写 SEPOLIA_RPC_URL / DEPLOYER_PRIVATE_KEY / ARBITER_ADDRESS / ETHERSCAN_API_KEY
# 可选：设置 demo 窗口参数
```

确认：

```bash
cast chain-id --rpc-url "$SEPOLIA_RPC_URL"   # 应为 11155111；没有 cast 就看部署脚本输出
```

### 4.3 部署 + verify

```bash
npm run deploy:sepolia
```

检查 `deployments/sepolia.json`：

- `address`、`txHash`、`blockNumber`、`arbiter`、constructor args 齐全
- Etherscan 上 contract 已 verified
- `arbiter()` / `deliveryWindow()` / `maxPrice()` / `minBond()` 与部署参数一致

### 4.4 切换运行时

1. `.env.sepolia` 写入 `CHAIN_ID=11155111`、`RPC_URL`、`CONTRACT_ADDRESS`、`DEPLOYMENT_BLOCK`。
2. `source .env.sepolia` 后启动 Relay。
3. `web/.env.sepolia` 写入 `VITE_*`；`npm run web:sepolia`。
4. MetaMask 切到 Sepolia，确认 UI 显示 `11155111` 和合约已配置。
5. 启动 helper（Relay 本地时无需改 URL）。
6. 用 smoke 账户跑一次 `npm run smoke:sepolia`。
7. 用 Web 走一遍 create → buy → mark → confirm；记录 tx hash。

### 4.5 更新文档

- `README.md`：Sepolia 地址、chainId、部署/verify 链接、运行命令、限制。
- `specs` 状态：本 spec 改为“已部署”；S2-mini spec 的“未部署 Sepolia”更新。
- 报告 appendix：address、tx hashes、constructor args、verify URL。

---

## 5. 验收标准

- [x] `deployments/sepolia.json` 存在且字段完整
- [x] Etherscan 上合约 verified（或已记录手动 verify 证据）
- [x] `arbiter`、`deliveryWindow`、窗口参数与预期一致
- [x] 至少一笔真实 Sepolia 交易（建议完整 create → buy → mark → confirm）
- [x] 至少一次 `cancelListing` 或 dispute 路径在 Sepolia 上跑通（可选但推荐）
- [ ] Web 显示 chainId 11155111，能读取 Sepolia 合约（待 UI 实际连 Sepolia 走查）
- [ ] Relay 连接 Sepolia，`DEPLOYMENT_BLOCK` 正确，helper 能拉取 Funded 订单（待联调）
- [x] `npm run smoke:sepolia` 输出 tx/gas 数据
- [x] README 更新地址与命令
- [x] 没有私钥、RPC key、Steam token 进入 git（`.env` 未提交）
- [ ] 报告附录包含地址、tx hash、constructor args（报告阶段完成）

---

## 6. Demo 拓扑

推荐 **本机 Web/Relay/helper + Sepolia 链 + MetaMask Sepolia**：

```text
MetaMask (Sepolia) ── Web (localhost:5173) ── Relay (localhost:8787) ── Sepolia RPC
                                              └─ Helper (127.0.0.1:8788) ── Steam
```

优点：

- 不需要公网部署、TLS、域名、CORS 改动
- Steam 登录态仍在本地
- 满足课程“Sepolia + 链上操作”要求
- 演示可控，失败时可切本地链或预录 backup

不做的：

- 公网 Relay/Web 托管
- HTTPS/TLS 证书
- 生产级 RPC 冗余
- 主网部署

---

## 7. 安全与保密

- 专用 deployer / smoke 私钥，不复用个人钱包；课程结束后作废。
- `ARBITER_ADDRESS` 必须在部署前确认；immutable，部署后不能改。
- 只用测试 ETH；`maxPrice` 保持 0.1 以下，不涉及真实价值。
- 不提交 `.env`、`.env.sepolia`、私钥、Etherscan key、Steam session、Trade URL。
- 部署后检查：
  ```bash
  git grep -nE "PRIVATE KEY|0x[0-9a-fA-F]{64}|steam.*token|tradeoffer/new"
  git status --short
  ```
- 视频/截图遮挡 Steam 个人信息、Trade URL token、钱包私钥和 session。
- 合约无 owner / 提款后门；`arbiter` 是唯一新增信任点，报告中披露。

---

## 8. 故障排查

| 现象 | 检查 |
|---|---|
| 部署脚本 chainId 不对 | `SEPOLIA_RPC_URL` 是否指向 11155111；是否误连主网/本地 |
| `ARBITER_ADDRESS is required` | 在 `.env` 填合法地址，不要留空 |
| 部署失败余额不足 | deployer 领 Sepolia ETH；确认 gas |
| verify 失败 | 确认 constructor args、Etherscan key、compiler 版本/optimizer；手动 verify |
| Relay 启动 chainId mismatch | `CHAIN_ID` 与 RPC 不一致 |
| Relay 看不到 Funded | `DEPLOYMENT_BLOCK` 是否设为部署 block；RPC 是否限流 |
| Web 仍显示本地地址 | `web/.env.sepolia` 是否生效；`VITE_CONTRACT_ADDRESS` 是否设置；是否用 `--mode sepolia` |
| MetaMask 不认网络 | 手动添加 Sepolia，或检查 `wallet.tsx` 网络名称/chainId |
| helper 拉不到订单 | Relay 是否连 Sepolia；`SKINPACT_RELAY_URL` 是否正确 |
| Steam 库存/offer 失败 | Relay/helper 网络能否访问 Steam Community；必要时标注 mock |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Faucet 领不到 Sepolia ETH | 无法部署/演示 | 提前领取；多账户；用公共 RPC + 备用 faucet |
| Etherscan verify 失败 | 课程要求未满足 | 手动 verify；保留编译参数与 constructor args |
| RPC 限流 | Relay/Web 读链失败 | 换 RPC；设置 `DEPLOYMENT_BLOCK` 缩小查询范围 |
| 误部署主网 | 资金/合规风险 | 脚本硬编码只允许 11155111；部署前二次确认 |
| Arbiter 地址填错 | 争议无法裁决 | 部署前核对；immutable；测试 `arbiter()` |
| Steam 网络阻塞 | 真实交付演示失败 | 明确标注 mock；本地 E2E 兜底 |
| 时间不够 | 只完成部署，未跑 smoke | 优先 create/buy/confirm 最小链路；dispute 可后补 |

---

## 10. 时间估算

| 任务 | 预计 |
|---|---|
| Hardhat / 部署脚本 / env / Web 配置 | 2–3 小时 |
| 部署 + verify + 读回校验 | 1–2 小时（含 faucet 等待） |
| smoke + gas 数据 + Web 走查 | 1–2 小时 |
| README / 报告 appendix | 0.5 小时 |

建议今天（11-06）完成部署与最小 smoke；明天只补数据和报告。

---

## 11. 实现记录（2026-11-06）

已完成：

- `contracts/hardhat.config.ts`：新增 `sepolia` network（`SEPOLIA_RPC_URL` / `DEPLOYER_PRIVATE_KEY` / chainId 11155111）与 `etherscan` 配置
- `contracts/scripts/deploy-sepolia.ts`：chainId/凭据/arbiter 校验、部署、写 `deployments/sepolia.json`、自动/手动 verify 提示
- `contracts/package.json` / 根 `package.json`：`deploy:sepolia`、`preflight:sepolia`、`smoke:sepolia`、`web:sepolia`、`build:sepolia`
- `.env.example`：Sepolia 部署/运行/smoke 变量模板
- `web/.env.sepolia.example`：Vite Sepolia 配置模板
- `web/package.json`：`dev:sepolia` / `build:sepolia`
- `web/src/config.ts` / `wallet.tsx` / `Header.tsx` / `App.tsx` / `OrderRoom.tsx` / `Market.tsx` / `Sell.tsx`：Sepolia 网络名称、explorer、网络切换与通用文案
- `scripts/sepolia-preflight.ts`：公开地址/余额/缺失项检查，不打印私钥
- `scripts/sepolia-smoke.ts`：create → buy → mark → confirm、cancel、dispute → resolve，输出 `experiments/e1/sepolia-smoke.json`

### 11.1 实际部署结果

| 项 | 值 |
|---|---|
| Network | Sepolia `11155111` |
| Contract | `0x2Ffca05611801F532Afc6135b56baBEB0D7460eF` |
| Deploy tx | `0xa13facad2e103aa5df7fe0d876f73e742cb3ba4c9c9a7a037d446f52c22e04e6` |
| Block | `12077649` |
| Deployer | `0x82525958048270C794040D502a4A177efB32475d` |
| Arbiter | `0xfc73C38cD376D01F9B145e78fa6968F081e66D53` |
| Constructor | `100000000000000000 1000000000000000 600 300 3600 0xfc73C38cD376D01F9B145e78fa6968F081e66D53` |
| Verified | https://sepolia.etherscan.io/address/0x2Ffca05611801F532Afc6135b56baBEB0D7460eF#code |
| Smoke | `experiments/e1/sepolia-smoke.json`（11 tx，总 gas fee `64192315 wei`） |

读回校验：

- `eth_getCode` 非空（6780 bytes）
- `arbiter()` = `0xfc73C38cD376D01F9B145e78fa6968F081e66D53`
- `deliveryWindow()` = 3600；`maxPrice()` = 0.1 ETH；`minBond()` = 0.001 ETH
- `offerWindow()` = 600；`challengeWindow()` = 300
- smoke 覆盖 create/buy/mark/confirm、cancel、openDispute、resolveDispute（buyer wins + bond slash）

```bash
npm run preflight:sepolia   # READY for deployment + smoke
npm run smoke:sepolia       # 11 txs written to experiments/e1/sepolia-smoke.json
```

仍待完成：

- 用 Web + Relay + helper 实际连接 Sepolia 走一遍 UI（当前 smoke 是合约直连，未经过 Relay/Steam）
- E1 全函数 gas 表/费率图（当前 smoke 只覆盖 11 笔交易）
- 报告附录的最终排版
