# E2 — Security / Trust Boundary Experiment

**Date:** 2026-11-07 · **Code commit:** `6d8ffa0` · **Scope:** testnet-only course
prototype.

This directory contains the report-level security evidence for SkinPact S2-mini.

| File | Contents |
|---|---|
| [`threat-model.md`](./threat-model.md) | Assets, actors, trust boundaries, 42 threat scenarios, out-of-scope, assumptions |
| [`findings.md`](./findings.md) | 17 findings with severity, reproduction, mitigation, residual risk, recommendations; verified properties; follow-ups |
| [`trust-table.md`](./trust-table.md) | Component-by-component trust assumptions, unilateral powers, residual trust, required disclosures |
| [`slither.txt`](./slither.txt) | Raw Slither 0.11.6 output (0 High/Medium; 5 informational) |
| [`coverage.txt`](./coverage.txt) | Raw `hardhat coverage` output (100% stmts/funcs/lines; 87.5% branch) |

## Results at a glance

| Check | Result |
|---|---|
| Contract test suite | 36 passing |
| Shared / Relay / Helper tests | 1 / 18 / 12 passing |
| Local E2E (contract + Relay, Steam mocked) | 99 checks passing (P1–P8) |
| Slither High/Medium findings | 0 |
| Slither informational | 5 (timestamp windows ×4, low-level call ×1) |
| Statement / function / line coverage | 100% / 100% / 100% |
| Branch coverage | 87.5% |

## Key conclusions

1. **No exploitable contract-level authorization, reentrancy, or double-settlement
   defect was found.** Unauthorized callers, invalid states, deadline bypasses,
   offer-hash reuse, double settlement, and contradictory resolutions are all
   rejected and covered by tests.
2. **The material risks are trust boundaries, not code bugs:** Steam delivery is
   unverifiable on-chain (F-01), the arbiter is a single immutable EOA (F-02), and
   the Relay can decrypt buyer Trade URLs (F-03).
3. **The buyer Trade URL handling is strong for a prototype:** AES-256-GCM at
   rest, seller-only access after funding, helper scoping, `no-store`, terminal
   deletion, and tests that assert the token never appears in DB rows, reports, or
   public metadata.
4. **`InEscrow(11)` is not treated as delivery.** The helper maps it to `held` and
   never auto-claims.
5. **The E2E Steam transport is mocked.** It is not evidence of a real Steam
   delivery; real-Steam acceptance is a manual exit check and must be labelled as
   such in the report/video.

## Reproduce

```bash
# Repository root, code commit 6d8ffa0
npm test
npm run e2e:local
cd contracts && npx hardhat coverage
```

Slither was run from `contracts/` with the Hardhat-cached solc binary and an
absolute OpenZeppelin remap (see the header of `slither.txt` and §10 of
`findings.md`).

Environment: macOS (Darwin 25.6.0), Node 22.23.2, npm 10.9.8, Hardhat 2.29.1,
Slither 0.11.6, solc 0.8.24+commit.e11b9ed9.

## Limitations

- The experiment is local-only; no new Sepolia transactions were required.
- Steam is mocked in the E2E and in the evidence-upload path tests. No claim is
  made that a real item was delivered during this run.
- Slither is a static analyzer, not a formal verification or audit. Coverage
  measures executed lines, not correctness.
- The arbiter, Relay operator, and seller machine are trusted roles; see the trust
  table for the exact residual risk.
