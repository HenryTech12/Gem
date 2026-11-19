// Buyer page. The secret (preimage) is generated HERE and never leaves this phone until the
// buyer chooses to show it to the rider at the door.
import { $, h, api, money, sats, countdown, qr, copy, toast, store, poll, newSecret, sha256Hex } from './common.js';

const root = $('#root');
const id = location.pathname.split('/').pop();
const secretKey = `gem:secret:${id}`;
const RIDER_TAG_HEX = [...new TextEncoder().encode('gem-rider')].map((b) => b.toString(16).padStart(2, '0')).join('');
let order;
let showCode = false;
let lastRender = '';

function bigStatus(kind, icon, title, sub) {
  return h('div', { class: `big-status st-${kind}` }, h('div', { class: 'icon' }, icon), h('div', { class: 'title' }, title), sub ? h('p', {}, sub) : null);
}

function summary(o) {
  const cur = o.currency;
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, o.sellerName), h('a', { href: `/s/${o.sellerId}`, class: 'small' }, 'Shop reviews')),
    o.sellerTrust ? h('p', { class: 'small muted' },
      `✅ ${o.sellerTrust.delivered} verified ${o.sellerTrust.delivered === 1 ? 'delivery' : 'deliveries'}`,
      o.sellerTrust.rating ? ` · ★ ${o.sellerTrust.rating.toFixed(1)}` : '') : null,
    h('table', { class: 'items' },
      ...o.items.map((i) => h('tr', {}, h('td', {}, `${i.qty}× ${i.name}`), h('td', {}, money(i.qty * i.unitPrice, cur)))),
      h('tr', {}, h('td', {}, `🛵 Delivery${o.deliveryArea ? ` to ${o.deliveryArea}` : ''} (${o.riderName})`), h('td', {}, money(o.deliveryFee, cur))),
      h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', {}, money(o.subtotal + o.deliveryFee, cur))),
    ),
    o.mode === 'deposit'
      ? h('p', { class: 'small muted' }, `You lock only the delivery fee now (${sats(o.feeSats)}). Pay ${money(o.subtotal, cur)} for the goods in cash at the door.`)
      : h('p', { class: 'sats' }, `${sats(o.goodsSats + o.feeSats)} · rate locked at 1 BTC = ${money(o.rate, cur)}`),
  );
}

async function lock(btn) {
  btn.disabled = true;
  try {
    let secret = store.get(secretKey);
    if (!secret) { secret = newSecret(); store.set(secretKey, secret); }
    // Only hashes leave the phone. Rider's secret is derived from the same code.
    const paymentHash = await sha256Hex(secret);
    const riderPreimage = await sha256Hex(secret + RIDER_TAG_HEX);
    const riderHash = await sha256Hex(riderPreimage);
    order = await api('POST', `/api/orders/${id}/lock`, { paymentHash, riderHash });
    render(true);
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
}

async function demoPay(btn) {
  btn.disabled = true;
  btn.textContent = 'Paying…';
  try {
    order = await api('POST', `/api/orders/${id}/demo-pay`);
    render(true);
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = '⚡ Pay with demo wallet'; }
}

function invoiceBlock(role, inv) {
  if (inv.state !== 'OPEN') return h('p', {}, `✅ ${role === 'seller' ? 'Goods' : 'Delivery'} payment locked (${sats(inv.sats)})`);
  const c = h('button', { class: 'small secondary' }, 'Copy invoice');
  c.addEventListener('click', () => copy(inv.bolt11, c));
  return h('div', { class: 'card' },
    h('h3', {}, `${role === 'seller' ? '🛍️ Goods' : '🛵 Delivery'}: ${sats(inv.sats)}`),
    h('a', { href: `lightning:${inv.bolt11}`, 'aria-label': 'Open in wallet' }, qr(`lightning:${inv.bolt11}`.toUpperCase(), 4)),
    h('div', { class: 'row' }, c, h('a', { class: 'btn small secondary', href: `lightning:${inv.bolt11}` }, 'Open wallet')),
  );
}

function reviewForm() {
  let stars = 5;
  const starRow = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Rating' });
  const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const b = h('button', { class: n <= stars ? 'on' : '', 'aria-label': `${n} stars` }, '★');
    b.addEventListener('click', () => { stars = n; drawStars(); });
    return b;
  }));
  drawStars();
  const text = h('textarea', { maxlength: 280, placeholder: 'How was the seller and the delivery?' });
  const send = h('button', {}, 'Publish verified review');
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const preimage = store.get(secretKey);
      const body = { stars, text: text.value, preimage };
      if (window.nostr?.signEvent) {
        // Buyer signs with their own Nostr key (NIP-07 browser extension)
        const tpl = await api('POST', `/api/orders/${id}/review-template`, body);
        body.signedEvent = await window.nostr.signEvent(tpl);
      }
      await api('POST', `/api/orders/${id}/review`, body);
      toast('Thank you! Your review is verified by your payment.', 'ok');
      order = await api('GET', `/api/orders/${id}`);
      render(true);
    } catch (e) { toast(e.message, 'error'); send.disabled = false; }
  });
  return h('div', { class: 'card' },
    h('h2', {}, 'Rate this seller'),
    h('p', { class: 'small muted' }, 'Your review includes proof that you really paid and received this order. Fake reviews are impossible.'),
    starRow, text, h('p'), send);
}

