// Core escrow logic. The server NEVER sees the buyer's secret (preimage) until the buyer
// chooses to reveal it at the door. It only ever stores the payment hash.
import { HttpError, randomId, hashToken, safeEqual, sha256Hex, str, int, hex32 } from './validate.js';
import { demoCatalog } from './catalog.js';

export const STATUS = {
  AWAITING_LOCK: 'AWAITING_LOCK',       // order created, buyer hasn't opened/locked yet
  AWAITING_PAYMENT: 'AWAITING_PAYMENT', // hold invoices created, not paid
  PARTIAL: 'PARTIAL',                   // one of the two invoices paid
  LOCKED: 'LOCKED',                     // all funds locked on the network
  PAID: 'PAID',                         // secret revealed, seller + rider paid
  REFUNDED: 'REFUNDED',                 // canceled / expired, funds returned to buyer
};
const ACTIVE = new Set([STATUS.AWAITING_PAYMENT, STATUS.PARTIAL, STATUS.LOCKED]);
const MAX_SETTLE_ATTEMPTS = 8;
const RIDER_TAG_HEX = Buffer.from('gem-rider').toString('hex');

// One delivery code unlocks both payments. Wallets (and LND) refuse to pay two invoices with
// the same hash, so the rider's preimage is derived from the buyer's code:
//   sellerPreimage = code            -> paymentHash = sha256(code)
//   riderPreimage  = sha256(code || "gem-rider") -> riderHash = sha256(riderPreimage)
export const riderPreimageOf = (code) => sha256Hex(code + RIDER_TAG_HEX);
const hashFor = (o, role) => (role === 'rider' ? o.riderHash : o.paymentHash);
const preimageFor = (role, code) => (role === 'rider' ? riderPreimageOf(code) : code);

