import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'three_ds_mood_admin';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function constantTimeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right)) && String(left) === String(right);
}

export function validSecurityConfig(env = process.env) {
  return typeof env.ADMIN_PASSWORD === 'string'
    && Buffer.byteLength(env.ADMIN_PASSWORD, 'utf8') >= 16
    && Buffer.byteLength(env.ADMIN_PASSWORD, 'utf8') <= 256
    && typeof env.ADMIN_SESSION_SECRET === 'string'
    && Buffer.byteLength(env.ADMIN_SESSION_SECRET, 'utf8') >= 32;
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSession({ secret, now = Date.now(), csrfToken = randomBytes(24).toString('base64url') }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Admin session secret must be at least 32 bytes.');
  }
  const payload = Buffer.from(JSON.stringify({
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    csrfToken
  })).toString('base64url');
  return { token: `${payload}.${signature(payload, secret)}`, csrfToken, expiresAt: now + SESSION_TTL_SECONDS * 1000 };
}

export function readSession(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 2048 || typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) return null;
  const [payload, provided, ...extra] = token.split('.');
  if (!payload || !provided || extra.length || !constantTimeEqual(provided, signature(payload, secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(session.issuedAt) || !Number.isSafeInteger(session.expiresAt)
        || session.issuedAt > now + 30_000 || session.expiresAt <= now
        || session.expiresAt - session.issuedAt > SESSION_TTL_SECONDS * 1000
        || typeof session.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(session.csrfToken)) return null;
    return session;
  } catch {
    return null;
  }
}

export function getCookie(request, name = SESSION_COOKIE) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function sessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function hasSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function hasValidCsrf(request, session) {
  return hasSameOrigin(request) && constantTimeEqual(request.headers.get('x-csrf-token') ?? '', session?.csrfToken ?? '');
}

export function consumeLoginAttempt(clientKey, now = Date.now()) {
  const key = createHash('sha256').update(String(clientKey || 'unknown')).digest('hex');
  let record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) record = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (record.count >= LOGIN_LIMIT) {
    loginAttempts.set(key, record);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)) };
  }
  record.count += 1;
  loginAttempts.set(key, record);
  if (loginAttempts.size > 10_000) {
    for (const [entry, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(entry);
  }
  return { allowed: true, remaining: LOGIN_LIMIT - record.count };
}

export function resetLoginAttempts(clientKey) {
  const key = createHash('sha256').update(String(clientKey || 'unknown')).digest('hex');
  loginAttempts.delete(key);
}

export function clientRateLimitKey(request) {
  return request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

export async function readJsonObject(request, maxBytes = 2048) {
  const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw Object.assign(new Error('Send a JSON request.'), { status: 415 });
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  return value;
}

export function jsonResponse(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}
