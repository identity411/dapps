# E2 — Trust Table: SkinPact S2-mini

| Field | Value |
|---|---|
| Date | 2026-11-07 |
| Code under test | commit `6d8ffa0` |
| Scope | Course prototype, testnet only |
| Companion documents | [`threat-model.md`](./threat-model.md), [`findings.md`](./findings.md) |

This table states, for every component that can affect money, delivery, or
privacy, **what it is trusted to do**, **what it can do unilaterally**, **what it
cannot do**, and **how that trust is enforced**. “Trusted” here means “if this
component behaves maliciously or is compromised, the listed harm is possible.”

## 1. On-chain components

| Component | Trusted for | Can unilaterally | Cannot | Enforced by | Residual risk | Disclosure |
|---|---|---|---|---|---|---|
| `SkinPactMarket` logic | Correct state transitions and accounting | Move escrow only through the coded paths | Change rules, upgrade, or withdraw funds to an arbitrary address | Immutable bytecode; no owner; pull payments | Compiler/library bugs; not audited beyond Slither/tests | Report §Limitations; this table |
| Arbiter | Interpreting off-chain evidence fairly | Resolve any Disputed listing in either party's favor | Touch Active/Funded/OfferSent/ClaimPending directly; resolve twice; set `sellerWins && bondToBuyer` | `NotArbiter`, `NotDisputed`, `InvalidResolution`; tests | Single key; loss disables disputes; abuse possible | F-02; README; slides |
| Seller | Honest listing and delivery | List, mark, claim, cancel Active, dispute | Buy own listing; mark after deadline; claim before OfferSent; cancel funded; reuse offer hash | Contract checks; tests | Can mark without sending (F-05); false claim (F-01) | F-01, F-05 |
| Buyer | Honest confirmation | Buy, confirm, dispute ClaimPending, submit URL | Confirm as seller; buy twice; dispute after challenge deadline; settle a Disputed order | Contract checks; tests | Can freeze a claim by disputing (F-04) | F-04 |
| Anyone | Liveness | `expireOrder`, `finalizeClaim` after challenge, `openDispute` after delivery deadline | Act as a party before those windows | Time/deadline checks; tests | None beyond intended liveness | Threat model T-14 |

## 2. Off-chain components

| Component | Trusted for | Can unilaterally | Cannot | Enforced by | Residual risk | Disclosure |
|---|---|---|---|---|---|---|
| Relay (application) | Correct auth, access control, URL vault, evidence bookkeeping | Issue sessions, decrypt Trade URLs at runtime, accept/reject evidence | Move escrow; forge on-chain state; reveal a URL to a non-seller | JWT/helper tokens, on-chain role checks, AES-256-GCM, no-store, cleanup | Can read all stored URLs; middleware bugs would matter | F-03; trust table |
| Relay host / operator | Honest operation and key custody | Read env keys, DB, memory, backups; log without bodies by design | Alter chain state | Operational discipline only | Host compromise decrypts all Trade URLs (F-03) | F-03 |
| Seller local helper | Truthful Steam observation and evidence upload | Login to Steam, send offers, report offer/accepted states, read funded orders | Sign on-chain transactions; claim funds; alter contract | Seller runs it; Relay checks seller scoping and offer hash; Steam is the source of truth | Malicious/modified helper can fabricate evidence (F-01); compromised machine exposes session | F-01, F-11, F-13 |
| Seller machine | Session and ledger confidentiality | Read session, QR, ledger, buyer URL | Sign without MetaMask confirmation | File modes 0600/0700; gitignore; local API loopback/origin checks | Local malware can trigger helper actions or steal session | F-13; README |
| Web client | Honest rendering and transaction construction | Request signatures; display URLs | Move funds without the user's signature | Wallet confirmation; Relay auth; on-chain checks | Phishing/XSS outside scope; user may sign a bad transaction | Threat model §5 |
| Buyer device | Trade URL secrecy and confirmation judgment | Accept/reject Steam offer; submit URL | Move escrow without a signature | Steam Guard; user inspection | Bearer URL theft leads to fraudulent offers; buyer must accept | F-03; T-19 |

## 3. External components

