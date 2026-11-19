# Gëm threat model

## Assets
1. Buyer funds while locked
2. The buyer's secret delivery code (preimage)
3. Seller/rider earnings
4. Seller reputation (reviews)
5. Personal data: buyer name, delivery area

## Design principles
- **No custody.** Funds sit in HTLCs on Lightning channels. Gëm never holds a balance it could lose or freeze.
- **Hash-only server.** The server receives `sha256(code)` and a derived hash. It sees the code only when the buyer reveals it at delivery, and by then revealing it *is* the payment.
- **The secret is the authorization.** The rider needs no account: possession of the code proves the buyer released payment.
- **Least privilege.** Seller and rider nodes are driven with `invoice.macaroon` (create/settle/cancel invoices, **cannot send funds**). Balances use `readonly.macaroon`. Only the *demo buyer wallet* uses `admin.macaroon`.
- **Prices from the catalog, never from AI.** The model only picks item IDs and quantities; output is schema-checked.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Seller takes money and never ships | Seller can't settle without the code. Deadline → watchdog cancels → automatic refund. |
| Buyer receives goods and refuses to pay | Rider hands over only after the code scans successfully. The settle endpoint returns `409` unless **all** legs are locked, and the UI says "Do NOT hand over". |
| Fake orders | Rider only rides when the status is LOCKED (funds provably committed). Deposit mode covers cash buyers. |
| Rider robbed of cash | Rider carries no cash. Stealing the rider's phone yields nothing: no keys on it. |
| Brute-forcing the code | 256-bit secret; per-order limit of 8 wrong attempts; per-IP rate limits. |
| Server compromise | Attacker gets hashes and invoice macaroons: can create or cancel invoices (cancel = buyer refunded) but **cannot move funds out**. |
| Malicious buyer sends an unrelated rider hash | Settle checks *both* hashes before settling anything. A mismatched code is rejected and the package is not handed over. |
| Two invoices with one hash | Avoided by design (wallets reject duplicate hashes); the rider preimage is derived. |
| HTLC timeout / force close | App deadline (default 60 min) ≪ HTLC CLTV (144 blocks). The watchdog cancels early. |
| Server crash with HTLCs held | State persisted to disk; the watchdog resumes on restart. Worst case LND auto-cancels near CLTV expiry and the buyer is refunded. |
| Fake reviews | A review must carry a preimage matching the order's payment hash, and the order must be PAID. Verifiable by anyone, in the browser. |
| XSS / injection | No `innerHTML`; DOM built with `textContent`. Strict CSP (`script-src 'self'`, no inline). Input length and charset validation. JSON body ≤ 16 KB. |
| Seller impersonation | Seller actions need a 192-bit token kept on the device; only its SHA-256 is stored; timing-safe compare. |
| PII leakage | Logs contain method, route and status only: no bodies, names, areas, codes or IPs. `Referrer-Policy: no-referrer`. |
| Losing the buyer's phone | The code lives in localStorage. If it's lost, nobody can claim the funds and they **refund at the deadline**. |

## Known demo shortcuts (documented, not hidden)
- One server drives all three nodes; production = each party's own wallet/node.
- The backend container runs as root to read LND's root-owned credential volumes (read-only mounts).
- No TLS on the app itself in local dev; deploy behind HTTPS (the camera and `crypto.subtle` require it; a SHA-256 fallback is included).
