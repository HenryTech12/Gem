// Buyer page. The secret (preimage) is generated HERE and never leaves this phone until the
// buyer chooses to show it to the rider at the door.
import { $, h, api, money, sats, countdown, qr, copy, toast, store, poll, newSecret, sha256Hex, t, tx, unlockAudio, celebrate } from './common.js';

const root = $('#root');
const id = location.pathname.split('/').pop();
const secretKey = `gem:secret:${id}`;
const RIDER_TAG_HEX = [...new TextEncoder().encode('gem-rider')].map((b) => b.toString(16).padStart(2, '0')).join('');
let order;
// Door flow: 'wait' -> 'inspect' (buyer checks the package, 5-minute guide timer) -> 'code' (QR shown)
//                     \-> 'problem' (do not show the code; refund paths)
let stage = 'wait';
let inspectEnd = 0;
const INSPECT_MS = 5 * 60_000;
let lastStatus = null;
let lastRender = '';

function bigStatus(kind, icon, title, sub) {
  return h('div', { class: `big-status st-${kind}` }, h('div', { class: 'icon' }, icon), h('div', { class: 'title' }, title), sub ? h('p', {}, sub) : null);
}

function summary(o) {
  const cur = o.currency;
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, o.sellerName), h('a', { href: `/s/${o.sellerId}`, class: 'small' }, t('order.reviews'))),
    o.sellerTrust ? h('p', { class: 'small muted' },
      t(o.sellerTrust.delivered === 1 ? 'trust.one' : 'trust.many', { n: o.sellerTrust.delivered }),
      o.sellerTrust.rating ? ` · ★ ${o.sellerTrust.rating.toFixed(1)}` : '') : null,
    h('table', { class: 'items' },
      ...o.items.map((i) => h('tr', {}, h('td', {}, `${i.qty}× ${i.name}`), h('td', {}, money(i.qty * i.unitPrice, cur)))),
      h('tr', {}, h('td', {}, o.deliveryArea ? t('order.delivery.to', { area: o.deliveryArea, rider: o.riderName }) : t('order.delivery', { rider: o.riderName })), h('td', {}, money(o.deliveryFee, cur))),
      h('tr', { class: 'total' }, h('td', {}, t('total')), h('td', {}, money(o.subtotal + o.deliveryFee, cur))),
    ),
    o.mode === 'deposit'
      ? h('p', { class: 'small muted' }, t('order.deposit', { sats: sats(o.feeSats), goods: money(o.subtotal, cur) }))
      : h('p', { class: 'sats' }, t('order.rate', { sats: sats(o.goodsSats + o.feeSats), rate: money(o.rate, cur) })),
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
  btn.textContent = t('order.paying');
  try {
    order = await api('POST', `/api/orders/${id}/demo-pay`);
    render(true);
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = t('order.demopay'); }
}

function invoiceBlock(role, inv) {
  if (inv.state !== 'OPEN') return h('p', {}, t(role === 'seller' ? 'inv.goods.locked' : 'inv.fee.locked', { sats: sats(inv.sats) }));
  const c = h('button', { class: 'small secondary' }, t('inv.copy'));
  c.addEventListener('click', () => copy(inv.bolt11, c));
  return h('div', { class: 'card' },
    h('h3', {}, t(role === 'seller' ? 'inv.goods' : 'inv.fee', { sats: sats(inv.sats) })),
    h('a', { href: `lightning:${inv.bolt11}`, 'aria-label': t('inv.open') }, qr(`lightning:${inv.bolt11}`.toUpperCase(), 4)),
    h('div', { class: 'row' }, c, h('a', { class: 'btn small secondary', href: `lightning:${inv.bolt11}` }, t('inv.open'))),
  );
}

function reviewForm() {
  let stars = 5;
  const starRow = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': t('review.rating') });
  const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const b = h('button', { class: n <= stars ? 'on' : '', 'aria-label': t('review.stars', { n }) }, '★');
    b.addEventListener('click', () => { stars = n; drawStars(); });
    return b;
  }));
  drawStars();
  const text = h('textarea', { maxlength: 280, placeholder: t('review.placeholder'), 'aria-label': t('review.placeholder') });
  const send = h('button', {}, t('review.publish'));
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
      toast(t('review.thanks'), 'ok');
      order = await api('GET', `/api/orders/${id}`);
      render(true);
    } catch (e) { toast(e.message, 'error'); send.disabled = false; }
  });
  return h('div', { class: 'card' },
    h('h2', {}, t('review.title')),
    h('p', { class: 'small muted' }, t('review.sub')),
    starRow, text, h('p'), send);
}

