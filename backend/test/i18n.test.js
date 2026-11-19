// Every UI string exists in EN, FR and WO, with the same {placeholders}; every key the pages use is defined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT } from '../public/js/i18n-dict.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('i18n: EN, FR and WO define the same keys and placeholders', () => {
  const en = Object.keys(DICT.en).sort();
  for (const lang of ['fr', 'wo']) {
    assert.deepEqual(Object.keys(DICT[lang]).sort(), en, `${lang} keys differ from en`);
    for (const k of en) assert.equal(vars(DICT[lang][k]), vars(DICT.en[k]), `${lang}.${k} placeholders`);
  }
});

test('i18n: every key used by the pages is defined', () => {
  const used = new Set(['status.AWAITING_LOCK', 'status.AWAITING_PAYMENT', 'status.PARTIAL', 'status.LOCKED', 'status.PAID', 'status.REFUNDED', 'role.buyer', 'role.seller', 'role.rider']);
  for (const f of fs.readdirSync(path.join(pub, 'js'))) {
    if (!f.endsWith('.js') || f.startsWith('i18n')) continue;
    const src = fs.readFileSync(path.join(pub, 'js', f), 'utf8');
    for (const m of src.matchAll(/\btx?\(\s*'([\w.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\?\s*'([a-z]+\.[\w.]+)'\s*:\s*'([a-z]+\.[\w.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
    for (const m of fs.readFileSync(path.join(pub, f), 'utf8').matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in DICT.en));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 150, `only ${used.size} keys found: extraction regex broken?`);
});

test('pages stay under 50 KB per file', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(pub)) assert.ok(fs.statSync(f).size < 50 * 1024, `${path.relative(pub, f)} is over 50 KB`);
});
