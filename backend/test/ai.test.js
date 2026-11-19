// AI order reading via Groq, with fetch stubbed (no network, no key needed).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrder } from '../src/ai.js';
import { demoCatalog } from '../src/catalog.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const cfg = { groqKey: 'gsk_test', groqModel: 'openai/gpt-oss-20b' };
const catalog = demoCatalog('NGN');
const reply = (content, status = 200) => async (url, init) => {
  reply.last = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
};

test('groq: OpenAI-compatible request, JSON answer validated against the catalog', async () => {
  globalThis.fetch = reply('Sure! {"items":[{"id":"gele","qty":2},{"id":"made-up","qty":1},{"id":"kaftan","qty":999}],"deliveryArea":"Lekki"}');
  const out = await parseOrder('abeg 2 gele, deliver Lekki', catalog, cfg);
  assert.equal(reply.last.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(reply.last.init.headers.authorization, 'Bearer gsk_test');
  assert.equal(reply.last.body.model, 'openai/gpt-oss-20b');
  assert.equal(reply.last.body.reasoning_effort, 'low');
  assert.equal(reply.last.body.messages[0].role, 'system');
  // unknown ids and out-of-range quantities are dropped; prices never come from the model
  assert.deepEqual(out, { items: [{ id: 'gele', qty: 2 }], deliveryArea: 'Lekki', source: 'ai' });
});

test('groq: errors fall back to the rule parser', async () => {
  globalThis.fetch = reply('', 429);
  const out = await parseOrder('2 ankara dress, deliver to Yaba', catalog, cfg);
  assert.equal(out.source, 'rules');
  assert.deepEqual(out.items, [{ id: 'ankara-dress', qty: 2 }]);
});

test('groq: no key means no network call', async () => {
  globalThis.fetch = () => { throw new Error('should not be called'); };
  const out = await parseOrder('1 gele', catalog, { ...cfg, groqKey: '' });
  assert.equal(out.source, 'rules');
});

test('groq: non-gpt-oss models get no reasoning_effort', async () => {
  globalThis.fetch = reply('{"items":[{"id":"gele","qty":1}],"deliveryArea":""}');
  await parseOrder('1 gele', catalog, { ...cfg, groqModel: 'qwen/qwen3-32b' });
  assert.equal('reasoning_effort' in reply.last.body, false);
});
