import { createHash, randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { apiError } from '../drive/errors.js';

const ISSUER = 'https://oauth.telegram.org';
const AUTH_URL = `${ISSUER}/auth`;
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = new URL(`${ISSUER}/.well-known/jwks.json`);
const STATE = /^[A-Za-z0-9_-]{43}$/;
const jwks = createRemoteJWKSet(JWKS_URL, { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });

function encryptionKey(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes for Telegram Login.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('3dsmood-telegram-login'), Buffer.from('telegram-pkce-verifier-v1'), 32));
}

function encryptVerifier(verifier, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(verifier, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptVerifier(value, key) {
  const [version, iv, tag, ciphertext, extra] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw apiError('TELEGRAM_LOGIN_STATE_INVALID');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw apiError('TELEGRAM_LOGIN_STATE_INVALID'); }
}

const safeProfileText = (value, limit) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || null : null;

export function createTelegramLoginService({ pool, config, jwtSecret, fetchImpl = fetch, verifyIdToken } = {}) {
  if (!config?.loginConfigured) throw apiError('TELEGRAM_LOGIN_NOT_CONFIGURED');
  const key = encryptionKey(jwtSecret);

  async function createAttempt(adminId) {
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await pool.query('delete from telegram_login_attempts where expires_at <= now()');
    await pool.query(`insert into telegram_login_attempts (state_hash, admin_user_id, nonce, encrypted_code_verifier, expires_at)
      values ($1,$2,$3,$4,now() + interval '10 minutes')`, [createHash('sha256').update(state).digest(), adminId, nonce, encryptVerifier(verifier, key)]);
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({ client_id: config.loginClientId, redirect_uri: config.loginRedirectUri,
      response_type: 'code', scope: 'openid profile telegram:bot_access', state, nonce,
      code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return url.href;
  }

  async function consumeAttempt(state) {
    if (typeof state !== 'string' || !STATE.test(state)) throw apiError('TELEGRAM_LOGIN_STATE_INVALID');
    const deleted = await pool.query(`delete from telegram_login_attempts where state_hash=$1 and expires_at > now()
      returning admin_user_id, nonce, encrypted_code_verifier`, [createHash('sha256').update(state).digest()]);
    const attempt = deleted.rows[0];
    if (!attempt) throw apiError('TELEGRAM_LOGIN_STATE_INVALID');
    return { ...attempt, codeVerifier: decryptVerifier(attempt.encrypted_code_verifier, key) };
  }

  async function verifyToken(idToken, nonce) {
    try {
      const result = verifyIdToken
        ? await verifyIdToken(idToken, { issuer: ISSUER, audience: config.loginClientId })
        : (await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: config.loginClientId, algorithms: ['RS256', 'ES256'] })).payload;
      if (!result || result.nonce !== nonce) throw new Error('nonce');
      const telegramId = Number(result.id);
      const subject = typeof result.sub === 'string' ? result.sub : '';
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || subject.length < 1 || subject.length > 128) throw new Error('identity');
      const username = safeProfileText(result.preferred_username ?? result.username, 64);
      const name = safeProfileText(result.name, 128);
      const displayName = (name || username || `Telegram ${telegramId}`).slice(0, 128);
      return { telegramUserId: String(telegramId), subject, username, displayName };
    } catch { throw apiError('TELEGRAM_LOGIN_TOKEN_INVALID'); }
  }

  async function exchangeCode(code, attempt) {
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u0020]/.test(code)) throw apiError('TELEGRAM_LOGIN_STATE_INVALID');
    let response;
    try {
      const credentials = Buffer.from(`${config.loginClientId}:${config.loginClientSecret}`).toString('base64');
      response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.loginRedirectUri,
          client_id: config.loginClientId, code_verifier: attempt.codeVerifier }),
        signal: AbortSignal.timeout(8000) });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.id_token !== 'string' || data.id_token.length > 16_384) throw apiError('TELEGRAM_LOGIN_TOKEN_INVALID');
      return data.id_token;
    } catch (error) {
      if (error?.code?.startsWith?.('TELEGRAM_LOGIN_')) throw error;
      throw apiError('TELEGRAM_LOGIN_TOKEN_INVALID');
    }
  }

  return {
    createAttempt,
    async complete(state, code) {
      const attempt = await consumeAttempt(state);
      const idToken = await exchangeCode(code, attempt);
      const profile = await verifyToken(idToken, attempt.nonce);
      return { adminId: attempt.admin_user_id, profile };
    },
    async reject(state) { await consumeAttempt(state); },
  };
}
