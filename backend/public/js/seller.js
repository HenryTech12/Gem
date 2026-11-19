import { $, h, api, money, sats, badge, countdown, copy, toast, store, poll, getHealth, t } from './common.js';

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
  const name = h('input', { id: 'shopname', placeholder: t('signup.placeholder'), maxlength: 60, autocomplete: 'organization' });
  const btn = h('button', {}, t('signup.create'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      shop = await api('POST', '/api/sellers', { name: name.value });
      store.set('gem:shop', shop);
      init();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });
  root.replaceChildren(
    h('h1', {}, t('signup.title')),
    h('p', { class: 'muted' }, t('signup.sub')),
    h('div', { class: 'card' }, h('label', { for: 'shopname' }, t('signup.name')), name, h('div', { class: 'stack' }, h('p'), btn)),
  );
}

function total() {
  const sub = draft.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  return { sub, all: sub + Number(draft.deliveryFee || 0) };
}

function renderMain() {
  const msg = h('textarea', { id: 'msg', placeholder: t('seller.msg.placeholder') });
  const parseBtn = h('button', {}, t('seller.parse'));
  parseBtn.addEventListener('click', async () => {
    if (!msg.value.trim()) return toast(t('seller.parse.empty'), 'error');
    parseBtn.disabled = true;
    try {
      const r = await api('POST', '/api/ai/parse', { sellerId: shop.sellerId, text: msg.value }, auth());
      if (!r.items.length) toast(t('seller.parse.none'), 'error');
      draft.items = r.items;
      if (r.deliveryArea) draft.deliveryArea = r.deliveryArea;
      toast(t(r.source === 'ai' ? 'seller.parse.ai' : 'seller.parse.ok'), 'ok');
      renderDraft();
    } catch (e) { toast(e.message, 'error'); }
    parseBtn.disabled = false;
  });

  root.replaceChildren(
    h('div', { class: 'row between' },
      h('h1', {}, `🛍️ ${shop.name}`),
      h('a', { href: `/s/${shop.sellerId}`, class: 'small' }, t('seller.public')),
    ),
    h('div', { class: 'card' },
      h('h2', {}, t('seller.new')),
      h('label', { for: 'msg' }, t('seller.msg')),
      msg,
      h('p'),
      parseBtn,
      h('div', { id: 'draft' }),
    ),
    h('div', { id: 'created' }),
    h('h2', {}, t('seller.orders')),
    h('div', { id: 'orders' }, h('p', { class: 'muted' }, t('seller.orders.none'))),
    h('details', { class: 'card', id: 'catalog' }, h('summary', {}, h('strong', {}, t('cat.title'))), h('div', { id: 'catbody' })),
  );
  renderDraft();
  renderCatalog();
  poll(renderOrders, 3000);
}

function renderDraft() {
  const box = $('#draft');
  const add = h('select', { 'aria-label': t('seller.additem') },
    h('option', { value: '' }, t('seller.additem')),
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
    const minus = h('button', { class: 'secondary', 'aria-label': t('seller.less', { name: it.name }) }, '−');
    const plus = h('button', { class: 'secondary', 'aria-label': t('seller.more', { name: it.name }) }, '+');
    minus.addEventListener('click', () => { it.qty -= 1; if (it.qty < 1) draft.items.splice(idx, 1); renderDraft(); });
    plus.addEventListener('click', () => { it.qty = Math.min(50, it.qty + 1); renderDraft(); });
    return h('tr', {}, h('td', {}, it.name), h('td', {}, h('span', { class: 'qty' }, minus, String(it.qty), plus)), h('td', {}, money(it.qty * it.unitPrice, health.currency)));
  });

  const fee = h('input', { id: 'fee', type: 'number', inputmode: 'numeric', min: 1, value: draft.deliveryFee });
  fee.addEventListener('input', () => { draft.deliveryFee = fee.value; $('#tot').textContent = money(total().all, health.currency); });
  const area = h('input', { id: 'area', value: draft.deliveryArea, maxlength: 60, placeholder: t('seller.area.placeholder') });
  area.addEventListener('input', () => (draft.deliveryArea = area.value));
  const buyer = h('input', { id: 'buyer', value: draft.buyerName, maxlength: 40, placeholder: t('optional') });
  buyer.addEventListener('input', () => (draft.buyerName = buyer.value));

  const modeFull = h('button', { class: draft.mode === 'full' ? 'on' : '' }, t('seller.mode.full'));
  const modeDep = h('button', { class: draft.mode === 'deposit' ? 'on' : '' }, t('seller.mode.deposit'));
  modeFull.addEventListener('click', () => { draft.mode = 'full'; renderDraft(); });
  modeDep.addEventListener('click', () => { draft.mode = 'deposit'; renderDraft(); });

  const create = h('button', {}, t('seller.createlink'));
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
    h('label', {}, t('seller.items')),
    draft.items.length ? h('table', { class: 'items' }, ...rows) : h('p', { class: 'muted small' }, t('seller.items.none')),
    add,
    h('label', { for: 'fee' }, t('seller.fee', { cur: health.currency })), fee,
    h('label', { for: 'area' }, t('seller.area')), area,
    h('label', { for: 'buyer' }, t('seller.buyer')), buyer,
    h('label', {}, t('seller.mode')),
    h('div', { class: 'seg' }, modeFull, modeDep),
    h('p', { class: 'small muted' }, t(draft.mode === 'full' ? 'seller.mode.full.sub' : 'seller.mode.deposit.sub')),
    h('div', { class: 'row between' }, h('strong', {}, t('total')), h('strong', { id: 'tot' }, money(total().all, health.currency))),
    h('p'),
    create,
  );
}

