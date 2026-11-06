# E2 — Security Findings: SkinPact S2-mini

| Field | Value |
|---|---|
| Date | 2026-11-07 |
| Code under test | commit `6d8ffa0` |
| Scope | `SkinPactMarket` contract, Relay, helper, local E2E |
| Tools | Hardhat 2.29.1, Node 22.23.2, Slither 0.11.6, solc 0.8.24 |
| Raw static analysis | [`slither.txt`](./slither.txt) |
| Raw coverage | [`coverage.txt`](./coverage.txt) |
| Threat model | [`threat-model.md`](./threat-model.md) |
| Trust table | [`trust-table.md`](./trust-table.md) |

## Summary

| Result | Count |
|---|---:|
| Critical | 0 |
| High (code vulnerability) | 0 |
| High impact / accepted trust boundary (F-03) | 1 |
| Medium | 3 |
| Low | 8 |
| Informational | 5 |
| **Total findings** | **17** |
| Slither High/Medium | 0 |
| Slither informational instances | 5 |

**Bottom line.** No exploitable authorization, reentrancy, double-settlement, or
access-control defect was found in the contract or the off-chain access paths.
Coverage is 100% of statements, functions, and lines (87.5% of branches). The
material risks are **trust-boundary and operational**: Steam delivery is not
verifiable on-chain, the arbiter is centralized, and the buyer Trade URL is a
bearer secret that the Relay can decrypt. These are disclosed limitations of the
course prototype, not hidden vulnerabilities.

Severity convention: **Medium** = real loss/freeze path under a plausible actor;
**Low** = limited impact or requires local access; **Informational** = design
trade-off or static-analysis observation with no direct exploit path.

---

## Findings

### F-01 — Steam delivery cannot be verified on-chain (Medium, design)

**Affected:** contract `claimAccepted` / `confirmReceipt` / `openDispute`;
helper evidence upload.

**Description.** The contract records `offerIdHash`, `evidenceHash`, and
`disputeHash`, but it cannot prove that Steam actually delivered the item. A
seller can call `claimAccepted` with any non-zero hash after `markOfferSent`
(`SkinPactMarket.sol:213-224`). The Relay checks that the evidence corresponds to
the offer recorded for that listing and that its own `observedAt` is parseable,
but `observedAt` and the acceptance claim originate from the seller-controlled
helper (`relay/src/app.ts:885-969`).

**Impact.** A dishonest seller can try to claim payment without delivery. The
buyer's only protection is to dispute within the challenge window and rely on the
arbiter reviewing off-chain evidence. Conversely, a buyer can dispute a genuine
claim, forcing arbitration.

**Reproduction (local, no Steam):**
1. Run the E2E scenario P7 (`npm run e2e:local`): the helper mocks an
   `Accepted(3)` report, the seller claims, the buyer disputes, and the arbiter
   rules for the seller.
2. Replace the mock report with a fabricated one; the Relay accepts any
   well-formed evidence payload whose offer hash matches. The chain accepts the
   resulting evidence hash.

**Mitigation present.** Challenge window (300 s in tests / deployment), buyer
dispute path, arbiter review, no automatic payout in `markOfferSent`.

**Residual risk / recommendation.** This is inherent to using Steam as the
delivery rail. For future work: commit richer evidence (signed Steam API
snapshots, timestamps from an independent source), define an arbiter evidence
policy, and consider a seller bond large enough to make false claims
unprofitable. The report and video must state that delivery is off-chain and
mock-labelled in tests.

**Status:** Accepted design limitation; disclosed.

---

### F-02 — Centralized, immutable arbiter (Medium, design)

**Affected:** `SkinPactMarket.sol:46`, `:109-125`, `:292-316`.

**Description.** A single address, fixed at construction, decides every dispute.
There is no rotation, no multi-sig requirement, and no on-chain appeal. A lost
key permanently disables dispute resolution; a malicious key can direct price and
bond to either party.

