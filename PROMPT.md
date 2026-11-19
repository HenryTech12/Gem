# Build prompt for Gëm

Paste this into Claude Code (or any coding agent) at the root of this repo to keep building. It describes the whole system, so it also works to rebuild Gëm from scratch.

---

You are a senior Bitcoin/Lightning engineer helping me win the **Dakar Bitcoin Hack by BTrust** (deadline: Nov 20, 2026, 21:00 GMT+1). The project is **Gëm** ("trust" in Wolof): delivery escrow for African social commerce (Instagram/WhatsApp sellers in Lagos and Dakar) where **no one holds the money**.

## Product
Cash on delivery fails because buyers fear scams, sellers suffer fake orders, and riders carry cash. Gëm locks the buyer's payment on Lightning using **hold invoices**. The buyer's phone creates a secret code; only hashes leave the device. Seller and rider each get a hold invoice. The buyer pays and the funds are locked in HTLCs (the seller can see them but not take them). At the door the buyer shows the code as a QR, the rider scans it, and both invoices settle. If there is no delivery by the deadline, a watchdog cancels both invoices and the buyer is refunded automatically.

**Critical protocol detail:** wallets/LND refuse to pay two invoices with the same hash. So:
- `paymentHash = sha256(code)`: seller hold invoice (goods)
- `riderPreimage = sha256(code ‖ utf8("gem-rider"))`, `riderHash = sha256(riderPreimage)`: rider hold invoice (delivery fee)
- One code unlocks both. Settle must verify BOTH hashes before settling ANY leg.

## Stack (keep it)
- Backend: Node 22, Express 4, ESM, no TypeScript, no DB (JSON file store). Dependencies: `express`, `nostr-tools`, `qrcode-generator`.
- Frontend: vanilla JS ES modules served by the backend; no framework, no build step; strict CSP (no inline JS or CSS; build the DOM with `textContent`).
- Lightning: LND v0.18 REST. `LN_BACKEND=mock` (in-memory, same state machine) or `lnd`.
- Infra: `docker-compose.yml` with bitcoind regtest + 3 LND nodes (buyer, seller, rider) + backend; `./start.sh` does everything, including funding and channels.

## LND REST calls used
- `POST /v2/invoices/hodl` `{hash(b64), value, memo, expiry, cltv_expiry}` with **invoice.macaroon**
- `GET /v1/invoice/{hash_hex}` → `state` OPEN | ACCEPTED | SETTLED | CANCELED
- `POST /v2/invoices/settle` `{preimage(b64)}` / `POST /v2/invoices/cancel` `{payment_hash(b64)}`
- `POST /v2/router/send` (stream; a hold payment stays IN_FLIGHT, so resolve on the first update) with **admin.macaroon**, demo buyer only
- `GET /v1/channels`: sum `pending_htlcs` for the locked amounts shown in the UI

## Order state machine
`AWAITING_LOCK → AWAITING_PAYMENT → PARTIAL → LOCKED → PAID`, any active state `→ REFUNDED` (seller cancel or deadline). Derive it from the invoice states on every read and in a 2 s watchdog.

## Judging criteria: every change must serve one
1. **Local impact:** WhatsApp link flow, NGN/XOF first, deposit-only mode, FR/Wolof copy.
2. **Security by design:** hash-only server, least-privilege macaroons, prices from the catalog (never from AI), input validation, rate limits, 8 wrong-code limit, no PII in logs, CSP, timing-safe token compare. Keep `docs/threat-model.md` current.
3. **UX on low bandwidth / mid-range phones:** big buttons, plain words ("Money locked: safe to deliver"), countdowns, audible/visual success, nothing over 50 KB.
4. **Working MVP:** `./start.sh` must work end to end; `npm test` (mock) and `test/lnd.integration.js` (real LND) must stay green.
5. **Pitch & docs:** README (setup, architecture diagram, constraints, metrics, next iteration) and `docs/pitch.md`.

## Rules for you
- Before editing, read `backend/src/orders.js`, `backend/src/lightning/lnd.js` and the tests.
- After every change run `cd backend && npm test`. If you touch Lightning code, run the integration test against regtest.
- Never store the buyer's code server-side before reveal. Never give the seller or rider node a macaroon that can send funds.
- Small, reviewable commits with clear messages.

## Next tasks (in priority order)
1. **French / Wolof toggle**: a tiny `i18n.js` dictionary for every user-facing string (EN, FR, WO); remember the choice in localStorage.
2. **Sound + vibration on "Paid"** for the rider (`navigator.vibrate`, short WebAudio beep).
3. **Inspect-at-door window**: the buyer taps "Package OK" before the QR appears; optional 5-minute timer.
4. **Bring-your-own-wallet**: let the seller/rider connect LNbits or NWC instead of server-held macaroons; keep the mock and LND backends behind the same interface (`createHoldInvoice`, `lookup`, `settle`, `cancel`).
5. **Offline rider**: cache the scanned code in IndexedDB and settle when back online; show "Paid ✓ (syncing)".
6. **Seller catalog editor** (CRUD on `seller.catalog`, validated prices).
7. Record the 3-minute demo video following `docs/pitch.md`.