// The buyer opens and checks the package BEFORE the code appears. Showing the code is final.
function doorCard(secret) {
  const go = (next) => { stage = next; render(true); };
  if (stage === 'wait') {
    const b = h('button', {}, t('door.arrived'));
    b.addEventListener('click', () => { unlockAudio(); inspectEnd = Date.now() + INSPECT_MS; go('inspect'); });
    return h('div', { class: 'card' }, h('h2', {}, t('door.title')), h('p', {}, t('door.sub')), b);
  }
  if (stage === 'inspect') {
    const ok = h('button', {}, t('door.ok'));
    ok.addEventListener('click', () => { unlockAudio(); go('code'); });
    const bad = h('button', { class: 'secondary' }, t('door.problem'));
    bad.addEventListener('click', () => go('problem'));
    return h('div', { class: 'card' },
      h('h2', {}, t('door.inspect.title')),
      h('ul', { class: 'steps' }, h('li', {}, t('door.check1')), h('li', {}, t('door.check2')), h('li', {}, t('door.check3'))),
      h('p', { class: 'inspect-timer' }, t('door.timer'), ' ', h('b', { id: 'icd' }, inspectLeft())),
      h('p', { class: 'small muted' }, t('door.inspect.sub')),
      h('div', { class: 'stack' }, ok, bad));
  }
  if (stage === 'problem') {
    const back = h('button', { class: 'secondary' }, t('door.back'));
    back.addEventListener('click', () => go('inspect'));
    return h('div', { class: 'card' },
      h('h2', {}, t('door.problem.title')),
      h('p', {}, ...tx('door.problem.sub')),
      h('ul', { class: 'steps' }, h('li', {}, t('door.problem1')), h('li', {}, t('door.problem2'))),
      back);
  }
  const hide = h('button', { class: 'secondary' }, t('door.hide'));
  hide.addEventListener('click', () => go('inspect'));
  const c = h('button', { class: 'small secondary' }, t('door.copy'));
  c.addEventListener('click', () => copy(secret, c));
  return h('div', { class: 'card center' },
    h('h2', {}, t('door.code.title')),
    qr(secret, 7),
    h('p', { class: 'code' }, secret),
    h('div', { class: 'stack' }, c, hide));
}

function inspectLeft() {
  const ms = Math.max(0, inspectEnd - Date.now());
  if (!ms) return t('door.timeup');
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render(force = false) {
  const o = order;
  const secret = store.get(secretKey);
  const key = JSON.stringify([o.status, Object.values(o.invoices || {}).map((i) => i.state), stage, !!o.review, !!secret]);
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
      const btn = h('button', {}, t('order.lock', { amount: lockedAmount }));
      btn.addEventListener('click', () => lock(btn));
      parts.push(
        h('h1', {}, t('order.ready')),
        summary(o),
        h('div', { class: 'card' },
          h('h2', {}, t('order.how')),
          h('ol', { class: 'steps' },
            h('li', {}, t('order.how1')),
            h('li', {}, t('order.how2', { seller: o.sellerName })),
            h('li', {}, t('order.how3')),
            h('li', {}, t('order.how4')),
          ),
          btn,
        ),
      );
      break;
    }
    case 'AWAITING_PAYMENT':
    case 'PARTIAL': {
      const pay = h('button', {}, t('order.demopay'));
      pay.addEventListener('click', () => demoPay(pay));
      parts.push(
        bigStatus('muted', '💳', t('order.pay.title'), h('span', {}, t('order.pay.expires'), ' ', h('b', { id: 'cd' }, countdown(o.deadline, o.now)))),
        summary(o),
        h('div', { class: 'card' }, h('p', { class: 'small muted' }, t('order.demopay.sub')), pay),
        // Regtest invoices (lnbcrt…) can't be paid by real wallets: show their status instead of wallet buttons.
        ...(Object.values(o.invoices).some((i) => i.bolt11.startsWith('lnbcrt'))
          ? [h('div', { class: 'card' },
              h('p', { class: 'small muted' }, t('order.regtest')),
              ...Object.entries(o.invoices).map(([role, inv]) => h('p', {}, inv.state === 'OPEN'
                ? t(role === 'seller' ? 'inv.goods' : 'inv.fee', { sats: sats(inv.sats) })
                : t(role === 'seller' ? 'inv.goods.locked' : 'inv.fee.locked', { sats: sats(inv.sats) }))))]
          : [h('p', { class: 'muted center' }, t('order.anywallet')), ...Object.entries(o.invoices).map(([role, inv]) => invoiceBlock(role, inv))]),
      );
      break;
    }
    case 'LOCKED': {
      parts.push(bigStatus('lock', '🔒', t('order.locked.title', { amount: lockedAmount }), h('span', {}, t('order.locked.sub', { seller: o.sellerName }), ' ', h('b', { id: 'cd' }, countdown(o.deadline, o.now)))));
      if (!secret) {
        parts.push(h('div', { class: 'card' }, h('p', {}, t('order.nosecret'))));
      } else {
        parts.push(doorCard(secret));
      }
      parts.push(summary(o));
      break;
    }
    case 'PAID':
      parts.push(bigStatus('ok', '✅', t('order.paid.title'), t('order.paid.sub', { seller: o.sellerName, rider: o.riderName })));
      if (!o.review && secret) parts.push(reviewForm());
      if (o.review) parts.push(h('div', { class: 'card' }, h('p', {}, t('review.yours', { stars: '★'.repeat(o.review.stars), text: o.review.text }))));
      parts.push(summary(o));
      break;
    case 'REFUNDED':
      parts.push(bigStatus('bad', '↩️', t('order.refunded.title'), t('order.refunded.sub', { reason: o.refundReason || 'canceled' })), summary(o));
      break;
    default:
      parts.push(summary(o));
  }
  root.replaceChildren(...parts);
}

async function load() {
  order = await api('GET', `/api/orders/${id}`);
  if (lastStatus === 'LOCKED' && order.status === 'PAID') celebrate();
  lastStatus = order.status;
  render();
}

load().then(() => poll(load, 2500)).catch((e) => root.replaceChildren(h('p', {}, e.message)));
setInterval(() => {
  const cd = $('#cd');
  if (cd && order?.deadline) cd.textContent = countdown(order.deadline, order.now);
  const icd = $('#icd');
  if (icd) icd.textContent = inspectLeft();
}, 1000);