**Impact.** Up to the full escrowed price plus bond per disputed listing.

**Mitigation present.** `arbiter` is immutable and publicly visible; only Disputed
listings can be resolved; contradictory outcomes (`sellerWins && bondToBuyer`) are
rejected; the two resolution branches move funds only to the seller or the buyer.

**Residual risk / recommendation.** Deploy with a Safe or dedicated EOA with
documented key management. For the course demo, disclose the single-EOA setup in
the report, slides, and video. A production design needs a multi-sig or an
accountable arbitration service with a published policy.

**Status:** Accepted design limitation; disclosed.

---

### F-03 — Buyer Trade URL is a bearer secret exposed to the Relay (High impact, accepted)

**Affected:** `relay/src/app.ts:646-744`, `relay/src/crypto.ts:7-25`,
`relay/src/db.ts:31-43`.

**Description.** A Steam Trade URL contains a `partner` and a `token` that lets
anyone send a trade offer to that account. The Relay stores the URL encrypted
with AES-256-GCM and restricts reads to the seller after funding, but the Relay
process holds the decryption key and can read every URL at runtime. The token is
also decrypted for the seller's helper (`relay/src/app.ts:818-851`).

**Impact.** Compromise of the Relay host and its environment reveals all active
buyer Trade URLs. A stolen URL lets an attacker create a trade offer; the buyer
must still accept it, so theft is not automatic, but social engineering or a
confusing offer could succeed.

**Mitigation present.** AES-256-GCM with random 96-bit IV and auth tag; URL is
never echoed in public metadata or reports; seller-only after `Funded`; helper
route is seller-scoped; `Cache-Control: no-store`; rows deleted when the listing
is terminal (`relay/src/app.ts:1030-1053`); logs omit request bodies and headers
(`relay/src/app.ts:1016-1020`); helper errors redact URLs/tokens
(`helper/src/orders.ts:143-149`). Relay tests assert the raw token never appears
in DB rows or API payloads, and E2E P4 repeats the check.

**Residual risk / recommendation.** Move the key to a KMS/HSM in a production
design, separate the key from the database host, minimize retention further, and
consider on-demand, single-use URL delivery. The course demo accepts this trust
because the Relay runs locally under the operator's control.

**Status:** Accepted for the course prototype; disclosed.

---

### F-04 — Buyer can freeze a seller claim by disputing (Low, griefing)

**Affected:** `SkinPactMarket.sol:275-277`, E2E P7.

**Description.** In `ClaimPending`, only the buyer can open a dispute, and they may
do so at any time before `challengeDeadline`. The seller's payout then waits for
the arbiter. There is no buyer bond or dispute fee.

**Impact.** Temporary freeze of price + bond; no permanent loss if the arbiter
rules for the seller. Repeated disputes are not possible after resolution, but a
buyer can grief each order once.

**Mitigation present.** Challenge deadline bounds the window; arbiter decides;
funds remain in escrow and are not lost; the buyer cannot dispute after the
deadline.

**Recommendation.** Consider a small buyer dispute bond returned if the buyer
wins, or a shorter challenge window with an explicit arbitration SLA.

**Status:** Partially mitigated; residual accepted.

---

### F-05 — Seller can mark an offer without sending it (Low, griefing)

**Affected:** `SkinPactMarket.sol:179-193`, `openDispute` path.

**Description.** `markOfferSent` records a declaration, not proof that a Steam
offer exists. A seller can mark an offer to prevent `expireOrder` (which only
applies in `Funded`) and leave the buyer waiting.

**Impact.** Buyer's price stays escrowed until the buyer disputes from
`OfferSent`. The buyer can dispute immediately as a party, so the freeze is not
indefinite, but it costs time and arbiter attention.

