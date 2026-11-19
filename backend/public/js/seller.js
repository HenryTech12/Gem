import { $, h, api, money, sats, badge, countdown, copy, toast, store, poll, getHealth } from './common.js';

const root = $('#root');
let shop = store.get('gem:shop');
let health;
let catalog = [];
let draft = { items: [], deliveryFee: 1500, deliveryArea: '', buyerName: '', mode: 'full' };

const auth = () => ({ 'x-seller-token': shop.token });

async function init() {
  health = await getHealth();
  if (!shop) return renderSignup();
  try {
    const pub = await api('GET', `/api/sellers/${shop.sellerId}`);
    catalog = pub.catalog;
  } catch {
    store.set('gem:shop', null);
    shop = null;
    return renderSignup();
  }
  renderMain();
}

function renderSignup() {
  const name = h('input', { id: 'shopname', placeholder: 'e.g. Amaka Styles', maxlength: 60, autocomplete: 'organization' });
  const btn = h('button', {}, 'Create my shop');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      shop = await api('POST', '/api/sellers', { name: name.value });
      store.set('gem:shop', shop);
      init();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });
  root.replaceChildren(
    h('h1', {}, 'Start selling safely'),
    h('p', { class: 'muted' }, 'No bank account, no paperwork. Your shop key stays on this phone.'),
    h('div', { class: 'card' }, h('label', { for: 'shopname' }, 'Shop name'), name, h('div', { class: 'stack' }, h('p'), btn)),
  );
}

function total() {
  const sub = draft.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  return { sub, all: sub + Number(draft.deliveryFee || 0) };
}

function renderMain() {
  const msg = h('textarea', { id: 'msg', placeholder: 'Paste the customer’s WhatsApp message, e.g.\n“Hi! I want 2 ankara dress and 1 gele, deliver to Yaba”' });
  const parseBtn = h('button', {}, '✨ Read the order for me');
  parseBtn.addEventListener('click', async () => {
    if (!msg.value.trim()) return toast('Paste a message first', 'error');
    parseBtn.disabled = true;
    try {
      const r = await api('POST', '/api/ai/parse', { sellerId: shop.sellerId, text: msg.value }, auth());
      if (!r.items.length) toast('No catalog items found. Add them below.', 'error');
      draft.items = r.items;
      if (r.deliveryArea) draft.deliveryArea = r.deliveryArea;
      toast(r.source === 'ai' ? 'Read by AI. Please check.' : 'Order read. Please check.', 'ok');
      renderDraft();
    } catch (e) { toast(e.message, 'error'); }
    parseBtn.disabled = false;
  });

  root.replaceChildren(
    h('div', { class: 'row between' },
      h('h1', {}, `🛍️ ${shop.name}`),
      h('a', { href: `/s/${shop.sellerId}`, class: 'small' }, 'Public page'),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'New order'),
      h('label', { for: 'msg' }, '1. Customer message (optional)'),
      msg,
      h('p'),
      parseBtn,
      h('div', { id: 'draft' }),
    ),
    h('div', { id: 'created' }),
    h('h2', {}, 'Your orders'),
    h('div', { id: 'orders' }, h('p', { class: 'muted' }, 'No orders yet.')),
  );
  renderDraft();
  poll(renderOrders, 3000);
}