function render(force = false) {
  const o = order;
  const secret = store.get(secretKey);
  const key = JSON.stringify([o.status, Object.values(o.invoices || {}).map((i) => i.state), showCode, !!o.review, !!secret]);
  if (!force && key === lastRender) {
    const cd = $('#cd');
    if (cd && o.deadline) cd.textContent = countdown(o.deadline, o.now);
    return;
  }
  lastRender = key;
  const cur = o.currency;
  const lockedAmount = money(o.mode === 'full' ? o.subtotal + o.deliveryFee : o.deliveryFee, cur);
  const parts = [];

  switch (o.status) {
    case 'AWAITING_LOCK': {
      const btn = h('button', {}, `🔒 Lock ${lockedAmount} safely`);
      btn.addEventListener('click', () => lock(btn));
      parts.push(
        h('h1', {}, 'Your order is ready'),
        summary(o),
        h('div', { class: 'card' },
          h('h2', {}, 'How your money is protected'),
          h('ol', { class: 'steps' },
            h('li', {}, 'Your phone creates a secret delivery code.'),
            h('li', {}, `You pay. The money is locked: ${o.sellerName} cannot take it yet.`),
            h('li', {}, 'You show the code only when you have your package.'),
            h('li', {}, 'No package before the deadline? Your money comes back automatically.'),
          ),
          btn,
        ),
      );
      break;
    }
    case 'AWAITING_PAYMENT':
    case 'PARTIAL': {
      const pay = h('button', {}, '⚡ Pay with demo wallet');
      pay.addEventListener('click', () => demoPay(pay));
      parts.push(
        bigStatus('muted', '💳', 'Pay to lock your money', h('span', {}, 'Link expires in ', h('b', { id: 'cd' }, countdown(o.deadline, o.now)))),
        summary(o),
        h('div', { class: 'card' }, h('p', { class: 'small muted' }, 'Hackathon demo: pay from the built-in regtest buyer wallet.'), pay),
        h('p', { class: 'muted center' }, '— or scan with any Lightning wallet —'),
        ...Object.entries(o.invoices).map(([role, inv]) => invoiceBlock(role, inv)),
      );
      break;
    }
    case 'LOCKED': {
      parts.push(bigStatus('lock', '🔒', `${lockedAmount} locked`, h('span', {}, `${o.sellerName} can see your payment but cannot take it. Automatic refund in `, h('b', { id: 'cd' }, countdown(o.deadline, o.now)), ' if not delivered.')));
      if (!secret) {
        parts.push(h('div', { class: 'card' }, h('p', {}, '⚠️ The delivery code is on the phone that locked this payment. Open this link on that phone.')));
      } else if (!showCode) {
        const b = h('button', {}, '📦 I have my package: show my code');
        b.addEventListener('click', () => { showCode = true; render(true); });
        parts.push(h('div', { class: 'card' },
          h('h2', {}, 'When the rider arrives'),
          h('p', {}, 'Check your package first. Then show your code. Showing the code releases the payment.'),
          b));
      } else {
        const hide = h('button', { class: 'secondary' }, 'Hide code');
        hide.addEventListener('click', () => { showCode = false; render(true); });
        const c = h('button', { class: 'small secondary' }, 'Copy code');
        c.addEventListener('click', () => copy(secret, c));
        parts.push(h('div', { class: 'card center' },
          h('h2', {}, 'Delivery code: let the rider scan'),
          qr(secret, 7),
          h('p', { class: 'code' }, secret),
          h('div', { class: 'stack' }, c, hide)));
      }
      parts.push(summary(o));
      break;
    }
    case 'PAID':
      parts.push(bigStatus('ok', '✅', 'Delivered & paid', `${o.sellerName} and ${o.riderName} were paid the moment your code was scanned.`));
      if (!o.review && secret) parts.push(reviewForm());
      if (o.review) parts.push(h('div', { class: 'card' }, h('p', {}, `Your review: ${'★'.repeat(o.review.stars)} “${o.review.text}”`)));
      parts.push(summary(o));
      break;
    case 'REFUNDED':
      parts.push(bigStatus('bad', '↩️', 'Refunded', `Reason: ${o.refundReason || 'canceled'}. Any locked money is back in your wallet.`), summary(o));
      break;
    default:
      parts.push(summary(o));
  }
  root.replaceChildren(...parts);
}

async function load() {
  order = await api('GET', `/api/orders/${id}`);
  render();
}

load().then(() => poll(load, 2500)).catch((e) => root.replaceChildren(h('p', {}, e.message)));
setInterval(() => { const cd = $('#cd'); if (cd && order?.deadline) cd.textContent = countdown(order.deadline, order.now); }, 1000);