**Mitigation present.** Buyer or seller may open a dispute from `OfferSent`;
permissionless escalation is allowed after `deliveryDeadline`; the arbiter can
resolve. The helper's real flow only reports an offer after Steam returns a trade
offer ID, and the local E2E records that idempotently.

**Recommendation.** Require the offer ID hash to be registered/validated by the
Relay before `markOfferSent`, or add a short seller-response window with an
automatic refund path.

**Status:** Partially mitigated; residual accepted.

---

### F-06 — Buyer-first Accept race cannot be proven on-chain (Medium, design)

**Affected:** workflow between `buy`, helper offer, and buyer confirmation.

**Description.** If the buyer accepts a Steam offer before the seller calls
`markOfferSent`, the chain has no record of it. The seller could claim they never
sent an offer, or the buyer could confirm without an on-chain offer. The system
relies on the UI enforcing “mark before accept” and on off-chain Steam history
for arbitration.

**Impact.** Disputes are harder to adjudicate; a buyer may lose the item with
weaker on-chain evidence, or a seller may face a fraudulent claim.

**Mitigation present.** UI flow and helper evidence; `confirmReceipt` also works
from `Funded`, so an honest buyer can still release payment; the arbiter can
review Steam history.

**Recommendation.** Make the offer hash mandatory for confirmation, or add a
commitment from the buyer before accepting; document the race in the report and
video.

**Status:** Accepted design limitation; disclosed.

---

### F-07 — Challenge notification relies on polling (Low)

**Affected:** web UI / Relay.

**Description.** The buyer may miss the challenge window because there is no
push/email notification. The UI shows a countdown, but only while open. If the
window passes, `finalizeClaim` pays the seller.

**Impact.** A buyer who does not open the app may lose the ability to dispute a
claim.

**Mitigation present.** Countdown and Relayer state; the challenge window is
configurable (300 s in tests; deployment must choose a practical value).

**Recommendation.** Add email/push/Telegram notifications or a longer window for
the production design. For the demo, demonstrate the countdown explicitly.

**Status:** Open limitation; disclosed.

---

### F-08 — No `abortBySeller` for a Funded order (Low, liveness)

**Affected:** contract; `Funded` state.

**Description.** Once a buyer funds, the seller cannot cancel. If the seller
cannot deliver, the buyer must wait for `expireOrder` after `offerDeadline`, or
the parties must dispute after the seller marks/delivery deadline. This is a
deliberate safety trade-off, but it is a liveness limitation.

**Mitigation present.** `expireOrder` is permissionless after the offer deadline;
the buyer or seller can dispute from `OfferSent`; the arbiter can resolve.

**Recommendation.** Add a mutual-cancel path with both signatures if the product
needs faster exits.

**Status:** Accepted design limitation; disclosed.

---

### F-09 — No arbiter evidence-read API in the Relay (Low, operational)

**Affected:** Relay routes; arbitration workflow.

**Description.** The Relay stores encrypted evidence, but there is no endpoint for
the arbiter to retrieve it. The arbiter must rely on manual/off-chain records
(Steam history, screenshots, helper logs). The on-chain `disputeHash` is only a
commitment.

**Impact.** Arbitration is slower and less auditable; the demo must prepare
evidence manually.

**Mitigation present.** Evidence is stored encrypted with a hash; the seller and
helper can view reports; the arbiter can be given access out of band.

**Recommendation.** Add an arbiter-authenticated read endpoint or package the
evidence bundle off-chain with a documented chain of custody.

**Status:** Accepted operational limitation; disclosed.

---

### F-10 — `InEscrow(11)` is not final delivery (Informational)

**Affected:** `helper/src/orders.ts:71-107`.

**Description.** Steam's `InEscrow` state is mapped to `held`, not `accepted`.
The helper does not auto-claim. This avoids treating an intermediate Steam state
as delivery, but it can leave an order waiting.

**Mitigation present.** Explicit state mapping; manual review; the buyer can still
confirm; dispute path remains available.

