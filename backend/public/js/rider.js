// Rider page. The rider needs no account: the buyer's secret code IS the authorization.
import { $, h, api, money, sats, badge, toast, poll, t, unlockAudio, celebrate } from './common.js';

const root = $('#root');
let scanning = null; // { orderId, stream, timer }

function stopScan() {
  if (!scanning) return;
  clearInterval(scanning.timer);
  scanning.stream?.getTracks().forEach((tr) => tr.stop());
  scanning = null;
}

async function settle(o, code, out) {
  const preimage = code.trim().toLowerCase().replace(/^lightning:/, '');
  try {
    const r = await api('POST', `/api/orders/${o.id}/settle`, { preimage });
    stopScan();
    celebrate();
    out.replaceChildren(h('div', { class: 'big-status st-ok' },
      h('div', { class: 'icon' }, '✅'),
      h('div', { class: 'title' }, t('rider.paid.title')),
      h('p', {}, t('rider.paid.sub', { fee: money(r.deliveryFee, r.currency), sats: sats(r.feeSats) }))));
    toast(t('rider.paid.toast'), 'ok');
    setTimeout(refresh, 2500);
  } catch (e) {
    try { navigator.vibrate?.(400); } catch { /* not supported */ }
    toast(e.message, 'error');
  }
}

function openScanner(o, card) {
  stopScan();
  unlockAudio(); // this tap lets the "Paid" beep play later
  const out = h('div', { class: 'stack' });
  const video = h('video', { class: 'scan', playsinline: true, muted: true });
  const input = h('input', { placeholder: t('rider.code.placeholder'), 'aria-label': t('rider.code.placeholder'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const go = h('button', {}, t('rider.confirm'));
  go.addEventListener('click', () => { unlockAudio(); settle(o, input.value, out); });
  const close = h('button', { class: 'secondary' }, t('close'));
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
    }).catch(() => { video.remove(); toast(t('rider.nocamera'), 'error'); });
  } else {
    video.remove();
    scanning = { orderId: o.id };
  }
}

async function refresh() {
  if (scanning) return; // don't redraw under the camera
  const list = await api('GET', '/api/rider/orders');
  const title = h('h1', {}, t('rider.title'));
  if (!list.length) {
    root.replaceChildren(title, h('p', { class: 'muted' }, t('rider.none')));
    return;
  }
  root.replaceChildren(title, ...list.map((o) => {
    const card = h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', {}, `${o.deliveryArea || t('rider.delivery')}${o.buyerName ? ` · ${o.buyerName}` : ''}`), badge(o.status)),
      h('p', { class: 'small muted' }, t('rider.items', { n: o.itemsCount, seller: o.sellerName })),
      h('p', {}, t('rider.fee'), ' ', h('b', {}, money(o.deliveryFee, o.currency)), h('span', { class: 'sats' }, ` · ${sats(o.feeSats)}`)),
    );
    if (o.status === 'LOCKED') {
      const b = h('button', {}, t('rider.scan'));
      b.addEventListener('click', () => { b.remove(); openScanner(o, card); });
      card.append(h('p', { class: 'small' }, t('rider.locked')), h('p', { class: 'small muted' }, t('rider.inspect')), b);
    } else if (o.status === 'PAID') {
      card.append(h('p', { class: 'small' }, t('rider.done')));
    } else {
      card.append(h('p', { class: 'small' }, t('rider.notpaid')));
    }
    return card;
  }));
}

poll(refresh, 3000);
