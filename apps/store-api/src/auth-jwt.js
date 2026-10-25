import { SignJWT, jwtVerify } from 'jose';

export const SESSION_SECONDS = 30 * 86400;
const ISSUER = '3dsmood-api';
const AUDIENCE = '3dsmood-web';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[0-9a-f]{64}$/;

export function validateJwtConfiguration(env = process.env) {
  const value = env.JWT_SECRET;
  const key = typeof value === 'string' ? Buffer.from(value, 'base64') : null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value || '') || key?.length !== 32 || key.toString('base64') !== value) {
    throw Object.assign(new Error('Authentication signing key is not configured'),
      { code: 'AUTH_CONFIGURATION_REQUIRED', status: 503 });
  }
  return key;
}

function epoch(date) {
  return date instanceof Date ? Math.floor(date.getTime() / 1000) : NaN;
}

export async function signSessionJwt(userId, sessionId, expires,
  { env = process.env, currentDate = new Date() } = {}) {
  const key = validateJwtConfiguration(env);
  const issuedAt = epoch(currentDate);
  const expiresAt = epoch(expires);
  if (typeof userId !== 'string' || !UUID.test(userId) || !Buffer.isBuffer(sessionId) || sessionId.length !== 32
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > SESSION_SECONDS) {
    throw new TypeError('Invalid authentication session');
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(userId)
    .setJti(sessionId.toString('hex')).setIssuedAt(issuedAt).setExpirationTime(expiresAt)
    .sign(key);
}

export async function verifySessionJwt(token, { env = process.env, currentDate = new Date() } = {}) {
  const key = validateJwtConfiguration(env);
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const now = epoch(currentDate);
  if (!Number.isSafeInteger(now)) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], typ: 'JWT', issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ['sub', 'jti', 'iat', 'exp'], maxTokenAge: SESSION_SECONDS, currentDate,
    });
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)
      || typeof payload.jti !== 'string' || !SESSION_ID.test(payload.jti)
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || (payload.nbf !== undefined && !Number.isSafeInteger(payload.nbf))
      || payload.iat > now || payload.exp <= payload.iat || payload.exp - payload.iat > SESSION_SECONDS) return null;
    return { userId: payload.sub, sessionId: Buffer.from(payload.jti, 'hex') };
  } catch {
    return null;
  }
}
