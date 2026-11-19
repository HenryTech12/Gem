// Small, strict input validators. Every request body goes through these.
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isHex32 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const sha256Hex = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
export const randomId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function str(v, { name, min = 0, max = 200, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
  // strip control characters
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${name} must be ${min}-${max} characters`);
  return s;
}

export function int(v, { name, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}`);
  return n;
}

export function hex32(v, name) {
  if (!isHex32(v)) throw new HttpError(400, `${name} must be 64 lowercase hex characters`);
  return v;
}
