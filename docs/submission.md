# Submission text: Gëm

Copy each section into the matching field of the submission form.

---

## Links

- **Live demo (real LND nodes, regtest):** https://gem-lnd.onrender.com
- **Backup (same app, simulated Lightning):** https://gem-ugoa.onrender.com
- **Code:** https://github.com/HenryTech12/Gem
- **Demo video:** https://youtu.be/yeDw0UkqjQc

## Tagline

Pay on delivery without cash: the buyer's money is locked on Lightning until the package arrives. No one holds it.

## Inspiration

Instagram and WhatsApp shopping in Lagos and Dakar runs on cash on delivery, because nobody trusts anybody. Buyers won't
pay first because some sellers disappear with the money. Sellers lose delivery fees on fake orders. Riders carry cash
all day and get robbed. The usual fix is an escrow company, but then everyone has to trust that company, it needs a
licence, and it can freeze the money.

Lightning hold invoices make a third option possible: the money is locked by the network itself, and only a secret on
the buyer's phone can release it. *Gëm* means "to trust" in Wolof.

## What it does

1. **The seller** pastes the customer's WhatsApp message. Gëm reads the order (AI on Groq, or a built-in parser
   offline), prices it from the seller's own catalog, and creates a payment link to send on WhatsApp.
2. **The buyer** opens the link. Their phone creates a secret delivery code; only its hashes leave the phone. They pay,
   and the money is **locked** in HTLCs: the seller and rider can see it but cannot take it.
3. **The rider** sees "Money locked: safe to deliver", so no more fake orders.
4. **At the door** the buyer taps "The rider is here", opens and checks the package (checklist and a 5-minute guide
   timer), then taps "Package OK". Only then does the QR appear. The rider scans it and **the seller and rider are paid
   in the same second**, with a beep and vibration on the rider's phone.
5. **No delivery before the deadline?** A watchdog cancels both invoices and the buyer is **refunded automatically**.
   If the package is wrong, the buyer simply doesn't show the code.
6. **Verified reviews:** a review carries the payment secret, so anyone can check in their browser that
   `sha256(secret) = payment hash`. A review can't exist without a real, completed delivery. Reviews are Nostr events.

Built for the people using it: naira and CFA franc amounts first (sats in small type), a "delivery fee only" mode for
buyers who still pay goods in cash, and the whole interface in **English, French and Wolof**.

## How we built it

- **Lightning:** LND v0.18 over REST. Seller and rider each get a **hold invoice**. Wallets refuse to pay two invoices
  with the same hash, so the rider's preimage is derived from the buyer's code (`sha256(code ‖ "gem-rider")`). One code
  unlocks both, and the server checks **both** hashes before settling either.
- **Backend:** Node 22 + Express, no database (JSON file), an order state machine derived from the invoice states on
  every read and by a 2-second watchdog.
- **Frontend:** vanilla JavaScript, no framework or build step, strict Content-Security-Policy, nothing over 50 KB, big
  buttons and plain words for mid-range Android phones on slow networks.
- **Infrastructure:** bitcoind (regtest) and three LND nodes (buyer, seller, rider). For the live demo they run with the
  app in one container on Render, with a persistent disk; `./start.sh` runs the same stack locally with Docker.
- **Tests:** 15 automated tests (escrow flow, security limits, catalog, translations, AI parsing), plus an integration
  test that runs lock → settle and lock → expire → refund on the real LND nodes.

## Security by design

- The server only ever sees **hashes**; the secret stays on the buyer's phone until they choose to show it.
- Seller and rider nodes use **invoice-only macaroons**: even a full server compromise can't move their funds out.
  (The built-in demo buyer wallet is the one exception, so judges can pay without their own wallet; in production
  buyers pay from their own wallets.)
- **Prices come only from the seller's catalog**, never from the AI. The model can only pick item IDs and quantities.
- Rate limits, a limit of 8 wrong codes per order, input validation, timing-safe token checks, no personal data in
  logs, strict CSP. Full threat model in `docs/threat-model.md`.

## Challenges we ran into

- **Two payments, one code.** Wallets reject duplicate payment hashes, so we derive the rider's secret from the
  buyer's code and verify both before settling anything.
- **Running real Lightning nodes on a hosting platform.** Getting bitcoind and three LND nodes to survive restarts,
  slow first boots and interrupted wallet creation inside one container took clean shutdown handling and automatic
  self-repair.
- **Translating trust.** Words like "locked", "refund" and "hold" had to be plain and reassuring in three languages.

## Accomplishments we're proud of

- A working end-to-end escrow on real LND nodes: lock, inspect, settle, automatic refund.
- Nobody, including us, can take the buyer's money.
- Reviews that are mathematically impossible to fake.

## What we learned

Hold invoices are an underused Lightning primitive that maps almost perfectly onto cash on delivery, and the hard part
of a payments product in Lagos or Dakar is as much the words on the screen as the cryptography.

## What's next

- Each party brings their own wallet (NWC / LNbits), so no server-held node credentials.
- Offline rider mode: scan now, settle when back online.
- Cross-border orders (Lagos seller → Dakar buyer) and group buys.
- A pilot with a handful of Instagram sellers and riders.

## Built with

Bitcoin, Lightning Network, LND, hold invoices, Node.js, Express, JavaScript, Nostr, Groq, Docker, Render
