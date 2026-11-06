# E1 — Gas / fee data

## Sepolia smoke (2026-11-06)

Raw data: [`sepolia-smoke.json`](./sepolia-smoke.json)

- Contract: `0x2Ffca05611801F532Afc6135b56baBEB0D7460eF`
- Deploy tx: `0xa13facad2e103aa5df7fe0d876f73e742cb3ba4c9c9a7a037d446f52c22e04e6`
- Block: `12077649`
- Chain: Sepolia `11155111`
- Verified: https://sepolia.etherscan.io/address/0x2Ffca05611801F532Afc6135b56baBEB0D7460eF#code
- Price: `10000000000000000 wei` (0.01 test ETH)
- Bond: `1000000000000000 wei` (0.001 test ETH)
- 11 transactions, total fee `64192315 wei`

| Step | gasUsed |
|---|---:|
| `createListing` | 709,721 |
| `buy` | 152,614 |
| `markOfferSent` | 255,092 |
| `confirmReceipt` | 55,845 |
| `createListing(cancel)` | 709,721 |
| `cancelListing` | 51,429 |
| `createListing(dispute)` | 709,733 |
| `buy(dispute)` | 152,614 |
| `markOfferSent(dispute)` | 255,092 |
| `openDispute` | 257,106 |
| `resolveDispute(buyerWins+slash)` | 152,662 |

Notes:

- Steam / Relay / helper were **not** involved in this run; it is a direct contract smoke test.
- Gas price varies on Sepolia; the JSON records per-tx `gasPrice` and `feeWei`.
- This is raw data, not the final E1 report. Still to do:
  - local Hardhat gas for the same operations, and for `claimAccepted`, `finalizeClaim`, `expireOrder`, `withdraw`
  - fee comparison against 1% / 2.5% / 5% platform fees
  - break-even price chart and CSV/table
  - E1 write-up in the report
