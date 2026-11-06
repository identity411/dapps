# E1 — Gas, Fee, and Break-even Experiment

| Field | Value |
|---|---|
| Date | 2026-11-07 |
| Code commit | `6d8ffa0` |
| Contract | `SkinPactMarket` (`contracts/contracts/SkinPactMarket.sol`) |
| Local environment | Hardhat 2.29.1, default hardfork **Osaka**, chain 31337, in-process |
| Sepolia environment | chain 11155111, contract `0x2Ffca05611801F532Afc6135b56baBEB0D7460eF`; gas from the existing 2026-11-06 smoke run |
| Scenario | price `0.01` test ETH, bond `0.001` test ETH, offer window `600 s`, challenge window `300 s`, delivery window `3,600 s` |
| ETH/USD assumption | **$3,000** (illustrative; test ETH has no real value) |
| Gas-price scenarios | 1, 10, 50 gwei (observed Sepolia gas price was 18–19 **wei**, an idle-testnet artifact) |

This experiment answers two questions:

1. How much gas does each SkinPact operation use?
2. At what item price is SkinPact's gas cost cheaper than a 1% / 2.5% / 5% platform fee?

## Files

| File | Contents |
|---|---|
| [`local-gas.csv`](./local-gas.csv) / [`local-gas.json`](./local-gas.json) | 11 operations, local Hardhat, target-tx `gasUsed` only |
| [`sepolia-gas.csv`](./sepolia-gas.csv) | 11 smoke transactions normalized from `sepolia-smoke.json` |
| [`fee-comparison.csv`](./fee-comparison.csv) | Platform fee vs gas at 10 gwei for competitor and hypothetical rates |
| [`summary.json`](./summary.json) | Machine-readable assumptions, happy-path totals, break-even table, sources, caveats |
| [`gas-by-operation.svg`](./gas-by-operation.svg) / [`.png`](./gas-by-operation.png) | Grouped bar chart: local vs Sepolia |
| [`fee-breakeven.svg`](./fee-breakeven.svg) / [`.png`](./fee-breakeven.png) | Break-even item price vs gas price |
| [`sepolia-smoke.json`](./sepolia-smoke.json) | Raw Sepolia smoke data (pre-existing) |

## Key methodology finding: local and Sepolia gas are not directly comparable

During this run, Sepolia executed with **Amsterdam-era gas rules**, while Hardhat
2.29.1's default local hardfork is **Osaka**:

- Sepolia state-creating calls are much more expensive. This is consistent with
  **EIP-8037** (state creation gas cost increase: a new storage slot moves from
  ~20,000 to ~97,920 gas) and **EIP-8038** (state access repricing).
- Value-bearing transactions emit an extra `Transfer` log from the
  **EIP-7708** system address `0xffff…fffe`. This is a protocol-level ETH
  transfer log, **not** an ERC-20 token transfer, and it is why the Sepolia
  receipts show a `Transfer` event that the local receipts do not.
- Sepolia's observed effective gas price was **18–19 wei**, which is typical of an
  idle testnet and not representative of market conditions.

Gas-rule sources:

