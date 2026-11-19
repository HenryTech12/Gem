# 3-minute pitch: Gëm

**0:00 – Problem (30 s)**
"Tolu orders an Ankara dress on Instagram. She won't pay first: last time the seller vanished. So it's cash on delivery. The rider crosses Lagos for an hour. Tolu changed her mind; no one answers. The seller loses the delivery fee. Riders carry cash all day and get robbed. Across Africa, social commerce runs on zero trust."

**0:30 – Why existing fixes fail (15 s)**
"Mobile money can't hold a payment. An escrow company can, but then you trust *them*, they need a license, and they can freeze your money."

**0:45 – Solution (20 s)**
"Gëm locks the payment **on the Lightning network itself**. Nobody holds it, not us and not the seller. One secret code on the buyer's phone releases it at the door. No delivery? It refunds itself."

**1:05 – Live demo (75 s)** — on the live link, real LND nodes (home page says "regtest LND")
1. Seller pastes the WhatsApp message → order read → link sent on WhatsApp.
2. Buyer locks the payment → home screen shows 🔒 sats locked on the seller and rider nodes.
3. Rider sees "Money locked: safe to deliver". Buyer taps "The rider is here", checks the package, taps
   "Package OK" → QR appears → rider scans → beep + vibration → **seller and rider paid in the same second**.
4. Second order → seller presses refund (or the deadline passes) → buyer's sats are back.
5. Buyer's review → "Verify proof" → ✅ the review is mathematically tied to a real delivery.
6. Tap **FR** / **WO** in the header: the whole app switches to French or Wolof.

**2:20 – Security (20 s)**
"The server only ever sees hashes. Seller and rider nodes use invoice-only permissions: even if we're hacked, nobody can move money out. A stolen rider phone holds nothing."

**2:40 – Impact & next (20 s)**
"Every cash-on-delivery order is a user: sellers, riders, buyers. Next: each party brings their own wallet over NWC, an offline mode for riders, cross-border orders between Lagos and Dakar. **No cash, no fake orders, no scams, and no one holding your money.**"