| Component | Trusted for | Can unilaterally | Cannot | Enforced by | Residual risk | Disclosure |
|---|---|---|---|---|---|---|
| Steam Community | Item custody and transfer | Hold, delay, deny, or reverse offers; change account state | Move on-chain escrow | None from this system; evidence is observational | Non-delivery, holds, trade bans, API/game changes | F-01; MVP limitations |
| MetaMask / wallet | Correct signing and network selection | Ask the user to sign anything | Move funds without a signature | User confirmation | Malicious dApp or wrong chain; user error | Report limitations |
| Sepolia / RPC provider | Chain liveness and correct reads | Censor or delay transactions; be unavailable | Alter confirmed chain history | Multiple RPCs possible; on-chain receipts | Testnet instability; faucet limits | Sepolia spec; report appendix |
| Arbiter's off-chain evidence store | Authenticity and chain of custody | Reveal, alter, or lose evidence | Change the on-chain hash | Manual process; hashes on-chain | Unverifiable content; no Relay read API (F-09) | F-09 |

## 4. Who must trust whom

| Trust holder | Must trust | For | Mitigation |
|---|---|---|---|
| Buyer | Seller | Sending the exact item | Steam offer details; confirm only after inspection; dispute |
| Buyer | Arbiter | Fair resolution | Published policy; demonstration constraints |
| Buyer | Relay | Not leaking the Trade URL | Encryption; access control; retention; no-store |
| Seller | Buyer | Honest confirmation/dispute | Challenge window; arbiter; Steam history |
| Seller | Relay/helper | Correct evidence and order data | Offer hash checks; idempotency; local logs |
| Arbitrator | Relay/helper/Steam | Authentic evidence | Off-chain review; hashes; chain of custody |
| Everyone | Contract | Correct code and no backdoor | Immutability, tests, Slither, coverage |

## 5. Trust by deployment context

| Context | Contract | Relay | Helper | Steam | Arbiter | Notes |
|---|---|---|---|---|---|---|
| Hardhat local E2E | In-process, throwaway | In-process, in-memory SQLite | **Mocked** | **Not contacted** | Local signer | 99 checks; mock explicitly labelled |
| Local demo (31337) | Local chain | Localhost | Seller's machine | Real or mock, labelled | Demo EOA | Suitable for rehearsal |
| Sepolia demo | Public testnet, verified | Localhost or VPS | Seller's machine | Real or mock, labelled | Dedicated test EOA | Test ETH only |
| Production (not built) | Would need audit + upgrade policy | Would need KMS, HA, revocation | Hardened | Still unverifiable on-chain | Multi-sig / policy | Outside course scope |

## 6. Trust-boundary invariants

1. **No off-chain component can move escrow.** Only the contract’s coded paths can
   credit or pay; the Relay and helper have no signing shortcut.
2. **The arbiter is the only privileged on-chain role**, and it can only act on a
   Disputed listing.
3. **The Relay can read Trade URLs by design**, but cannot reveal them to anyone
   other than the funded listing’s seller or that seller’s paired helper.
4. **The helper is authoritative only for observations**, never for settlement.
5. **Steam is authoritative for delivery, but its state is not verifiable
   on-chain.** The hash is a commitment, not proof.
6. **Every terminal path returns funds**: Completed pays the seller; Refunded and
   Cancelled credit pull payments; no non-terminal state is permanent given the
   deadline paths (`expireOrder`, `finalizeClaim`, `openDispute`).

## 7. Residual trust summary

| Residual trust | Severity | Accepted? | Report location |
|---|---|---|---|
| Steam evidence is off-chain and unverifiable | Medium | Yes, inherent | F-01; §Limitations |
| Single immutable arbiter | Medium | Yes, demo | F-02; §Limitations |
| Relay can decrypt Trade URLs | High impact | Yes, local demo | F-03; §Limitations |
| Buyer dispute griefing | Low | Yes | F-04 |
| Seller mark-without-offer | Low | Yes | F-05 |
| Buyer-first Accept race | Medium | Yes, procedural | F-06 |
| Missed challenge window | Low | Yes | F-07 |
| No seller abort | Low | Yes | F-08 |
| No arbiter evidence API | Low | Yes, manual | F-09 |
| Helper token no revocation | Low | Yes | F-11 |
| Pairing code brute force | Low | Partially | F-12 |
| Local helper API unauthenticated | Low | Yes | F-13 |

**Required disclosures in the final report, slides, and video:**

- Testnet-only, test ETH has no real value.
- Steam delivery is off-chain and unverifiable by the contract.
- The arbiter is a single trusted EOA in this prototype.
- The buyer Trade URL is a bearer secret held (encrypted) by the Relay.
- The automated E2E uses a mocked Steam transport; real-steam steps are manual
  and must be labelled on screen.
