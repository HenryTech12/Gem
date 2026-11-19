// Tiny i18n: English, French, Wolof. No build step, no library.
// Strings may use {name} placeholders and **bold** (rendered as <b>, never as HTML).
// Wolof copy is a first draft and needs review by a native speaker before launch.
import { DICT } from './i18n-dict.js';

export const LANGS = [['en', 'EN'], ['fr', 'FR'], ['wo', 'WO']];
const KEY = 'gem:lang';

function pick() {
  try {
    const saved = localStorage.getItem(KEY);
    if (DICT[saved]) return saved;
  } catch { /* private mode */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return DICT[nav] ? nav : 'en';
}

export const lang = pick();
// Number/currency formatting locale for the chosen language.
export const locale = lang === 'en' ? 'en-NG' : 'fr-SN';

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));

// Plain text (bold markers stripped).
export function t(key, vars) {
  const s = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  return fill(s, vars).replace(/\*\*/g, '');
}

// Nodes: text with **bold** segments turned into <b>. Values are inserted as text, never HTML.
export function tx(key, vars) {
  const s = fill(DICT[lang]?.[key] ?? DICT.en[key] ?? key, vars);
  return s.split('**').map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const b = document.createElement('b');
    b.textContent = part;
    return b;
  });
}

export function setLang(code) {
  try { localStorage.setItem(KEY, code); } catch { /* private mode */ }
  location.reload();
}

// Translate static markup: <el data-i18n="key">, and add the language switch to the header.
function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.replaceChildren(...tx(el.dataset.i18n));
  const header = document.querySelector('header.top');
  if (header && !header.querySelector('.langs')) {
    const nav = document.createElement('nav');
    nav.className = 'langs';
    nav.setAttribute('aria-label', 'Language');
    for (const [code, label] of LANGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.lang = code;
      if (code === lang) { b.className = 'on'; b.setAttribute('aria-current', 'true'); }
      b.addEventListener('click', () => { if (code !== lang) setLang(code); });
      nav.append(b);
    }
    header.append(nav);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyStatic);
else applyStatic();
