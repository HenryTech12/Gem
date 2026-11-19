// Shared helpers. No frameworks, no build step: fast on low-end phones and slow networks.
import { sha256Bytes } from './sha256.js';
import { t, locale } from './i18n.js';

export { t, tx } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(method, path, body, headers = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let health = null;
export async function getHealth() {
  if (!health) health = await api('GET', '/api/health');
  return health;
}

export function money(amount, currency) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}
export const sats = (n) => `${Number(n).toLocaleString(locale)} sats`;

export const STATUS_LABEL = {
  AWAITING_LOCK: ['🕓', 'muted'],
  AWAITING_PAYMENT: ['💳', 'muted'],
  PARTIAL: ['⏳', 'warn'],
  LOCKED: ['🔒', 'lock'],
  PAID: ['✅', 'ok'],
  REFUNDED: ['↩️', 'bad'],
};
export function badge(status) {
  const [icon, kind] = STATUS_LABEL[status] || ['•', 'muted'];
  return h('span', { class: `badge badge-${kind}` }, `${icon} ${STATUS_LABEL[status] ? t(`status.${status}`) : status}`);
}

export function countdown(deadline, serverNow) {
  const skew = serverNow ? Date.now() - serverNow : 0;
  const ms = Math.max(0, deadline + skew - Date.now());
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}h ${mm}m` : `${mm}:${ss}`;
}

export function qr(text, size = 6) {
  // qrcode-generator is loaded as a classic script (global `qrcode`)
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  const img = new Image();
  img.src = q.createDataURL(size, 2);
  img.alt = t('qr.alt');
  img.className = 'qr';
  return img;
}

export async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', {}, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = t('copied');
    setTimeout(() => (btn.textContent = old), 1500);
  }
}

export function toast(msg, kind = 'info') {
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((x) => parseInt(x, 16)));

export async function sha256Hex(hex) {
  const bytes = fromHex(hex);
  if (globalThis.crypto?.subtle) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }
  return toHex(sha256Bytes(bytes)); // plain-HTTP fallback (e.g. phone on LAN IP)
}

export function newSecret() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export function poll(fn, ms) {
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    if (!document.hidden) { try { await fn(); } catch { /* keep polling */ } }
    setTimeout(loop, ms);
  };
  loop();
  return () => { stopped = true; };
}

// ---------- success feedback: short beep + vibration (riders often can't watch the screen) ----------
let audio = null;
// Browsers only allow sound after a tap. Call this from a click handler to unlock audio early,
// so the beep still plays when the payment confirmation arrives a few seconds later.
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = audio || new AC();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio: vibration and the big green screen still work */ }
}

export function celebrate() {
  try { navigator.vibrate?.([180, 80, 180, 80, 320]); } catch { /* not supported */ }
  try {
    unlockAudio();
    if (!audio) return;
    const now = audio.currentTime;
    [[880, 0], [1320, 0.16]].forEach(([freq, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.35, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.25);
    });
  } catch { /* ignore */ }
}