export function createOrders({ store, ln, config, nostr }) {
  const { state, save } = store;
  const toSats = (local, rate) => Math.max(1, Math.ceil((local / rate) * 1e8));

  // ---------- sellers ----------
  function createSeller(body) {
    const name = str(body.name, { name: 'Shop name', min: 2, max: 60, required: true });
    const id = randomId(6);
    const token = randomId(24);
    state.sellers[id] = {
      id,
      name,
      tokenHash: hashToken(token),
      catalog: demoCatalog(config.currency),
      createdAt: Date.now(),
    };
    save();
    return { sellerId: id, token, name };
  }

  function authSeller(sellerId, token) {
    const s = state.sellers[sellerId];
    if (!s || !token || !safeEqual(s.tokenHash, hashToken(token))) throw new HttpError(401, 'Not authorized for this shop');
    return s;
  }

  function publicSeller(sellerId) {
    const s = state.sellers[sellerId];
    if (!s) throw new HttpError(404, 'Shop not found');
    const orders = Object.values(state.orders).filter((o) => o.sellerId === sellerId);
    const reviews = orders.filter((o) => o.review).map((o) => ({
      stars: o.review.stars,
      text: o.review.text,
      at: o.review.at,
      paymentHash: o.paymentHash,
      preimage: o.review.event.tags.find((t) => t[0] === 'preimage')[1],
      eventId: o.review.event.id,
      signer: nostr.npub(o.review.event.pubkey),
      selfSigned: o.review.selfSigned,
    }));
    const delivered = orders.filter((o) => o.status === STATUS.PAID).length;
    const avg = reviews.length ? reviews.reduce((a, r) => a + r.stars, 0) / reviews.length : null;
    return { id: s.id, name: s.name, catalog: s.catalog, delivered, rating: avg, reviews: reviews.reverse() };
  }

  // ---------- orders ----------
  function createOrder(sellerId, token, body) {
    const seller = authSeller(sellerId, token);
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
    const items = [];
    for (const it of rawItems) {
      const cat = seller.catalog.find((c) => c.id === it.id);
      if (!cat) throw new HttpError(400, `Unknown item ${String(it.id).slice(0, 40)}`);
      items.push({ id: cat.id, name: cat.name, qty: int(it.qty, { name: 'Quantity', min: 1, max: 50 }), unitPrice: cat.price });
    }
    if (!items.length) throw new HttpError(400, 'Add at least one item');
    const mode = body.mode === 'deposit' ? 'deposit' : 'full';
    const deliveryFee = int(body.deliveryFee, { name: 'Delivery fee', min: 1, max: 1_000_000 });
    const subtotal = items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
    const rate = config.btcPriceLocal;
    const id = randomId(9);
    const order = {
      id,
      sellerId,
      sellerName: seller.name,
      items,
      mode, // full = goods + delivery locked; deposit = only delivery fee locked, goods paid cash
      deliveryArea: str(body.deliveryArea, { name: 'Delivery area', max: 60 }),
      buyerName: str(body.buyerName, { name: 'Buyer name', max: 40 }),
      riderName: str(body.riderName, { name: 'Rider name', max: 40 }) || 'Musa (demo rider)',
      currency: config.currency,
      rate,
      subtotal,
      deliveryFee,
      goodsSats: mode === 'full' ? toSats(subtotal, rate) : 0,
      feeSats: toSats(deliveryFee, rate),
      status: STATUS.AWAITING_LOCK,
      paymentHash: null,
      riderHash: null,
      invoices: {},
      createdAt: Date.now(),
      lockedAt: null,
      deadline: null,
      settledAt: null,
      refundReason: null,
      settleAttempts: 0,
      review: null,
    };
    state.orders[id] = order;
    save();
    return order;
  }

  function getOrder(id) {
    const o = state.orders[id];
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  }

  // What anyone with the link may see. No tokens, no internals.
  function publicOrder(o) {
    const { settleAttempts, ...rest } = o;
    return {
      ...rest,
      review: o.review ? { stars: o.review.stars, text: o.review.text, eventId: o.review.event.id } : null,
      now: Date.now(),
      sellerTrust: (() => {
        try {
          const p = publicSeller(o.sellerId);
          return { delivered: p.delivered, rating: p.rating, reviews: p.reviews.length };
        } catch { return null; }
      })(),
    };
  }

  function legs(o) {
    const l = [];
    if (o.goodsSats > 0) l.push({ role: 'seller', sats: o.goodsSats, memo: `Gem order ${o.id}: goods from ${o.sellerName}` });
    l.push({ role: 'rider', sats: o.feeSats, memo: `Gem order ${o.id}: delivery by ${o.riderName}` });
    return l;
  }

  // Buyer sends ONLY hashes derived from their secret code. Seller and rider nodes each create a
  // hold invoice; the one code revealed at the door pays both.
  async function lock(id, body) {
    const o = getOrder(id);
    const paymentHash = hex32(body.paymentHash, 'paymentHash');
    const riderHash = hex32(body.riderHash, 'riderHash');
    if (paymentHash === riderHash) throw new HttpError(400, 'Hashes must differ');
    if (o.status !== STATUS.AWAITING_LOCK) throw new HttpError(409, 'Order already has a payment lock');
    if (Object.values(state.orders).some((x) => [x.paymentHash, x.riderHash].some((h) => h === paymentHash || h === riderHash))) {
      throw new HttpError(409, 'Hash already used');
    }
    o.status = STATUS.AWAITING_PAYMENT; // reserve immediately to avoid double-lock races
    o.paymentHash = paymentHash;
    o.riderHash = riderHash;
    const expirySec = Math.max(1, Math.round(config.lockMinutes * 60));
    try {
      for (const leg of legs(o)) {
        const { bolt11 } = await ln.createHoldInvoice(leg.role, { hashHex: hashFor(o, leg.role), sats: leg.sats, memo: leg.memo, expirySec });
        o.invoices[leg.role] = { bolt11, sats: leg.sats, state: 'OPEN' };
      }
    } catch (e) {
      for (const role of Object.keys(o.invoices)) await ln.cancel(role, hashFor(o, role)).catch(() => {});
      o.status = STATUS.AWAITING_LOCK;
      o.paymentHash = null;
      o.riderHash = null;
      o.invoices = {};
      save();
      throw new HttpError(502, `Could not create invoices: ${e.message}`);
    }
    o.lockedAt = Date.now();
    o.deadline = o.lockedAt + expirySec * 1000;
    save();
    return o;
  }

  async function refresh(o) {
    if (!o.paymentHash || !ACTIVE.has(o.status)) return o;
    for (const role of Object.keys(o.invoices)) {
      try { o.invoices[role].state = await ln.lookup(role, hashFor(o, role)); } catch { /* keep last known */ }
    }
    const states = Object.values(o.invoices).map((i) => i.state);
    let next = o.status;
    if (states.some((s) => s === 'CANCELED')) next = STATUS.REFUNDED;
    else if (states.every((s) => s === 'SETTLED')) next = STATUS.PAID;
    else if (states.every((s) => s === 'ACCEPTED' || s === 'SETTLED')) next = STATUS.LOCKED;
    else if (states.some((s) => s === 'ACCEPTED')) next = STATUS.PARTIAL;
    else next = STATUS.AWAITING_PAYMENT;
    if (next === STATUS.REFUNDED && o.status !== STATUS.REFUNDED) {
      await cancelAll(o, o.refundReason || 'canceled');
      return o;
    }
    if (next !== o.status) { o.status = next; save(); }
    return o;
  }

  async function cancelAll(o, reason) {
    for (const role of Object.keys(o.invoices)) {
      if (o.invoices[role].state === 'SETTLED') continue;
      try { await ln.cancel(role, hashFor(o, role)); o.invoices[role].state = 'CANCELED'; } catch { /* retry by watchdog */ }
    }
    o.status = STATUS.REFUNDED;
    o.refundReason = reason;
    save();
  }

  // The secret itself is the authorization. No account needed for the rider.
  async function settle(id, body) {
    const o = getOrder(id);
    await refresh(o);
    if (o.status === STATUS.PAID) return o;
    if (o.settleAttempts >= MAX_SETTLE_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes for this order');
    const preimage = typeof body.preimage === 'string' ? body.preimage.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(preimage) || sha256Hex(preimage) !== o.paymentHash || sha256Hex(riderPreimageOf(preimage)) !== o.riderHash) {
      o.settleAttempts += 1;
      save();
      throw new HttpError(400, 'This delivery code does not match the order');
    }
    if (o.status !== STATUS.LOCKED) {
      throw new HttpError(409, o.status === STATUS.REFUNDED
        ? 'This order was refunded. Do not hand over the package.'
        : 'Payment is not fully locked yet. Do not hand over the package.');
    }
    const errors = [];
    for (const role of Object.keys(o.invoices)) {
      if (o.invoices[role].state === 'SETTLED') continue;
      try { await ln.settle(role, preimageFor(role, preimage)); o.invoices[role].state = 'SETTLED'; } catch (e) { errors.push(`${role}: ${e.message}`); }
    }
    if (errors.length) throw new HttpError(502, `Settlement incomplete: ${errors.join('; ')}`);
    o.status = STATUS.PAID;
    o.settledAt = Date.now();
    save();
    return o;
  }

  async function cancelBySeller(id, sellerId, token) {
    const o = getOrder(id);
    if (o.sellerId !== sellerId) throw new HttpError(403, 'Not your order');
    authSeller(sellerId, token);
    await refresh(o);
    if (o.status === STATUS.PAID) throw new HttpError(409, 'Already paid');
    if (o.status === STATUS.AWAITING_LOCK) { o.status = STATUS.REFUNDED; o.refundReason = 'canceled by seller'; save(); return o; }
    await cancelAll(o, 'canceled by seller');
    return o;
  }

  async function demoPay(id) {
    const o = getOrder(id);
    await refresh(o);
    if (![STATUS.AWAITING_PAYMENT, STATUS.PARTIAL].includes(o.status)) throw new HttpError(409, `Order is ${o.status}`);
    for (const inv of Object.values(o.invoices)) {
      if (inv.state === 'OPEN') await ln.demoPay(inv.bolt11);
    }
    // give LND a moment to register the HTLCs
    for (let i = 0; i < 20; i++) {
      await refresh(o);
      if (o.status === STATUS.LOCKED) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return o;
  }

  async function review(id, body) {
    const o = getOrder(id);
    if (o.status !== STATUS.PAID) throw new HttpError(409, 'You can review only after a completed delivery');
    if (o.review) throw new HttpError(409, 'Already reviewed');
    const stars = int(body.stars, { name: 'Stars', min: 1, max: 5 });
    const text = str(body.text, { name: 'Review', max: 280 });
    let ev;
    let selfSigned = false;
    if (body.signedEvent) {
      ev = body.signedEvent; // signed in the buyer's browser with their own Nostr key (NIP-07)
      selfSigned = true;
    } else {
      const preimage = hex32(String(body.preimage || '').toLowerCase(), 'preimage');
      ev = nostr.signAsNotary(nostr.buildTemplate({ order: o, sellerName: o.sellerName, stars, text, preimage }));
    }
    const err = nostr.verifyReview(ev, o);
    if (err) throw new HttpError(400, `Review rejected: ${err}`);
    o.review = { stars, text, at: Date.now(), event: ev, selfSigned };
    save();
    const relays = config.nostrRelays.length ? await nostr.publish(ev) : [];
    return { event: ev, relays };
  }

  function reviewTemplate(id, body) {
    const o = getOrder(id);
    const stars = int(body.stars, { name: 'Stars', min: 1, max: 5 });
    const text = str(body.text, { name: 'Review', max: 280 });
    const preimage = hex32(String(body.preimage || '').toLowerCase(), 'preimage');
    return nostr.buildTemplate({ order: o, sellerName: o.sellerName, stars, text, preimage });
  }

  // Watchdog: keeps statuses fresh and refunds anything past its deadline, well before the
  // HTLC's on-chain timeout, so channels never need to force-close.
  async function tick() {
    const now = Date.now();
    for (const o of Object.values(state.orders)) {
      if (!ACTIVE.has(o.status)) continue;
      try {
        await refresh(o);
        if (ACTIVE.has(o.status) && o.deadline && now > o.deadline) await cancelAll(o, 'expired: not delivered in time');
      } catch (e) {
        console.warn('[watchdog]', o.id, e.message);
      }
    }
  }

  function sellerOrders(sellerId, token) {
    authSeller(sellerId, token);
    return Object.values(state.orders).filter((o) => o.sellerId === sellerId).sort((a, b) => b.createdAt - a.createdAt).map(publicOrder);
  }

  function riderOrders() {
    return Object.values(state.orders)
      .filter((o) => ACTIVE.has(o.status) || (o.status === STATUS.PAID && Date.now() - o.settledAt < 6 * 3600_000))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        id: o.id, status: o.status, sellerName: o.sellerName, deliveryArea: o.deliveryArea, buyerName: o.buyerName,
        riderName: o.riderName, deliveryFee: o.deliveryFee, feeSats: o.feeSats, currency: o.currency,
        itemsCount: o.items.reduce((a, i) => a + i.qty, 0), deadline: o.deadline, now: Date.now(),
      }));
  }

  return {
    createSeller, publicSeller, createOrder, getOrder, publicOrder, lock, refresh, settle,
    cancelBySeller, demoPay, review, reviewTemplate, tick, sellerOrders, riderOrders, authSeller,
  };
}
