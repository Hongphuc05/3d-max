import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { pool } from './db.js';
import { requireJson } from './security.js';
import { SESSION_SECONDS, signSessionJwt, verifySessionJwt, validateJwtConfiguration } from './auth-jwt.js';
import { publicUser } from './admin/access.js';
import { inTransaction as tx } from './catalog-admin/shared.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'sid';

// ---- mat khau: scrypt cua Node (khong them dependency). Dinh dang: scrypt$N$r$p$salt$hash ----
const N = 16384, R = 8, P = 1;
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(got, want);
}
// Email khong ton tai van ton cung thoi gian bam -> khong do duoc email qua do tre.
const dummyHash = hashPassword('khong-ai-dung-mat-khau-nay');

// ---- gioi han dang nhap sai ----
// ponytail: in-memory, 1 instance. Khi chay nhieu instance thi chuyen sang bang DB/Redis.
const WINDOW_MS = 15 * 60 * 1000, MAX_PER_EMAIL = 10, MAX_PER_IP = 100;
const fails = new Map(); // key -> [timestamp]
const recent = (k) => {
  const now = Date.now(), a = (fails.get(k) || []).filter((t) => now - t < WINDOW_MS);
  a.length ? fails.set(k, a) : fails.delete(k);
  return a;
};
const blocked = (email, ip) => recent(`e:${email}`).length >= MAX_PER_EMAIL || recent(`i:${ip}`).length >= MAX_PER_IP;
const addFail = (email, ip) => { for (const k of [`e:${email}`, `i:${ip}`]) fails.set(k, [...recent(k), Date.now()]); };
setInterval(() => { for (const k of [...fails.keys()]) recent(k); }, 60_000).unref();

// ---- session ----

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export async function createSession(req, userId, db = pool) {
  const sessionId = randomBytes(32);
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  const token = await signSessionJwt(userId, sessionId, expires);
  await db.query(
    'insert into sessions (id, user_id, expires_at, user_agent) values ($1, $2, $3, $4)',
    [sessionId, userId, expires, String(req.headers['user-agent'] || '').slice(0, 300)],
  );
  return { token, expires };
}

export function setSessionCookie(res, { token, expires }) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires,
  });
}

export async function currentUser(req) {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const claims = await verifySessionJwt(token);
  if (!claims) return null;
  const { rows } = await pool.query(
    `select u.id, u.email, u.role, u.username, u.display_name, u.must_change_credentials, u.is_admin_owner from sessions s join users u on u.id = s.user_id
     where s.id = $1 and s.user_id = $2 and s.expires_at > now() and u.admin_disabled_at is null`, [claims.sessionId, claims.userId]);
  // Read admin privileges from PostgreSQL on every request, never JWT claims.
  if (rows[0]) req.auth = { sessionId: claims.sessionId };
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

// ---- routes ----
// Tai khoan chi la admin (tao bang scripts/create-admin.js); truong `email` cua body giu nguyen hop dong cu nhung la ten dang nhap.
const clean = (b) => ({ email: String(b?.email ?? '').trim().toLowerCase(), password: String(b?.password ?? '') });
export const authRouter = Router();

function requireAuthConfiguration(_req, _res, next) {
  try { validateJwtConfiguration(); next(); } catch (error) { next(error); }
}

authRouter.post('/login', requireJson, requireAuthConfiguration, async (req, res, next) => {
  try {
    const { email, password } = clean(req.body);
    if (blocked(email, req.ip)) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
    if (email.length > 254 || !email || password.length < 1 || password.length > 128) {
      addFail(email, req.ip);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }
    const result = await tx(pool, async db => {
      // Serialize session issuance with account credential changes. A login that
      // checked the old password cannot create a session after a password reset.
      const row = (await db.query(`select id,email,password_hash,role,username,display_name,must_change_credentials,is_admin_owner
        from users where username=$1 and role='ADMIN' and admin_disabled_at is null for share`, [email])).rows[0];
      const ok = await verifyPassword(password, row ? row.password_hash : await dummyHash);
      return row && ok ? { user: publicUser(row), session: await createSession(req, row.id, db) } : null;
    });
    if (!result) {
      addFail(email, req.ip);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' }); // cung 1 thong bao cho ca 2 truong hop
    }
    fails.delete(`e:${email}`);
    setSessionCookie(res, result.session);
    res.json({ user: result.user });
  } catch (e) { next(e); }
});

authRouter.post('/logout', requireJson, async (req, res, next) => {
  try {
    const token = cookieOf(req, COOKIE);
    const claims = token ? await verifySessionJwt(token) : null;
    if (claims) await pool.query('delete from sessions where id = $1 and user_id = $2', [claims.sessionId, claims.userId]);
    res.clearCookie(COOKIE, { path: '/' });
    res.clearCookie('dsid', { path: '/' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