// ---------- catalog editor: prices live here, the AI and the buyer can never change them ----------
function renderCatalog() {
  const box = $('#catbody');
  const cur = health.currency;
  const rows = catalog.map((c) => {
    const price = h('input', { type: 'number', inputmode: 'numeric', min: 1, step: 1, value: c.price, 'aria-label': t('cat.price.of', { name: c.name }) });
    const save = h('button', { class: 'small' }, t('cat.save'));
    const del = h('button', { class: 'small secondary', 'aria-label': t('cat.delete.of', { name: c.name }) }, '🗑');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const u = await api('PUT', `/api/sellers/${shop.sellerId}/catalog/${encodeURIComponent(c.id)}`, { price: Number(price.value) }, auth());
        Object.assign(c, u);
        toast(t('cat.saved'), 'ok');
        renderDraft();
      } catch (e) { toast(e.message, 'error'); }
      save.disabled = false;
    });
    del.addEventListener('click', async () => {
      if (!confirm(t('cat.confirm', { name: c.name }))) return;
      try {
        await api('DELETE', `/api/sellers/${shop.sellerId}/catalog/${encodeURIComponent(c.id)}`, null, auth());
        catalog = catalog.filter((x) => x.id !== c.id);
        draft.items = draft.items.filter((i) => i.id !== c.id);
        renderCatalog();
        renderDraft();
      } catch (e) { toast(e.message, 'error'); }
    });
    return h('div', { class: 'catrow' },
      h('div', { class: 'grow' }, h('strong', {}, c.name), c.aliases?.length ? h('div', { class: 'small muted' }, c.aliases.join(', ')) : null),
      h('div', { class: 'row' }, price, save, del));
  });

  const name = h('input', { id: 'cat-name', maxlength: 60, placeholder: t('cat.name.placeholder') });
  const price = h('input', { id: 'cat-price', type: 'number', inputmode: 'numeric', min: 1, step: 1 });
  const aliases = h('input', { id: 'cat-aliases', maxlength: 300, placeholder: t('cat.aliases.placeholder') });
  const add = h('button', {}, t('cat.add'));
  add.addEventListener('click', async () => {
    add.disabled = true;
    try {
      const item = await api('POST', `/api/sellers/${shop.sellerId}/catalog`, { name: name.value, price: Number(price.value), aliases: aliases.value }, auth());
      catalog.push(item);
      toast(t('cat.added', { name: item.name }), 'ok');
      renderCatalog();
      renderDraft();
    } catch (e) { toast(e.message, 'error'); add.disabled = false; }
  });

  box.replaceChildren(
    h('p', { class: 'small muted' }, t('cat.sub')),
    ...(rows.length ? rows : [h('p', { class: 'muted small' }, t('cat.empty'))]),
    h('h3', {}, t('cat.new')),
    h('label', { for: 'cat-name' }, t('cat.name')), name,
    h('label', { for: 'cat-price' }, t('cat.price', { cur })), price,
    h('label', { for: 'cat-aliases' }, t('cat.aliases')), aliases,
    h('p'), add,
  );
}

function showLink(o) {
  const url = `${location.origin}/o/${o.id}`;
  const text = t(o.buyerName ? 'seller.wa.named' : 'seller.wa', { buyer: o.buyerName, shop: shop.name, url });
  const copyBtn = h('button', { class: 'secondary' }, t('seller.copylink'));
  copyBtn.addEventListener('click', () => copy(url, copyBtn));
  $('#created').replaceChildren(h('div', { class: 'card' },
    h('h2', {}, t('seller.linkready')),
    h('p', { class: 'code' }, url),
    h('div', { class: 'stack' },
      h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, t('seller.whatsapp')),
      copyBtn,
      h('a', { class: 'btn secondary', href: `/o/${o.id}`, target: '_blank', rel: 'noopener' }, t('seller.openbuyer')),
    ),
  ));
}

async function renderOrders() {
  const list = await api('GET', `/api/sellers/${shop.sellerId}/orders`, null, auth());
  const box = $('#orders');
  if (!list.length) return;
  box.replaceChildren(...list.map((o) => {
    const active = ['AWAITING_LOCK', 'AWAITING_PAYMENT', 'PARTIAL', 'LOCKED'].includes(o.status);
    const cancel = active ? h('button', { class: 'small secondary' }, t(o.status === 'LOCKED' ? 'seller.refund' : 'seller.cancel')) : null;
    cancel?.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await api('POST', `/api/orders/${o.id}/cancel`, { sellerId: shop.sellerId }, auth()); toast(t('seller.canceled'), 'ok'); renderOrders(); }
      catch (e) { toast(e.message, 'error'); cancel.disabled = false; }
    });
    return h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', {}, `${o.buyerName || t('seller.customer')} · ${o.deliveryArea || t('seller.noarea')}`), badge(o.status)),
      h('p', { class: 'small muted' }, o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')),
      h('div', { class: 'row between' },
        h('span', {}, money(o.subtotal + o.deliveryFee, o.currency), h('span', { class: 'sats' }, ` · ${sats(o.goodsSats + o.feeSats)}`)),
        o.status === 'LOCKED' && o.deadline ? h('span', { class: 'small lockedln' }, t('seller.refundin', { t: countdown(o.deadline, o.now) })) : null,
      ),
      o.review ? h('p', { class: 'small' }, `${'★'.repeat(o.review.stars)} “${o.review.text}”`) : null,
      h('div', { class: 'row' }, h('a', { class: 'small', href: `/o/${o.id}`, target: '_blank', rel: 'noopener' }, t('seller.openlink')), h('span', { class: 'grow' }), cancel),
    );
  }));
}

init().catch((e) => { root.replaceChildren(h('p', {}, e.message)); });
