// Turns a pasted WhatsApp/Instagram message into a structured order.
// Security: the model only picks catalog IDs and quantities. Prices come from the catalog.
// Any model output is validated; on failure or with no API key we use a rule-based parser.

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const WORD_NUMS = { a: 1, an: 1, one: 1, un: 1, une: 1, two: 2, deux: 2, three: 3, trois: 3, four: 4, quatre: 4, five: 5, cinq: 5, six: 6, ten: 10, dix: 10 };

function matchCatalog(text, catalog) {
  const t = norm(text);
  let best = null;
  let bestScore = 0;
  for (const item of catalog) {
    for (const cand of [item.name, ...(item.aliases || [])]) {
      const c = norm(cand);
      let score = 0;
      if (t.includes(c)) score = c.length + 10;
      else {
        const words = c.split(' ').filter((w) => w.length > 2);
        score = words.filter((w) => t.includes(w)).length * 3;
      }
      if (score > bestScore) { bestScore = score; best = item; }
    }
  }
  return bestScore > 0 ? best : null;
}

export function ruleParse(text, catalog) {
  const items = [];
  const parts = text.split(/,|\n|;|\+|\band\b|\bet\b/i).map((p) => p.trim()).filter(Boolean);
  let deliveryArea = '';
  for (const part of parts) {
    const area = part.match(/(?:deliver(?:y)?|livr(?:er|aison)|send)\s+(?:to|at|a|à|in)?\s*([A-Za-zÀ-ÿ' -]{2,40})/i);
    if (area) {
      deliveryArea = area[1].replace(/\b(tomorrow|today|demain|aujourd'?hui)\b/gi, '').trim();
      const before = part.slice(0, area.index).trim();
      if (!before) continue;
    }
    const item = matchCatalog(part, catalog);
    if (!item) continue;
    let qty = 1;
    for (const tok of norm(part).split(' ')) {
      if (/^\d+$/.test(tok)) { qty = Number(tok); break; }
      if (WORD_NUMS[tok] && tok !== 'a' && tok !== 'an') { qty = WORD_NUMS[tok]; break; }
    }
    const existing = items.find((i) => i.id === item.id);
    if (existing) existing.qty += qty;
    else items.push({ id: item.id, qty });
  }
  return { items, deliveryArea };
}

async function aiParse(text, catalog, config) {
  const system = [
    'You convert informal African marketplace chat orders (English, Pidgin, French, Wolof mixed) into JSON.',
    'Only use catalog item IDs from the list. Never invent prices.',
    'Return ONLY JSON: {"items":[{"id":"<catalog id>","qty":<int 1-50>}],"deliveryArea":"<neighbourhood or empty>"}',
    `Catalog: ${JSON.stringify(catalog.map(({ id, name, aliases }) => ({ id, name, aliases })))}`,
  ].join('\n');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    // Groq exposes an OpenAI-compatible Chat Completions API.
    const body = {
      model: config.groqModel,
      temperature: 0,
      max_completion_tokens: 1024,
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
    };
    // gpt-oss models reason before answering; keep it short to stay fast.
    if (config.groqModel.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${config.groqKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } finally {
    clearTimeout(t);
  }
}

function sanitize(parsed, catalog) {
  const ids = new Set(catalog.map((c) => c.id));
  const items = [];
  for (const it of Array.isArray(parsed?.items) ? parsed.items : []) {
    const qty = Number(it?.qty);
    if (!ids.has(it?.id) || !Number.isInteger(qty) || qty < 1 || qty > 50) continue;
    const ex = items.find((i) => i.id === it.id);
    if (ex) ex.qty = Math.min(50, ex.qty + qty);
    else items.push({ id: it.id, qty });
  }
  const deliveryArea = typeof parsed?.deliveryArea === 'string' ? parsed.deliveryArea.slice(0, 60).trim() : '';
  return { items, deliveryArea };
}

export async function parseOrder(text, catalog, config) {
  if (config.groqKey) {
    try {
      const out = sanitize(await aiParse(text, catalog, config), catalog);
      if (out.items.length) return { ...out, source: 'ai' };
    } catch (e) {
      console.warn('[ai] falling back to rules:', e.message);
    }
  }
  return { ...sanitize(ruleParse(text, catalog), catalog), source: 'rules' };
}
