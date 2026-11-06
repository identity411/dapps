# Course Delivery & Report Spec · SkinPact 期末作业

**状态**：执行中（E1/E2 已完成；E3 / 报告 / Slides / 视频 / QA 待做）
**版本**：v0.3
**日期**：2026-11-07
**课程截止**：2026-11-08 23:59
**目标提交**：2026-11-07 21:00（留 11-08 作缓冲）
**上游**：[MVP Spec §2 / §6 / §8](./2026-11-01-dapp-project-mvp-spec.md)、[S2-mini Spec](./2026-11-06-stage-2-minimal-refund-dispute-spec.md)、[Sepolia Spec](./2026-11-06-sepolia-deployment-spec.md)

---

## 1. 当前状态

| 部分 | 状态 | 说明 |
|---|---|---|
| S2-mini 合约/测试 | ✅ | 36 个合约测试；cancel/dispute/resolve 已实现 |
| Shared / Relay / Helper | ✅ | shared 1、relay 18、helper 12 测试通过 |
| Web | ✅ 构建通过 | cancel/dispute/resolve UI 已接入；**手动走查未做** |
| 本地 E2E | ✅ | P1–P8，99 checks；Steam 为明确 mock |
| Sepolia | ✅ | 合约 `0x2Ffca…460eF`，block 12077649；[Etherscan verified](https://sepolia.etherscan.io/address/0x2Ffca05611801F532Afc6135b56baBEB0D7460eF#code)；11 笔 smoke tx；Web/Relay 连 Sepolia 待走查 |
| E1 Gas/费率 | ✅ 完成（11-07） | 本地 11 操作 + Sepolia 全部 11 操作（11-06 原始 smoke + 11-07 completion smoke）；`experiments/e1/` 有 CSV、JSON、费率表、gas 柱状图、break-even 图；补测的 4 个操作见 `sepolia-smoke-missing.json` |
| E2 安全实验 | ✅ 完成（11-07） | `experiments/e2/`：threat-model、17 findings、trust-table、Slither（0 High/Medium）、coverage（100% stmts/funcs/lines，87.5% branch） |
| E3 可用性 | ❌ | 未做；可降级 heuristic |
| 报告 / Slides / 视频 | ❌ | 均未开始；E1/E2 数据已可直接引用 |
| Demo | ⚠️ | 本地 E2E 通过，浏览器 Demo 未彩排 |
| 贡献表 / 提交 QA | ❌ | 未整理 |
| 公开仓库同步 | ✅ | 仓库为 public；`docs/skinpact-spec` 已推送至 `febd12e`，`deployments/` 与 `experiments/` 在 GitHub 可见 |

**结论**：Codebase 35% 与 Experiment 的 E1/E2 部分已保住；公开仓库已同步（`febd12e`）。**剩余主体是 E3 + 报告 / Slides / 视频 / Demo 彩排 / QA**。唯一的数据呈现卡点：Sepolia smoke 运行时表现出 Amsterdam 时代 gas 规则，而本地 Hardhat 默认 Osaka，状态创建类操作 gas 相差 2.6–4 倍，报告必须并列呈现、不可混用。

---

## 2. 课程要求与证据映射

| 要求 | 证据 | 负责人 | 状态 |
|---|---|---|---|
| Sepolia + verified 地址 | `deployments/sepolia.json`、[Etherscan](https://sepolia.etherscan.io/address/0x2Ffca05611801F532Afc6135b56baBEB0D7460eF#code) | R2/R3 | ✅ |
| 至少一次有意义的链上操作 | Sepolia smoke 11 tx（含 create/buy/mark/confirm、cancel、dispute） | R3 | ✅ |
| Solidity + ethers.js + MetaMask | 合约、Web、Demo | R2/R3 | ✅ |
| E1 gas / 费率实验 | `experiments/e1/`：local 11 ops、Sepolia 全部 11 ops（原始 + completion smoke）、CSV、两张图、break-even、费率来源 | R2/R4 | ✅ 11-07 |
| E2 安全实验 | `experiments/e2/`：threat model、17 findings、trust table、Slither、coverage | R2 | ✅ 11-07 |
| 4–5 人 + 贡献表 | 报告 appendix + README | R1 | ❌ |
| 英文报告 PDF | `{N}-SkinPact.pdf` | R1 | ❌ |
| 英文 Slides | `{N}-SkinPact.pptx` | R5 | ❌ |
| 英文视频 | `{N}-SkinPact-video.txt`（unlisted + 备份） | R5 | ❌ |
| Public repo + README | GitHub 仓库、README | R1/R3 | ✅ public；已推送 `febd12e` |
| 命名规范 | `{N}-SkinPact.pdf/.pptx/-video.txt` | R1 | ❌ |
| testnet-only 声明 | 报告 / README / 视频口播 | R1/R5 | ❌ |
| 截止时间 | 11-07 21:00 提交，11-08 23:59 截止 | 全队 | — |

评分权重：**Codebase 35% / Experiment 35% / Demo 15% / Coherence 15%**；迟交 10/20/50/100%。

---

## 3. 剩余工作包（Work Packages）

| WP | 内容 | 产出 | 负责人 | 截止 |
|---|---|---|---|---|
| WP0 | Sepolia 部署 + verify + smoke ✅ | 地址 `0x2Ffca…460eF`、tx、verify URL、11 笔 smoke | R2/R3 | 11-06 完成 |
| WP1 | E1 gas / 费率实验 ✅ | `experiments/e1/`：local-gas.csv/json、sepolia-gas.csv、fee-comparison.csv、summary.json、两张图（SVG+PNG）、README | R4/R2 | ✅ 11-07 |
| WP2 | E2 安全实验 ✅ | `experiments/e2/`：threat-model.md、findings.md、trust-table.md、slither.txt、coverage.txt、README | R2 | ✅ 11-07 |
| WP3 | E3 可用性实验（或 heuristic） | 漏斗图、表格、改进项 | R4/R1 | 11-07 |
| WP4 | 报告 | `{N}-SkinPact.pdf` | R1 | 11-07 |
| WP5 | Slides + 视频 | `.pptx` + `-video.txt` | R5 | 11-07 |
| WP6 | Demo 彩排 + backup | 两次彩排、预录视频 | R5/全队 | 11-07 |
| WP7 | QA + 提交 | 检查清单、提交确认 | R1/R2 | 11-07 21:00 |

4 人团队时：WP3 并入 R1，WP1 并入 R2，WP5 由 R3 兼。

---

## 4. 实验计划（Experiment 35%）

报告要求 E1–E3 约占 40–50% 篇幅。所有原始数据放仓库：

```text
experiments/
  e1/  local-gas.csv, local-gas.json, sepolia-gas.csv,
       sepolia-smoke.json, sepolia-smoke-missing.json,
       fee-comparison.csv, summary.json,
       gas-by-operation.svg/.png, fee-breakeven.svg/.png, README.md
  e2/  threat-model.md, findings.md, trust-table.md,
       slither.txt, coverage.txt, README.md
  e3/  (not started) protocol.md, consent.md, results.csv, funnel.png, summary.md
```

### 4.1 E1 — Gas / 费率 / 盈亏平衡

**问题**：各操作 gas 多少？在什么价位比 1%/2.5%/5% 平台费更便宜？

**方法**：

- 测 `createListing`、`buy`、`markOfferSent`、`confirmReceipt`、`claimAccepted`、`finalizeClaim`、`expireOrder`、`cancelListing`、`openDispute`、`resolveDispute`、`withdraw`。
- 本地 Hardhat（确定性 gas）+ Sepolia（真实 gas price）。
- 用 Sepolia smoke 脚本输出 tx/gas；本地用脚本或 hardhat test gas reporter。
- 计算：
  - 每笔操作 gasUsed、gasPrice、ETH 费用
  - 以假设 ETH 价格换算 USD（明确标注“假设价格”，test ETH 无真实价值）
  - 与平台费 `price × 1% / 2.5% / 5%` 对比
  - 盈亏平衡价格
- 竞品费率必须附来源和日期。

**产出**：CSV、gas 柱状图、盈亏平衡图、费用对比表、结论（低单价可能不经济，指向 L2/稳定币）。

**结果（2026-11-07，commit `6d8ffa0`）**：

- 本地 Hardhat（Osaka，固定 1 gwei 报告价）覆盖全部 11 个操作；Sepolia 也覆盖全部 11 个操作：11-06 原始 smoke 7 个，加上 11-07 completion smoke 补测 `claimAccepted`、`finalizeClaim`、`expireOrder`、`withdraw`。Completion smoke 使用已验证合约，真实等待了 300 s challenge 窗口和 600 s offer 窗口。
- Happy path（create + buy + mark + confirm）：本地 **374,508 gas**；Sepolia **1,173,272 gas**。
- 10 gwei、$3,000/ETH 假设下：Sepolia happy path gas ≈ **$35.20**；盈亏平衡价 1% = **$3,520**、2.5% = **$1,408**、5% = **$704**。结论：低单价时 L1 gas 高于平台费，0 平台费 ≠ 0 成本。
- Completion smoke 补测值：`claimAccepted` **144,830**、`finalizeClaim` **151,253**、`expireOrder` **67,704**、`withdraw` **43,004** gas；tx hash 与 setup 记录在 `sepolia-smoke-missing.json`。
- Sepolia 实测 effective gas price 为 16–19 wei（空闲测试网伪影），原始 11 笔 + completion 4 个目标操作总费用 `70,700,971 wei`；经济结论使用 1/10/50 gwei 情景，不使用该观测值。
- **关键卡点**：Sepolia smoke 运行时表现出 Amsterdam 时代 gas 规则（EIP-8037/8038 状态创建/访问涨价；值转移额外产生 EIP-7708 `Transfer` 日志，emitter 为 `0xffff…fffe`），本地 Hardhat 2.29.1 默认 Osaka。状态创建/写入类操作 Sepolia gas 可达本地的 2.6–4 倍（如 `createListing` 709,721 vs 175,001、`finalizeClaim` 151,253 vs 44,549），`expireOrder`/`withdraw` 则接近本地。报告必须并列呈现，不能混算。
- 费率来源：Steam 15%（5% Steam + 10% CS2，SteamDB，accessed 2026-11-07）；BUFF 1.5%（官方公告，2.5% 下调，accessed 2026-11-07；第三方仍显示 2.5–3%）；YouPin 1%（SteamDB，last verified 2026-07-01）。1%/2.5%/5% 仅作为敏感性假设，不冒充竞品费率。
- 入口：`npm run e1:gas`、`npm run e1:report`；详见 [`experiments/e1/README.md`](../experiments/e1/README.md)。

### 4.2 E2 — 安全 / 信任边界

**问题**：合约/helper/Relay 能否抵抗越权、重入、状态绕过、假 claim、URL 泄露？残余信任点是什么？

**方法**：

- 威胁模型：恶意买家/卖家/arbiter/Relay/helper、Steam 不可验证、Trade URL bearer secret。
- 对抗测试：
  - 非 seller/buyer/arbiter 调用
  - 重复结算、错误状态、重复 dispute、challenge window 绕过
  - 假 claim + buyer dispute
  - OfferSent 超时升级、griefing、bond 没收
  - 买家先 Accept、卖家未 mark
  - helper 离线/session 失效、InEscrow(11)
  - Trade URL 泄露检查（API/DB/日志）
- 工具：`npm test`、`e2e:local`、invariant、Slither、coverage。
- 产出：findings（含严重度/复现/修复）、trust table、残余风险。

**结果（2026-11-07，commit `6d8ffa0`）**：

- 产出：`experiments/e2/threat-model.md`（资产、角色、信任边界、42 个威胁场景）、`findings.md`（17 条 findings + 已验证性质 + 修复建议）、`trust-table.md`（逐组件信任假设与残余风险）、`slither.txt`、`coverage.txt`、`README.md`。
- 测试证据：合约 36、shared 1、relay 18、helper 12 全部通过；本地 E2E P1–P8 **99 checks** 通过（Steam 明确 mock）。
- Slither 0.11.6（solc 0.8.24）：**0 High/Medium**；5 条 informational（4 处时间窗比较 + 1 处 pull-payment 低级调用），已逐条 triage。
- Coverage：**100% statements / 100% functions / 100% lines / 87.5% branch**。
- 结论：未发现可利用的越权、重入、双结算或 URL 访问控制漏洞。主要风险是信任边界而非代码漏洞：**F-01 Steam 交付不可链上验证**、**F-02 arbiter 单点且不可更换**、**F-03 Trade URL 是 bearer secret 且 Relay 可解密**。另有 F-04 buyer dispute 冻结、F-05 seller mark-without-offer、F-06 buyer-first Accept race 等残余风险，均已在报告中披露。
- **卡点/限制**：Slither 需要 Hardhat 缓存 solc + 绝对 OpenZeppelin remap，命令已记录在 `findings.md` §10；Slither 是静态分析，不是 formal verification 或审计；E2E 的 Steam 传输是 mock，不能当作真实交付证据。

### 4.3 E3 — 可用性（可降级）

**首选**：5–8 名同学/玩家，mock Steam + 预充值钱包，完成：

1. 卖家绑定 Steam / 挂牌
2. 买家保存账户 / 付款
3. 接受 offer（mock）
4. 确认收货

记录任务完成率、用时、错误、SEQ/SUS、访谈；匿名同意。

**降级**（时间不够）：2–3 名评审按 Nielsen 启发式走查，明确标注为 heuristic evaluation，不冒充用户研究。

**产出**：漏斗图、结果表、改进项、限制说明。

### 4.4 执行卡点（2026-11-07）

- **Gas 规则不可比**：Sepolia 在本次 smoke 中表现出 Amsterdam 时代规则（EIP-8037/8038、EIP-7708），本地 Hardhat 2.29.1 默认 Osaka；状态创建类操作相差 2.6–4 倍，`expireOrder`/`withdraw` 接近本地。报告必须并列呈现，禁止把两套 gas 相加或互换。
- **E1 completion smoke 会真实发 tx 并等待窗口**：补测 4 个操作需约 10 分钟；数据已落盘到 `sepolia-smoke-missing.json`，复跑不是读报告的必要步骤。
- **E2 工具链**：Slither 需要 Hardhat 缓存 solc + 绝对 OpenZeppelin remap；命令已写入 `experiments/e2/findings.md` §10。Slither 不是审计/形式化验证。
- **Steam 证据边界**：E2E 与 E2 的 Steam 传输为 mock；真实交付是手动 exit check，报告/视频必须一致标注。
- **E3 未开始**：距离 21:00 目标提交时间有限，建议直接采用 2–3 人 Nielsen heuristic 降级方案并明确标注。
- **公开仓库已同步**：`febd12e` 已推送，GitHub 可见 `deployments/` 与 `experiments/`；后续报告/README 更新需继续 commit + push。

---

## 5. 报告结构（英文 PDF）

建议 8–12 页（以课程要求为准），结构：

1. **Abstract**
2. **Introduction / Problem**：CS2 饰品交易手续费、信任、Steam 交付现实
3. **Background / Related Work**：Steam trade offer、BUFF/UU、托管与仲裁；引用来源/日期
4. **Design**：角色、信任边界、S2-mini 状态机、escrow/bond/pull payment、dispute/arbiter
5. **Implementation**：合约、Relay、helper、Web、Sepolia 部署；关键安全决策
6. **Experiments E1–E3**（40–50%）：
   - E1 方法与数据/图表/结论
   - E2 威胁模型/测试/findings/trust table
   - E3 协议/结果/改进
7. **Security & Limitations**：
   - arbiter 中心化、证据只存 hash、`abortBySeller` 未做、Relay 无争议证据接口
   - 买家先 Accept race、InEscrow、挑战窗口通知
   - Steam ToS、testnet ETH、mock 标注
   - E1 低单价经济性、E3 样本量
8. **Conclusion / Future Work**
9. **Contribution Table**
10. **References**
11. **Appendix**：Sepolia 地址、tx hashes、constructor args、verify URL、E2E 输出、rubric 自评

写作要求：

- 英文；术语一致（listing/order、price/bond、escrow、arbiter）。
- 不夸大：0 平台费不等于 0 成本；gas 可能高于平台费。
- 所有 mock/真实 Steam 传输必须一致标注。
- 实验数据可复现：脚本、参数、commit hash、日期。

---

## 6. Slides 计划（英文 PPTX）

建议 10–12 页：

1. Title / team
2. Problem & motivation
3. SkinPact overview
4. Architecture & trust boundaries
5. State machine（S2-mini）
6. Security design（escrow/bond/dispute/arbiter）
7. Demo screenshots / Sepolia evidence
8. E1 gas & breakeven
9. E2 findings / trust table
10. E3 usability
11. Limitations & future work
12. Conclusion / Q&A

要求：图表清晰、少文字；Sepolia 地址和 tx hash 可放在 appendix/QR。

---

## 7. 视频计划（英文，≤15 分钟，1080p）

结构建议：

| 时间 | 内容 |
|---|---|
| 0:00–1:00 | 问题与目标 |
| 1:00–3:00 | 架构、信任边界、状态机 |
| 3:00–9:00 | Sepolia Demo：卖家挂牌 → 买家付款 → helper offer → 买家 Steam 接受 → mark/confirm；可选 cancel/dispute |
| 9:00–12:00 | E1/E2/E3 结果 |
| 12:00–14:00 | 限制与未来工作 |
| 14:00–15:00 | 结论 |

必须：

- unlisted 链接 + 备份；`{N}-SkinPact-video.txt` 保存两个链接。
- 遮挡 Steam 账号名/头像/好友、Trade URL token、session、邮箱、钱包私钥。
- 真实/mock/helper 在画面和口播中一致标注。
- 录屏前清空浏览器敏感书签/通知；使用测试账号与低价值物品。
- 先彩排，再正式录；保留预录 backup。

---

## 8. Demo 计划

**首选**：Sepolia + 本地 Relay/helper + MetaMask（见 Sepolia spec §6）。

流程：

1. 卖家 QR 登录 Steam，挂牌并锁 bond
2. 买家选择账户、付款
3. helper 发 offer，卖家 mark
4. 买家在 Steam 手机接受
5. 买家 confirm 或卖家 claim → finalize
6. 可选：seller cancel / buyer dispute / arbiter resolve
7. withdraw

准备：

- seller/buyer/arbiter 账户预充值 Sepolia ETH；物品可交易、无 hold。
- 两次完整彩排；记录失败点。
- backup：预录视频 + 本地链 fallback；mock 时必须明确标注。
- 现场网络检查：Sepolia RPC、Steam Community、Relay、helper。

---

## 9. QA 与提交清单

```text
[x] Sepolia verified 地址 + 至少一笔 tx
[x] E1 数据与结论：experiments/e1/（local 11 ops + Sepolia 全部 11 ops、图、break-even）
[x] E2 数据与结论：experiments/e2/（threat model、findings、trust table、Slither、coverage）
[ ] 报告 PDF：{N}-SkinPact.pdf
[ ] Slides：{N}-SkinPact.pptx
[ ] 视频链接：{N}-SkinPact-video.txt（unlisted + 备份）
[ ] 贡献表（报告 + README）
[ ] public repo + README（地址、运行、限制、mock 声明）
[x] **git push stage2 + E1/E2**（`febd12e`）；GitHub 页面确认 deployments/ 与 experiments/ 可见
[ ] clean clone：npm install / npm test / npm run typecheck / npm run build 通过
[ ] npm run e2e:local 通过
[ ] 无 secrets：git grep 私钥/token；.env 未提交
[ ] 命名正确；所有链接 incognito 可访问
[ ] testnet-only 声明
[ ] 11-07 21:00 前提交；保存确认截图/邮件
```

Clean clone 检查：

```bash
git clone <repo> /tmp/skinpact-clean
cd /tmp/skinpact-clean
npm install
npm test
npm run typecheck
npm run build
```

---

## 10. 时间表

| 日期 | 任务 | 实际 |
|---|---|---|
| **11-06** | Sepolia 配置/部署/verify；Web/Relay/helper 切换；最小 smoke；手动 UI 走查；确认 repo public/贡献表 | ✅ Sepolia 部署+verify+11 tx；UI 走查未做 |
| **11-07 凌晨（实际）** | E1 本地 11 操作 gas + Sepolia CSV + 费率/盈亏平衡/图；E2 threat model/findings/trust table/Slither/coverage；Sepolia completion smoke 补测 4 个操作 | ✅ 完成（E1/E2） |
| **11-07 上午** | E3（建议直接 heuristic）；报告主体（design/experiments/limitations） | ⬜ |
| **11-07 下午** | 完成报告 + Slides；贡献表；README 状态 | ⬜ |
| **11-07 傍晚** | Demo 彩排 + 录视频；clean clone；QA；**21:00 提交** | ⬜ |
| **11-08** | 只处理提交平台故障；不新增功能 | — |

---

## 11. 角色

| 角色 | 职责 |
|---|---|
| R1 PM / 报告 | 计划、报告、贡献表、提交 |
| R2 合约 / 安全 | 合约、E1/E2、Sepolia、Slither |
| R3 前端 / Relay / Helper / Steam | Web、Relay、helper、Demo、Sepolia 联调 |
| R4 数据 / 实验 | E1 数据、E3、图表 |
| R5 视频 / Slides | Slides、视频、彩排、备份 |

4 人时合并 R4 到 R2 或 R5；所有角色都参与报告 review。

---

## 12. 风险与降级

| 风险 | 影响 | 降级 |
|---|---|---|
| Sepolia faucet/RPC 不可用 | 硬性要求失败 | 提前领取；换 RPC/faucet；保留 tx 证据 |
| Steam 网络/Guard 阻塞 | Demo 无法真实交付 | 明确标注 mock；本地 E2E 兜底；口播说明 |
| E3 找不到 5–8 人 | 数据不足 | 降级 heuristic evaluation，报告写 limitation |
| 时间不够 | 报告/视频质量下降 | 优先 E1+E2；E3 heuristic；PPT/视频简化；不砍真实/mock 标注 |
| 视频泄露 PII | 隐私风险 | 遮挡；测试账号；录前检查 |
| 报告夸大 0 费率 | Coherence 扣分 | E1 诚实呈现 gas；结论指向 L2/稳定币 |
| 实验不可复现 | Experiment 扣分 | 提交脚本/参数/commit hash/日期 |
| Sepolia 与本地 gas 规则不同（Amsterdam vs Osaka） | 混用导致 E1 数据失真、报告被质疑 | 报告中并列呈现；经济结论用 Sepolia 保守值；明确 EIP-8037/8038/7708；不混算 |
| 公开仓库未推送 stage2/E1/E2 | 公开证据链断裂，硬性要求风险 | 提交前 `git push`；用 GitHub 页面确认 `deployments/` 与 `experiments/` 可见 |
| E3 时间不足 | Experiment 缺一块 | 直接降级 2–3 人 heuristic；明确不冒充用户研究 |

---

## 13. 报告必须写明的限制

- S2-mini 的 arbiter 是中心化信任点；单 EOA 或 Safe 需说明。
- 争议证据链上只存 `disputeHash`，内容由 arbiter 线下审核，链上无法验证。
- 没有 `abortBySeller`；Funded 退出依赖 `expireOrder`。
- Relay 不保存争议证据；没有 arbiter 专用读取接口。
- 买家先 Accept、卖家未 mark 的 race 链上无法证明，只能流程约束。
- `InEscrow(11)` 不是最终交付，不能自动 claim。
- 挑战窗口通知依赖 UI 轮询，买家可能错过。
- 0 平台费不等于 0 成本；L1 gas 可能使低单价交易不经济。
- **E1 环境差异**：Sepolia 在本次 smoke 中表现出 Amsterdam 时代 gas 规则（EIP-8037/8038；EIP-7708 值转移日志），本地 Hardhat 为 Osaka；状态创建类操作 gas 相差 2.6–4 倍，`expireOrder`/`withdraw` 接近本地；报告必须并列呈现，不能混用。
- **E1 completion smoke**：4 个补测操作在已验证合约上真实执行并等待窗口；数据为单次运行，gas price 仍受空闲测试网影响。
- **E1 经济假设**：ETH/USD 为假设值（默认 $3,000）；gas price 采用 1/10/50 gwei 情景；Sepolia 实测 16–19 wei 是空闲测试网伪影，不代表市场价。
- **E2 工具限制**：Slither 是静态分析，coverage 衡量执行覆盖率而非正确性；未做形式化验证或第三方审计；E2E 的 Steam 传输是 mock。
- **E3 若走 heuristic**：必须明确标注为 heuristic evaluation，样本量与主观偏差写入 limitation，不冒充用户研究。
- Test ETH 无真实价值；Steam 饰品仍是链下资产；本项目仅课程 demo。
- 真实 Steam 与 mock 的标注必须全片/全文一致。

---

## 14. 验收标准

- [ ] 所有课程硬性要求有证据（Sepolia、链上操作、public repo、英文交付物）
- [x] E1 数据/图表/结论齐全：本地 11 操作 + Sepolia 全部 11 操作、CSV、两张图、费率来源、break-even（`experiments/e1/`）
- [x] E2 数据/结论齐全：threat model、17 findings、trust table、Slither、coverage（`experiments/e2/`）
- [ ] E3 数据/图表/结论齐全（或明确标注的 heuristic）
- [ ] 报告实验占比达标（E1/E2 素材已就绪，E3 补齐后即可写）
- [ ] 报告/Slides/视频英文、命名正确、链接可访问
- [ ] Demo 两次彩排 + backup
- [ ] 贡献表、testnet-only 声明、mock 标注
- [ ] clean clone + 无 secrets
- [x] **公开仓库包含 stage2 + E1/E2 产物**（已推送 `febd12e`）
- [ ] 11-07 21:00 前提交，保存确认