**Recommendation.** Surface `InEscrow` prominently in the UI and document the
manual step.

**Status:** Correctly handled; informational.

---

### F-11 — Helper token has no revocation endpoint (Low)

**Affected:** `relay/src/app.ts:746-804`, `helper/src/session.ts`.

**Description.** A helper token is valid for 28,800 seconds (8 h) and is stored
hashed. There is no endpoint to revoke a stolen token before expiry beyond
waiting or rotating the Relay's database.

**Impact.** A stolen helper token can read funded orders (including buyer Trade
URLs) and upload offer/accepted evidence for the same seller.

**Mitigation present.** Token is hashed at rest; seller-scoped; 0600 session file;
short-ish TTL; helper routes reject wallet JWTs.

**Recommendation.** Add a revoke endpoint and a UI “unpair” action; shorten the
TTL for the demo.

**Status:** Residual; low likelihood.

---

### F-12 — Pairing code could be brute-forced (Low)

**Affected:** `relay/src/app.ts:746-804`.

**Description.** The helper pairing code is six digits (1,000,000 possibilities),
valid for 5 minutes, and rate-limited to 10 attempts/minute per IP. A distributed
attacker could try many guesses, though the code hashes at rest and is one-time.

**Impact.** An attacker who guesses a live code pairs as the seller's helper and
can read funded orders.

**Mitigation present.** Hashing at rest, TTL, one-time use, rate limit, and the
code is only issued to an authenticated seller.

**Recommendation.** Increase entropy (e.g., 8 alphanumeric characters) or require
a confirmation in the seller's web session.

**Status:** Partially mitigated; accepted for demo.

---

### F-13 — Loopback helper API has no per-request authentication (Low)

**Affected:** `helper/src/local-api.ts:108-224`.

**Description.** The helper API is protected by loopback binding, a `Host` header
check (DNS rebinding), and an `Origin` allowlist, not by a secret token. A
malicious process already running on the seller's machine could call
`/api/login/start` or `/api/pair` (the latter still requires a valid code).

**Impact.** Local attacker can trigger login flows or status changes; without a
pairing code, they cannot pair to the Relay.

**Mitigation present.** `127.0.0.1` binding; loopback-only `Host`; origin
allowlist; QR payload not exposed in status; request timeouts.

**Recommendation.** Add a per-helper secret and require it on sensitive routes if
the threat model includes local malware.

**Status:** Partially mitigated; accepted for demo.

---

### F-14 — Slither: timestamp comparisons (Informational)

**Affected:** `markOfferSent` (`:183`), `finalizeClaim` (`:229`), `expireOrder`
(`:239`), `openDispute` (`:272`, `:277`).

**Description.** Slither flags `block.timestamp` comparisons. In SkinPact,
timestamps only gate coarse windows (offer 600 s, challenge 300 s, delivery
3,600 s in the deployment/tests). A validator can shift the boundary by a few
seconds, but there is no fine-grained price or randomness depending on it.

**Impact.** Negligible; a party could gain or lose a few seconds at a window edge.

**Mitigation present.** Coarse windows; no per-second economics; tests advance
time deterministically.

**Recommendation.** Keep windows comfortably larger than expected block times; add
a small buffer if the production design uses shorter windows.

**Status:** Accepted; informational.

---

### F-15 — Slither: low-level call in `withdraw` (Informational)

**Affected:** `SkinPactMarket.sol:318-327`.

**Description.** `withdraw` uses `address.call{value: amount}`. This is the
intended pull-payment pattern. The credited balance is zeroed before the call and
the function is `nonReentrant`, so a reentrant recipient cannot double-withdraw.

**Impact.** None found; a recipient that rejects ETH causes a revert and can
retry, not a loss.

**Mitigation present.** Checks-effects-interactions, `ReentrancyGuard`, pull
payments, revert on failure.

**Recommendation.** No change required. If desired, use `Address.sendValue` for
style consistency.

