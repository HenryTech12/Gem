// Integration test against REAL LND nodes (regtest). Run after ./start.sh:
//   docker compose exec backend node test/lnd.integration.js
// or locally with LND_* env vars pointing at your nodes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';

const { app, stop } = await createApp({ lnBackend: 'lnd', dataFile: '', watchdogMs: 500, lockMinutes: 0.25, anthropicKey: '', nostrRelays: [] });
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (m, p, body, headers = {}) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${j.error}`);
  return j;
};
const sha = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const rh = (pre) => sha(sha(pre + Buffer.from('gem-rider').toString('hex')));
const secret = () => {
  const preimage = crypto.randomBytes(32).toString('hex');
  return { preimage, hash: crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex'), riderHash: rh(preimage) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`✔ ${s}`);

try {
  const net0 = await call('GET', '/api/network');
  console.log(net0.nodes.map((n) => `${n.role}: ${n.alias} channels=${n.channels}`).join(' | '));
  const shop = await call('POST', '/api/sellers', { name: 'Amaka Styles' });
  const H = { 'x-seller-token': shop.token };

  // --- Scenario 1: delivered ---
  const o1 = await call('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: 'ankara-dress', qty: 2 }], deliveryFee: 2000 }, H);
  const s1 = secret();
  let r = await call('POST', `/api/orders/${o1.id}/lock`, { paymentHash: s1.hash, riderHash: s1.riderHash });
  assert.ok(r.invoices.seller.bolt11.startsWith('lnbcrt'));
  step(`hold invoices created on seller + rider nodes, both unlocked by one buyer code (${o1.goodsSats} + ${o1.feeSats} sats)`);
  r = await call('POST', `/api/orders/${o1.id}/demo-pay`);
  assert.equal(r.status, 'LOCKED');
  const net1 = (await call('GET', '/api/network')).balances;
  step(`buyer paid: funds LOCKED in HTLCs (seller sees ${net1.seller.lockedIn} sats incoming, cannot spend)`);
  await assert.rejects(call('POST', `/api/orders/${o1.id}/settle`, { preimage: secret().preimage }), /does not match/);
  step('wrong code rejected');
  r = await call('POST', `/api/orders/${o1.id}/settle`, { preimage: s1.preimage });
  assert.equal(r.status, 'PAID');
  await sleep(1500);
  const net2 = (await call('GET', '/api/network')).balances;
  assert.equal(net1.seller.lockedIn - net0.balances.seller.lockedIn, o1.goodsSats);
  assert.equal(net1.rider.lockedIn - net0.balances.rider.lockedIn, o1.feeSats);
  assert.equal(net2.seller.sats - net0.balances.seller.sats, o1.goodsSats);
  assert.equal(net2.rider.sats - net0.balances.rider.sats, o1.feeSats);
  step(`code revealed: seller +${o1.goodsSats}, rider +${o1.feeSats} sats, both unlocked by ONE code`);

  // --- Scenario 2: never delivered -> automatic refund at deadline ---
  const o2 = await call('POST', '/api/orders', { sellerId: shop.sellerId, items: [{ id: 'gele', qty: 1 }], deliveryFee: 1000 }, H);
  const s2 = secret();
  await call('POST', `/api/orders/${o2.id}/lock`, { paymentHash: s2.hash, riderHash: s2.riderHash });
  r = await call('POST', `/api/orders/${o2.id}/demo-pay`);
  assert.equal(r.status, 'LOCKED');
  const before = (await call('GET', '/api/network')).balances.buyer;
  step(`order 2 locked (${before.lockedOut} sats in flight from buyer)`);
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    r = await call('GET', `/api/orders/${o2.id}`);
    if (r.status === 'REFUNDED') break;
  }
  assert.equal(r.status, 'REFUNDED');
  await sleep(1500);
  const after = (await call('GET', '/api/network')).balances.buyer;
  assert.equal(before.lockedOut, o2.goodsSats + o2.feeSats);
  assert.equal(after.lockedOut, 0);
  assert.ok(after.sats - before.sats >= o2.goodsSats + o2.feeSats, 'buyer got the locked amount back');
  step(`deadline passed: watchdog canceled, buyer refunded ${o2.goodsSats + o2.feeSats} sats automatically`);
  await assert.rejects(call('POST', `/api/orders/${o2.id}/settle`, { preimage: s2.preimage }), /refunded/);
  step('late code after refund rejected');
  console.log('\nALL LND INTEGRATION CHECKS PASSED');
} finally {
  stop();
  server.close();
}
