// Rider page. The rider needs no account: the buyer's secret code IS the authorization.
import { $, h, api, money, sats, badge, toast, poll } from './common.js';

const root = $('#root');
let scanning = null; // { orderId, stream, timer }

function stopScan() {
  if (!scanning) return;
  clearInterval(scanning.timer);
  scanning.stream?.getTracks().forEach((t) => t.stop());
  scanning = null;
}

async function settle(o, code, out) {
  const preimage = code.trim().toLowerCase().replace(/^lightning:/, '');
  try {
    const r = await api('POST', `/api/orders/${o.id}/settle`, { preimage });
    stopScan();
    out.replaceChildren(h('div', { class: 'big-status st-ok' },
      h('div', { class: 'icon' }, '✅'),
      h('div', { class: 'title' }, 'Paid! Hand over the package.'),
      h('p', {}, `You earned ${money(r.deliveryFee, r.currency)} (${sats(r.feeSats)}). The seller was paid at the same moment.`)));
    toast('Payment released', 'ok');
    setTimeout(refresh, 2500);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openScanner(o, card) {
  stopScan();
  const out = h('div', { class: 'stack' });
  const video = h('video', { class: 'scan', playsinline: true, muted: true });
  const input = h('input', { placeholder: 'Or paste / type the code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const go = h('button', {}, 'Confirm code');
  go.addEventListener('click', () => settle(o, input.value, out));
  const close = h('button', { class: 'secondary' }, 'Close');
  close.addEventListener('click', () => { stopScan(); refresh(); });
  out.append(video, input, go, close);
  card.append(out);

  if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((stream) => {
      video.srcObject = stream;
      video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      scanning = { orderId: o.id, stream, timer: setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) { clearInterval(scanning.timer); settle(o, codes[0].rawValue, out); }
        } catch { /* frame not ready */ }
      }, 400) };
    }).catch(() => { video.remove(); toast('Camera unavailable: type or paste the code', 'error'); });
  } else {
    video.remove();
    scanning = { orderId: o.id };
  }
}

async function refresh() {
  if (scanning) return; // don't redraw under the camera
  const list = await api('GET', '/api/rider/orders');
  if (!list.length) {
    root.replaceChildren(h('h1', {}, '🛵 Deliveries'), h('p', { class: 'muted' }, 'No deliveries right now.'));
    return;
  }
  root.replaceChildren(h('h1', {}, '🛵 Deliveries'), ...list.map((o) => {
    const card = h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', {}, `${o.deliveryArea || 'Delivery'}${o.buyerName ? ` · ${o.buyerName}` : ''}`), badge(o.status)),
      h('p', { class: 'small muted' }, `${o.itemsCount} item(s) from ${o.sellerName}`),
      h('p', {}, 'Your fee: ', h('b', {}, money(o.deliveryFee, o.currency)), h('span', { class: 'sats' }, ` · ${sats(o.feeSats)}`)),
    );
    if (o.status === 'LOCKED') {
      const b = h('button', {}, '📷 Scan delivery code');
      b.addEventListener('click', () => { b.remove(); openScanner(o, card); });
      card.append(h('p', { class: 'small' }, '✅ Money is locked. Safe to deliver.'), b);
    } else if (o.status === 'PAID') {
      card.append(h('p', { class: 'small' }, '✅ Done. You were paid.'));
    } else {
      card.append(h('p', { class: 'small', }, '⛔ Not paid yet. Do NOT go / hand over the package.'));
    }
    return card;
  }));
}

poll(refresh, 3000);