function renderDraft() {
  const box = $('#draft');
  const add = h('select', { 'aria-label': 'Add item' },
    h('option', { value: '' }, '+ Add item from catalog'),
    ...catalog.map((c) => h('option', { value: c.id }, `${c.name} · ${money(c.price, health.currency)}`)),
  );
  add.addEventListener('change', () => {
    const c = catalog.find((x) => x.id === add.value);
    if (!c) return;
    const ex = draft.items.find((i) => i.id === c.id);
    if (ex) ex.qty += 1; else draft.items.push({ id: c.id, name: c.name, unitPrice: c.price, qty: 1 });
    renderDraft();
  });

  const rows = draft.items.map((it, idx) => {
    const minus = h('button', { class: 'secondary', 'aria-label': `Less ${it.name}` }, '−');
    const plus = h('button', { class: 'secondary', 'aria-label': `More ${it.name}` }, '+');
    minus.addEventListener('click', () => { it.qty -= 1; if (it.qty < 1) draft.items.splice(idx, 1); renderDraft(); });
    plus.addEventListener('click', () => { it.qty = Math.min(50, it.qty + 1); renderDraft(); });
    return h('tr', {}, h('td', {}, it.name), h('td', {}, h('span', { class: 'qty' }, minus, String(it.qty), plus)), h('td', {}, money(it.qty * it.unitPrice, health.currency)));
  });

  const fee = h('input', { id: 'fee', type: 'number', inputmode: 'numeric', min: 1, value: draft.deliveryFee });
  fee.addEventListener('input', () => { draft.deliveryFee = fee.value; $('#tot').textContent = money(total().all, health.currency); });
  const area = h('input', { id: 'area', value: draft.deliveryArea, maxlength: 60, placeholder: 'e.g. Yaba / Médina' });
  area.addEventListener('input', () => (draft.deliveryArea = area.value));
  const buyer = h('input', { id: 'buyer', value: draft.buyerName, maxlength: 40, placeholder: 'Optional' });
  buyer.addEventListener('input', () => (draft.buyerName = buyer.value));

  const modeFull = h('button', { class: draft.mode === 'full' ? 'on' : '' }, 'Full escrow');
  const modeDep = h('button', { class: draft.mode === 'deposit' ? 'on' : '' }, 'Delivery fee only');
  modeFull.addEventListener('click', () => { draft.mode = 'full'; renderDraft(); });
  modeDep.addEventListener('click', () => { draft.mode = 'deposit'; renderDraft(); });

  const create = h('button', {}, '🔗 Create payment link');
  create.addEventListener('click', async () => {
    create.disabled = true;
    try {
      const o = await api('POST', '/api/orders', {
        sellerId: shop.sellerId,
        items: draft.items.map(({ id, qty }) => ({ id, qty })),
        deliveryFee: Number(draft.deliveryFee),
        deliveryArea: draft.deliveryArea,
        buyerName: draft.buyerName,
        mode: draft.mode,
      }, auth());
      draft = { items: [], deliveryFee: draft.deliveryFee, deliveryArea: '', buyerName: '', mode: draft.mode };
      $('#msg').value = '';
      renderDraft();
      showLink(o);
      renderOrders();
    } catch (e) { toast(e.message, 'error'); }
    create.disabled = false;
  });

  box.replaceChildren(
    h('label', {}, '2. Items'),
    draft.items.length ? h('table', { class: 'items' }, ...rows) : h('p', { class: 'muted small' }, 'No items yet.'),
    add,
    h('label', { for: 'fee' }, `Delivery fee (${health.currency})`), fee,
    h('label', { for: 'area' }, 'Delivery area'), area,
    h('label', { for: 'buyer' }, 'Buyer name'), buyer,
    h('label', {}, 'What gets locked?'),
    h('div', { class: 'seg' }, modeFull, modeDep),
    h('p', { class: 'small muted' }, draft.mode === 'full'
      ? 'Buyer locks goods + delivery. Best protection for everyone.'
      : 'Buyer locks only the delivery fee, pays goods in cash. Stops fake orders.'),
    h('div', { class: 'row between' }, h('strong', {}, 'Total'), h('strong', { id: 'tot' }, money(total().all, health.currency))),
    h('p'),
    create,
  );
}

function showLink(o) {
  const url = `${location.origin}/o/${o.id}`;
  const text = `Hello${o.buyerName ? ` ${o.buyerName}` : ''}! Here is your secure Gëm payment link for your order from ${shop.name}. Your money stays locked until you receive your package: ${url}`;
  const copyBtn = h('button', { class: 'secondary' }, '📋 Copy link');
  copyBtn.addEventListener('click', () => copy(url, copyBtn));
  $('#created').replaceChildren(h('div', { class: 'card' },
    h('h2', {}, '✅ Link ready: send it to your customer'),
    h('p', { class: 'code' }, url),
    h('div', { class: 'stack' },
      h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, '💬 Send on WhatsApp'),
      copyBtn,
      h('a', { class: 'btn secondary', href: `/o/${o.id}`, target: '_blank', rel: 'noopener' }, 'Open as buyer (demo)'),
    ),
  ));
}

async function renderOrders() {
  const list = await api('GET', `/api/sellers/${shop.sellerId}/orders`, null, auth());
  const box = $('#orders');
  if (!list.length) return;
  box.replaceChildren(...list.map((o) => {
    const active = ['AWAITING_LOCK', 'AWAITING_PAYMENT', 'PARTIAL', 'LOCKED'].includes(o.status);
    const cancel = active ? h('button', { class: 'small secondary' }, o.status === 'LOCKED' ? '↩️ Refund buyer' : 'Cancel') : null;
    cancel?.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await api('POST', `/api/orders/${o.id}/cancel`, { sellerId: shop.sellerId }, auth()); toast('Canceled. Any locked money went back to the buyer.', 'ok'); renderOrders(); }
      catch (e) { toast(e.message, 'error'); cancel.disabled = false; }
    });
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', {}, `${o.buyerName || 'Customer'} · ${o.deliveryArea || 'no area'}`), badge(o.status)),
      h('p', { class: 'small muted' }, o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')),
      h('div', { class: 'row between' },
        h('span', {}, money(o.subtotal + o.deliveryFee, o.currency), h('span', { class: 'sats' }, ` · ${sats(o.goodsSats + o.feeSats)}`)),
        o.status === 'LOCKED' && o.deadline ? h('span', { class: 'small lockedln' }, `refund in ${countdown(o.deadline, o.now)}`) : null,
      ),
      o.review ? h('p', { class: 'small' }, `${'★'.repeat(o.review.stars)} “${o.review.text}”`) : null,
      h('div', { class: 'row' }, h('a', { class: 'small', href: `/o/${o.id}`, target: '_blank', rel: 'noopener' }, 'Open link'), h('span', { class: 'grow' }), cancel),
    );
  }));
}

init().catch((e) => { root.replaceChildren(h('p', {}, e.message)); });
