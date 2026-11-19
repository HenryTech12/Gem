// End-to-end tests of the escrow flow against the mock Lightning backend.
// Run: npm test       (no Docker needed)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';

let server, base, stopApp;
const sha = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const rh = (pre) => sha(sha(pre + Buffer.from('gem-rider').toString('hex')));
const secret = () => {
  const preimage = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
  return { preimage, hash, riderHash: rh(preimage) };
};
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  const { app, stop } = await createApp({ lnBackend: 'mock', dataFile: '', watchdogMs: 100, groqKey: '', nostrRelays: [] });
  stopApp = stop;
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { stopApp(); server.close(); });

async function newShopAndOrder(extra = {}) {
  const shop = (await call('POST', '/api/sellers', { name: 'Amaka Styles' })).body;
  const h = { 'x-seller-token': shop.token };
  const parsed = (await call('POST', '/api/ai/parse', { sellerId: shop.sellerId, text: '2 ankara dress, 1 gele, deliver to Yaba' }, h)).body;
  const order = (await call('POST', '/api/orders', { sellerId: shop.sellerId, items: parsed.items, deliveryFee: 2000, deliveryArea: parsed.deliveryArea, ...extra }, h)).body;
  return { shop, h, parsed, order };
}

test('rule parser handles chatty messages, word numbers and French', async () => {
  const { ruleParse } = await import('../src/ai.js');
  const { demoCatalog } = await import('../src/catalog.js');
  const ng = demoCatalog('NGN');
  assert.deepEqual(ruleParse('Hi! I want 2 ankara dress and one gele, deliver to Lekki', ng).items, [{ id: 'ankara-dress', qty: 2 }, { id: 'gele', qty: 1 }]);
  const sn = ruleParse('Bonjour, je veux deux boubou et 3 thiouraye, livrer à Médina', demoCatalog('XOF'));
  assert.deepEqual(sn.items, [{ id: 'boubou', qty: 2 }, { id: 'thiouraye', qty: 3 }]);
  assert.equal(sn.deliveryArea, 'Médina');
});

test('rule parser extracts items and area', async () => {
  const { parsed } = await newShopAndOrder();
  assert.deepEqual(parsed.items.map((i) => [i.id, i.qty]), [['ankara-dress', 2], ['gele', 1]]);
  assert.equal(parsed.deliveryArea, 'Yaba');
});

test('happy path: lock -> pay -> scan code -> seller AND rider paid', async () => {
  const { order } = await newShopAndOrder();
  assert.equal(order.subtotal, 36000);
  const { preimage, hash, riderHash } = secret();
  const locked = (await call('POST', `/api/orders/${order.id}/lock`, { paymentHash: hash, riderHash })).body;
  assert.equal(locked.status, 'AWAITING_PAYMENT');
  assert.ok(locked.invoices.seller.bolt11 && locked.invoices.rider.bolt11);

  // rider must NOT be able to settle before payment is locked
  const early = await call('POST', `/api/orders/${order.id}/settle`, { preimage });
  assert.equal(early.status, 409);

  const paid = (await call('POST', `/api/orders/${order.id}/demo-pay`)).body;
  assert.equal(paid.status, 'LOCKED');

  let net = (await call('GET', '/api/network')).body.balances;
  assert.equal(net.seller.lockedIn, order.goodsSats);
  assert.equal(net.rider.lockedIn, order.feeSats);

  const wrong = await call('POST', `/api/orders/${order.id}/settle`, { preimage: secret().preimage });
  assert.equal(wrong.status, 400);

  const done = (await call('POST', `/api/orders/${order.id}/settle`, { preimage })).body;
  assert.equal(done.status, 'PAID');
  net = (await call('GET', '/api/network')).body.balances;
  assert.equal(net.seller.sats, order.goodsSats);
  assert.equal(net.rider.sats, order.feeSats);

  // verified review
  const rev = await call('POST', `/api/orders/${order.id}/review`, { stars: 5, text: 'Fast and honest!', preimage });
  assert.equal(rev.status, 200);
  const shopView = (await call('GET', `/api/sellers/${order.sellerId}`)).body;
  assert.equal(shopView.delivered, 1);
  assert.equal(shopView.reviews.length, 1);
});

test('no delivery: seller cancels -> buyer refunded automatically', async () => {
  const { order, shop, h } = await newShopAndOrder();
  const { preimage, hash, riderHash } = secret();
  await call('POST', `/api/orders/${order.id}/lock`, { paymentHash: hash, riderHash });
  const before = (await call('GET', '/api/network')).body.balances.buyer.sats;
  await call('POST', `/api/orders/${order.id}/demo-pay`);
  const r = (await call('POST', `/api/orders/${order.id}/cancel`, { sellerId: shop.sellerId }, h)).body;
  assert.equal(r.status, 'REFUNDED');
  const after = (await call('GET', '/api/network')).body.balances.buyer.sats;
  assert.equal(after, before);
  const late = await call('POST', `/api/orders/${order.id}/settle`, { preimage });
  assert.equal(late.status, 409);
});