- Ethereum Foundation, [EIP-8037 / EIP-8038 Glamsterdam](https://blog.ethereum.org/2026/11/06/glamsterdam-8037-8038)
  (state creation: new slot ~20,000 → ~97,920 gas; state access repriced).
- Hardhat, [Amsterdam hardfork support](https://hardhat.org/docs/reference/amsterdam-support)
  (Amsterdam is opt-in; Osaka is the default/latest stable hardfork on the page).
- [EIP-7708: ETH transfers emit a log](https://eips.sh/eip/7708)
  (protocol `Transfer` log from `0xffff…fffe` for value transfers).

**Consequence:** the local numbers are a reproducible lower bound; the Sepolia
numbers are the observed deployment environment. This report shows both and never
substitutes one for the other. For fee comparisons, the Sepolia happy path is the
conservative case.

Local transactions use a fixed **1 gwei** reporting price so the `feeWei` column
is deterministic; this is a reporting convention, not a market gas price.

## Gas by operation

Local: 11 operations, in-process Hardhat, fresh contract. Sepolia: 7 unique
operations from the smoke run; the other four were not measured on Sepolia
because no new transactions were sent for E1.

| Operation | Local gas (Osaka) | Sepolia gas (Amsterdam) | Ratio |
|---|---:|---:|---:|
| `createListing` | 175,001 | 709,721 | 4.06× |
| `buy` | 57,394 | 152,614 | 2.66× |
| `markOfferSent` | 77,952 | 255,092 | 3.27× |
| `confirmReceipt` | 64,161 | 55,845 | 0.87× |
| `claimAccepted` | 55,698 | not measured | — |
| `finalizeClaim` | 44,549 | not measured | — |
| `expireOrder` | 68,820 | not measured | — |
| `cancelListing` | 42,645 | 51,429 | 1.21× |
| `openDispute` | 79,966 | 257,106 | 3.22× |
| `resolveDispute` | 45,958 | 152,662 | 3.32× |
| `withdraw` | 32,399 | not measured | — |

**Happy path** = `createListing` + `buy` + `markOfferSent` + `confirmReceipt`:

| Environment | Happy-path gas |
|---|---:|
| Local Osaka | **374,508** |
| Sepolia Amsterdam | **1,173,272** |

`withdraw` is excluded from the happy-path comparison because the Sepolia smoke
run did not include it. The local value is 32,399 gas; a Sepolia withdraw would
likely be higher under the current state-access rules.

## Fee comparison and break-even

Break-even item price = happy-path gas cost ÷ platform fee rate. Gas cost =
`gasUsed × gasPrice × ETH/USD`. The table assumes **$3,000/ETH**.

### 10 gwei (illustrative L1 condition)

| Fee rate | Gas cost (Sepolia) | Break-even price (Sepolia) | Gas cost (local) | Break-even price (local) |
|---:|---:|---:|---:|---:|
| 1% | $35.20 | **$3,520** | $11.24 | $1,124 |
| 2.5% | $35.20 | **$1,408** | $11.24 | $449 |
| 5% | $35.20 | **$704** | $11.24 | $225 |

### Gas-price sensitivity (Sepolia, break-even item price)

| Fee rate | 1 gwei | 10 gwei | 50 gwei |
|---:|---:|---:|---:|
| 1% | $352 | $3,520 | $17,599 |
| 2.5% | $141 | $1,408 | $7,040 |
| 5% | $70 | $704 | $3,520 |

Local (Osaka) break-even prices are roughly one-third of the Sepolia values
because the local gas is lower: see `summary.json` for the full 18-row table.

### Observed Sepolia fees

The smoke run's 11 transactions used an effective gas price of 18–19 wei and paid
a total of `64,192,315 wei` = `0.000000000064192315` test ETH. At the illustrative
$3,000/ETH price that is less than $0.000001. This is an **idle-testnet artifact**
and should not be used for the economic conclusion.

### Competitor fee sources

| Platform | Seller fee | Buyer fee | Source | Date |
|---|---:|---:|---|---|
| Steam Community Market (CS2) | 15% | 0% | [SteamDB market review](https://steamdb.com/en/markets/steam) — 5% Steam transaction fee + 10% CS2 game fee | accessed 2026-11-07 |
| BUFF163 | 1.5% | 0% | [BUFF official announcement](https://buff.163.com/news/87397) — seller fee cut from 2.5% to 1.5%, effective 4-14 (year not rendered on the page); withdrawal fee 1% | accessed 2026-11-07 |
| YouPin898 | 1% | 0% | [SteamDB YouPin review](https://steamdb.com/en/markets/youpin) — last verified 2026-07-01 | accessed 2026-11-07 |

Notes:

- BUFF's official announcement is authoritative for the current 1.5% seller fee.
  Third-party trackers (including SteamDB, last verified 2026-07-02) still show
  2.5–3%, so the source disagreement is disclosed rather than silently resolved.
- The 1% / 2.5% / 5% tiers used in the break-even analysis are **hypothetical
  sensitivity inputs**, not claims about any specific competitor. The 2.5% figure
  was BUFF's previous seller fee; 1% matches YouPin; 5% is a generic upper tier.
- The comparison is intentionally conservative: it ignores withdrawal fees,
  payment fees, and the cost of acquiring/withdrawing test ETH.

## Interpretation

At a realistic L1 gas price of 10 gwei and $3,000/ETH, one Sepolia happy-path
order costs about **$35** in gas. That is only cheaper than a fee when the item is
worth more than roughly:

- **$3,520** at a 1% fee,
- **$1,408** at 2.5%,
- **$704** at 5%.

For cheap CS2 skins, L1 gas dominates the "zero platform fee" claim. The honest
conclusion is **0 platform fee is not 0 cost**; the design is more attractive on
an L2 or with a cheaper execution environment. The local Osaka numbers
($11.24 gas, break-even $1,124 / $449 / $225) show the same shape at a lower
cost, but they are not a substitute for the deployment environment.

`createListing` is the dominant cost in both environments because it creates the
listing struct, the active-item index, and the listing ID. Under Amsterdam state
pricing it is ~710k gas; under Osaka/Hardhat it is ~175k. Any design that reduces
state creation (e.g., hashing more fields, avoiding the active-item index) would
reduce the most expensive operation.

## Reproduce

```bash
# from the repository root, code commit 6d8ffa0
npm run e1:gas       # local Hardhat: writes local-gas.csv + local-gas.json
npm run e1:report    # writes Sepolia CSV, fee CSV, summary, two SVGs
```

The report script uses no chart dependency; it writes SVG directly. To produce
PNG versions on macOS, headless Chrome is used (this preserves the chart aspect
ratio; `qlmanage` crops non-square thumbnails):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1040,700 \
  --screenshot=experiments/e1/gas-by-operation.png \
  file://$PWD/experiments/e1/gas-by-operation.svg

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1040,680 \
  --screenshot=experiments/e1/fee-breakeven.png \
  file://$PWD/experiments/e1/fee-breakeven.svg
```

To change the illustrative ETH price:

```bash
E1_ETH_USD=6000 npm run e1:report
```

## Assumptions and limitations

- **Testnet only.** Test ETH has no real value; all USD figures are economic
  illustrations.
- **ETH/USD is an assumption** ($3,000), not a price fetched for the run. The
  report can substitute a dated spot price without changing the gas data.
- **Gas-price scenarios (1/10/50 gwei) are sensitivity inputs.** The observed
  18–19 wei Sepolia price is an idle-chain artifact and is not used for the
  economic conclusion.
- **Local vs Sepolia gas rules differ** (Osaka vs Amsterdam; EIP-8037/8038 and
  EIP-7708). The numbers are shown side by side; do not mix them in one total.
- **The Sepolia smoke run did not include** `claimAccepted`, `finalizeClaim`,
  `expireOrder`, or `withdraw`; those are local-only measurements in E1.
- **No new Sepolia transactions were sent for E1.** Re-running the smoke would
  change the observed gas-price artifact and require faucet funds.
- The local gas script excludes setup transactions and measures only the target
  operation; this is stated per row in the CSV notes.
- `createListing` on Sepolia was a first-use state creation. A later listing in a
  warm contract would have different access costs; EIP-8037 state creation cost
  is paid once per slot, so the first listing is the worst case in a fresh
  contract.

## Related evidence

- E2 security findings and Slither/coverage: [`../e2/README.md`](../e2/README.md)
- Sepolia deployment: [`../../deployments/sepolia.json`](../../deployments/sepolia.json)
- Sepolia smoke script: [`../../scripts/sepolia-smoke.ts`](../../scripts/sepolia-smoke.ts)
