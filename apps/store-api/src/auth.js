import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { pool } from './db.js';
import { requireJson } from './security.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
const COOKIE = 'sid';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const sha = (s) => createHash('sha256').update(s).digest();

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function startSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await pool.query(
    'insert into sessions (id, user_id, expires_at, user_agent) values ($1, $2, $3, $4)',
    [sha(token), userId, expires, String(req.headers['user-agent'] || '').slice(0, 300)],
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires,
  });
}

export async function currentUser(req) {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const { rows } = await pool.query(
    `select u.id, u.email from sessions s join users u on u.id = s.user_id
     where s.id = $1 and s.expires_at > now()`, [sha(token)]);
  return rows[0] || null;
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
const clean = (b) => ({ email: String(b?.email ?? '').trim().toLowerCase(), password: String(b?.password ?? '') });
function validate({ email, password }) {
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'INVALID_EMAIL';
  if (password.length < 8) return 'PASSWORD_TOO_SHORT';
  if (password.length > 128) return 'PASSWORD_TOO_LONG';
  return null;
}

export const authRouter = Router();

authRouter.post('/register', requireJson, async (req, res, next) => {
  try {
    const { email, password } = clean(req.body);
    const bad = validate({ email, password });
    if (bad) return res.status(400).json({ error: bad });
    let user;
    try {
      user = (await pool.query(
        'insert into users (email, password_hash) values ($1, $2) returning id, email',
        [email, await hashPassword(password)])).rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'EMAIL_TAKEN' });
      throw e;
    }
    await startSession(req, res, user.id);
    res.status(201).json({ user });
  } catch (e) { next(e); }
});

authRouter.post('/login', requireJson, async (req, res, next) => {
  try {
    const { email, password } = clean(req.body);
    if (blocked(email, req.ip)) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
    const row = (await pool.query('select id, email, password_hash from users where email = $1', [email])).rows[0];
    const ok = await verifyPassword(password, row ? row.password_hash : await dummyHash);
    if (!row || !ok) {
      addFail(email, req.ip);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' }); // cung 1 thong bao cho ca 2 truong hop
    }
    fails.delete(`e:${email}`);
    await startSession(req, res, row.id);
    res.json({ user: { id: row.id, email: row.email } });
  } catch (e) { next(e); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = cookieOf(req, COOKIE);
    if (token) await pool.query('delete from sessions where id = $1', [sha(token)]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