test('deadline passes -> watchdog refunds automatically', async () => {
  const { app, stop } = await createApp({ lnBackend: 'mock', dataFile: '', watchdogMs: 100, lockMinutes: 0.02, groqKey: '', nostrRelays: [] });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  const c = async (m, p, body, headers = {}) => (await fetch(b + p, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })).json();
  const shop = await c('POST', '/api/sellers', { name: 'Quick Shop' });
  const order = await c('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: 'gele', qty: 1 }], deliveryFee: 1000 }, { 'x-seller-token': shop.token });
  await c('POST', `/api/orders/${order.id}/lock`, (() => { const x = secret(); return { paymentHash: x.hash, riderHash: x.riderHash }; })());
  assert.equal((await c('POST', `/api/orders/${order.id}/demo-pay`)).status, 'LOCKED');
  await new Promise((r) => setTimeout(r, 1800));
  const o = await c('GET', `/api/orders/${order.id}`);
  assert.equal(o.status, 'REFUNDED');
  assert.match(o.refundReason, /expired/);
  const bal = (await c('GET', '/api/network')).balances;
  assert.equal(bal.buyer.sats, 5_000_000);
  stop(); srv.close();
});

test('security: wrong seller token rejected, bad hash rejected, deposit mode locks fee only', async () => {
  const { order, shop } = await newShopAndOrder({ mode: 'deposit' });
  assert.equal(order.goodsSats, 0);
  const bad = await call('POST', `/api/orders/${order.id}/cancel`, { sellerId: shop.sellerId }, { 'x-seller-token': 'nope' });
  assert.equal(bad.status, 401);
  const badHash = await call('POST', `/api/orders/${order.id}/lock`, { paymentHash: 'xyz', riderHash: 'xyz' });
  assert.equal(badHash.status, 400);
  const { hash, riderHash } = secret();
  const locked = (await call('POST', `/api/orders/${order.id}/lock`, { paymentHash: hash, riderHash })).body;
  assert.deepEqual(Object.keys(locked.invoices), ['rider']);
});

test('catalog editor: seller CRUD, validated prices, parser and orders use it, old orders keep their price', async () => {
  const { shop, h, order } = await newShopAndOrder();
  const base = `/api/sellers/${shop.sellerId}/catalog`;
  // auth + validation
  assert.equal((await call('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: 'gele', qty: 1 }], deliveryFee: 1000 }, { 'x-seller-token': 'nope' })).status, 401);
  assert.equal((await call('POST', base, { name: 'Bissap juice', price: 500 }, { 'x-seller-token': 'nope' })).status, 401);
  assert.equal((await call('POST', base, { name: 'Bissap juice', price: -5 }, h)).status, 400);
  assert.equal((await call('POST', base, { name: 'Bissap juice', price: 12.5 }, h)).status, 400);
  assert.equal((await call('POST', base, { name: 'x', price: 500 }, h)).status, 400);
  // create
  const item = (await call('POST', base, { name: 'Bissap juice (1L)', price: 1500, aliases: 'bissap, Zobo' }, h)).body;
  assert.equal(item.id, 'bissap-juice-1l');
  assert.deepEqual(item.aliases, ['bissap', 'zobo']);
  const dup = (await call('POST', base, { name: 'Bissap juice (1L)', price: 1500 }, h)).body;
  assert.notEqual(dup.id, item.id);
  // parser finds it through an alias; price comes from the catalog
  const parsed = (await call('POST', '/api/ai/parse', { sellerId: shop.sellerId, text: 'pls 3 zobo' }, h)).body;
  assert.deepEqual(parsed.items.map((i) => [i.id, i.qty, i.unitPrice]), [['bissap-juice-1l', 3, 1500]]);
  // update price: new orders use it, existing orders keep their snapshot
  const gele = order.items.find((i) => i.id === 'gele');
  const upd = await call('PUT', `${base}/gele`, { price: 7000 }, h);
  assert.equal(upd.body.price, 7000);
  assert.equal(upd.body.name, 'Aso-oke gele');
  assert.equal((await call('GET', `/api/orders/${order.id}`)).body.items.find((i) => i.id === 'gele').unitPrice, gele.unitPrice);
  const o2 = (await call('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: 'gele', qty: 1 }], deliveryFee: 1000 }, h)).body;
  assert.equal(o2.subtotal, 7000);
  // delete: item can no longer be ordered
  assert.equal((await call('DELETE', `${base}/${dup.id}`, null, h)).status, 200);
  assert.equal((await call('DELETE', `${base}/${dup.id}`, null, h)).status, 404);
  assert.equal((await call('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: dup.id, qty: 1 }], deliveryFee: 1000 }, h)).status, 400);
  const pub = (await call('GET', `/api/sellers/${shop.sellerId}`)).body;
  assert.ok(pub.catalog.some((c) => c.id === item.id) && !pub.catalog.some((c) => c.id === dup.id));
});

test('rate limits: per real client IP behind a proxy; X-Forwarded-For ignored without TRUST_PROXY', async () => {
  const run = async (trustProxy) => {
    const { app, stop } = await createApp({ lnBackend: 'mock', dataFile: '', trustProxy, groqKey: '', nostrRelays: [] });
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const b = `http://127.0.0.1:${srv.address().port}`;
    const make = (ip) => fetch(`${b}/api/sellers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name: 'Shop' }) }).then((r) => r.status);
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push(await make(trustProxy ? '41.0.0.1' : `41.0.0.${i}`));
    const other = await make('41.0.0.99');
    stop(); srv.close();
    return { last: statuses.at(-1), other };
  };
  const proxied = await run(1);
  assert.equal(proxied.last, 429);   // the same visitor is limited
  assert.equal(proxied.other, 200);  // a different visitor is not
  const direct = await run(0);
  assert.equal(direct.last, 429);    // spoofed headers don't bypass the limit
  assert.equal(direct.other, 429);
});
