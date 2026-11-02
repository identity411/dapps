# Stage 0 Seller Helper — Demo Reference Only

> **WARNING:** This directory is a Stage 0 feasibility spike, not the S1/S2 DApp
> implementation. Do **not** copy/import these scripts directly into the product.
> They only demonstrate the Steam trade-offer leg (local seller login → send a
> specific item to a buyer Trade URL). They have no Relay auth, no contract or
> evidence integration, no encryption, no UI, no tests, and no recovery/hardening.

## What it demonstrates

- Local Steam QR login / refresh-token reuse (token stays on this machine).
- Buyer Trade URL validation and seller/buyer separation.
- Sending one specific CS2 inventory item to that Trade URL.
- Watching the sent offer status; no auto-confirm of Steam Guard, no auto-accept.

This is the evidence for the Stage 0 Go decision, not an architecture to extend.

## Files

| File | Purpose |
|---|---|
| `seller-helper.mjs` | Throwaway local helper that logs in and sends/watches the offer |
| `check-env.mjs` | Local `.env` validator for the demo only |
| `../../.env.example` | Placeholder template; copy to local `.env` |
| `../../specs/2026-11-02-stage-0-steam-tradeoffer-spec.md` | Stage 0 spec/result |

## Run (Stage 0 only)

```bash
cp .env.example .env   # fill locally; never commit .env
npm install
npm run stage0:check
npm run stage0:helper                 # QR login, item check, prompt, send + watch
npm run stage0:helper -- --send       # skip SEND prompt
npm run stage0:helper -- --send --no-wait
```

The helper writes `.steam-helper-session.json` and `.steam-helper-qr.svg` locally
(both gitignored, mode 600). Delete them when finished.

## Not reusable in S1/S2

The DApp helper needs a different design: Relay authentication/authorization,
one-time pairing, encrypted buyer URL handling, contract order lookup, offer
evidence hashing/upload, session lifecycle/revocation, structured errors/retries,
and tests. Do not treat this script as production code or as a security reference.
