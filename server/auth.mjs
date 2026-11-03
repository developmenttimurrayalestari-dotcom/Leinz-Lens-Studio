import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const COOKIE_NAME = 'leinz_session';
export const tokenHash = value => createHash('sha256').update(value).digest();
export const newToken = () => randomBytes(32).toString('base64url');
export const newCsrf = () => randomBytes(32).toString('hex');

export function username(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value.trim())) throw Error('Username harus 3–64 karakter: huruf, angka, titik, underscore, atau tanda minus.');
  return value.trim().toLowerCase();
}
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || /[\u0000]/.test(value)) throw Error('Password harus 8–128 karakter.');
  return value;
}
export async function hashPassword(value) {
  validatePassword(value);
  const salt = randomBytes(16);
  const result = await scrypt(value, salt, 64, COST);
  return `scrypt$1$${salt.toString('hex')}$${result.toString('hex')}`;
}
export async function verifyPassword(value, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 4 && parts[0] === 'scrypt' && parts[1] === '1' && /^[a-f0-9]{32}$/.test(parts[2]) && /^[a-f0-9]{128}$/.test(parts[3]);
  const salt = Buffer.from(valid ? parts[2] : '00'.repeat(16), 'hex');
  const expected = Buffer.from(valid ? parts[3] : '00'.repeat(64), 'hex');
  const result = await scrypt(typeof value === 'string' ? value.slice(0, 129) : '', salt, 64, COST);
  return valid && typeof value === 'string' && value.length <= 128 && timingSafeEqual(result, expected);
}
export function readSessionToken(header = '') {
  for (const item of String(header).split(';')) {
    const [name, ...rest] = item.trim().split('=');
    const value = rest.join('=');
    if (name === COOKIE_NAME && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  }
  return null;
}
export function sessionCookie(token, config, clear = false) {
  return `${COOKIE_NAME}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : config.sessionHours * 3600}${config.secureCookie ? '; Secure' : ''}`;
}
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class LoginLimiter {
  constructor({ limit = 10, windowMs = 15 * 60 * 1000 } = {}) { this.items = new Map(); this.limit = limit; this.windowMs = windowMs; }
  check(key, now = Date.now()) {
    const item = this.items.get(key);
    if (!item || item.until <= now) { this.items.delete(key); return true; }
    return item.count < this.limit;
  }
  fail(key, now = Date.now()) {
    if (this.items.size >= 10000 && !this.items.has(key)) this.items.delete(this.items.keys().next().value);
    const item = this.items.get(key);
    this.items.set(key, item && item.until > now ? { ...item, count: item.count + 1 } : { count: 1, until: now + this.windowMs });
  }
  success(key) { this.items.delete(key); }
}