**Status:** Accepted; informational.

---

### F-16 — In-memory rate limiting only (Informational)

**Affected:** `relay/src/app.ts:242-278`.

**Description.** Limits are per-process and per-IP. A restart clears the buckets,
and a distributed attacker can spread attempts.

**Impact.** The pairing-code and auth limits are weaker than they appear against
a determined attacker.

**Recommendation.** Use a shared store (Redis) or an edge rate limiter in
production.

**Status:** Accepted for the course demo.

---

### F-17 — Public item metadata and wallet/Steam linkage (Informational)

**Affected:** `GET /metadata/:itemHash`, public inventory endpoint.

**Description.** The item hash, seller wallet, Steam ID, asset IDs, and display
metadata are public. This is intentional for a marketplace, but it links wallets
to Steam accounts.

**Recommendation.** Document the privacy trade-off; do not use real accounts in
the demo video without masking.

**Status:** Accepted; disclosed.

---

## 8. Verified properties (what the tests establish)

| Property | Evidence |
|---|---|
| Only seller can mark/claim/cancel | contract suites; E2E |
| Only buyer can confirm/dispute a claim | contract suites; E2E P7 |
| Only arbiter can resolve; contradictory flags rejected | `resolveDispute` suite |
| Double settlement rejected | contract suites; E2E P1/P3 |
| Offer hash cannot be reused across listings | contract suite |
| Challenge and offer deadlines enforced | contract suite; E2E P2/P3 |
| Dispute windows enforced in both directions | contract suite; E2E P6/P7/P8 |
| Accounting invariant: balance = live escrow + withdrawable credits | two invariant tests |
| Pull payments and reentrancy guard | `withdraw` suite; Slither |
| Buyer URL encrypted, access-controlled, deleted on terminal | relay tests; E2E P4 |
| Login replay/tamper rejected | `auth.test.ts` |
| Pairing code one-time and seller-scoped | relay test; E2E P4 |
| Helper local API rejects DNS rebinding and bad origins | helper test |
| Errors do not leak URLs/tokens | helper test; E2E P4 |
| `InEscrow(11)` never treated as accepted | helper state-mapping test |

## 9. Recommended follow-ups (prioritized)

1. Use a Safe/multi-sig arbiter with a published arbitration policy. (F-02)
2. Add an arbiter evidence-read path and a documented chain of custody. (F-01, F-09)
3. Move the Relay encryption key to a KMS/HSM; separate key and DB hosts. (F-03)
4. Add helper-token revocation and a UI unpair action. (F-11)
5. Add buyer notification for the challenge window. (F-07)
6. Increase pairing-code entropy. (F-12)
7. Consider a buyer dispute bond or a tighter dispute policy. (F-04)
8. Require the Relay-recorded offer hash before `markOfferSent` if the product
   needs stronger anti-griefing guarantees. (F-05)

## 10. Reproducibility

```bash
# from the repository root, code commit 6d8ffa0
npm test                      # 36 contract + 1 shared + 18 relay + 12 helper
npm run e2e:local             # P1–P8, 99 checks, Steam mocked
cd contracts && npx hardhat coverage
# Slither (macOS, Hardhat solc cache)
slither contracts/SkinPactMarket.sol \
  --solc ~/Library/Caches/hardhat-nodejs/compilers-v2/macosx-amd64/solc-macosx-amd64-v0.8.24+commit.e11b9ed9 \
  --solc-remaps "@openzeppelin/=/Users/william/dapps/node_modules/@openzeppelin/" \
  --solc-args "--allow-paths /Users/william/dapps/node_modules,/Users/william/dapps/contracts" \
  --filter-paths "node_modules"
```

Environment: Node 22.23.2, npm 10.9.8, Hardhat 2.29.1, Slither 0.11.6,
solc 0.8.24+commit.e11b9ed9, macOS (Darwin 25.6.0).
