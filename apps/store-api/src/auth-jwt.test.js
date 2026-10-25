import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { SESSION_SECONDS, validateJwtConfiguration, signSessionJwt, verifySessionJwt } from './auth-jwt.js';

const env = { JWT_SECRET: randomBytes(32).toString('base64') };
const key = Buffer.from(env.JWT_SECRET, 'base64');
const userId = 'ce8140a3-a299-4ad5-b9fc-30901483135f';
const sessionId = randomBytes(32);
const currentDate = new Date('2026-10-25T09:00:00Z');
const now = Math.floor(currentDate.getTime() / 1000);
const options = { env, currentDate };
const claims = { sub: userId, jti: sessionId.toString('hex'), iat: now, exp: now + 3600,
  iss: '3dsmood-api', aud: '3dsmood-web' };

function tokenFor(payload = claims, header = { alg: 'HS256', typ: 'JWT' }, signingKey = key) {
  const parts = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
  const signature = createHmac('sha256', signingKey).update(parts.join('.')).digest('base64url');
  return [...parts, signature].join('.');
}

test('JWT configuration requires a canonical independent 32-byte base64 key', () => {
  assert.deepEqual(validateJwtConfiguration(env), key);
  for (const value of [undefined, '', 'weak-secret', randomBytes(31).toString('base64'),
    randomBytes(33).toString('base64'), env.JWT_SECRET.slice(0, -1), `${env.JWT_SECRET}\n`]) {
    assert.throws(() => validateJwtConfiguration({ JWT_SECRET: value }),
      { code: 'AUTH_CONFIGURATION_REQUIRED', status: 503 });
  }
});

test('session JWT roundtrip preserves private database session binding and contains no credentials', async () => {
  const expires = new Date(currentDate.getTime() + SESSION_SECONDS * 1000);
  const token = await signSessionJwt(userId, sessionId, expires, options);
  const [header, payload] = token.split('.').slice(0, 2).map(value => JSON.parse(Buffer.from(value, 'base64url')));
  assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(payload.exp - payload.iat, SESSION_SECONDS);
  assert.equal(payload.sub, userId);
  assert.equal(payload.iss, '3dsmood-api');
  assert.equal(payload.aud, '3dsmood-web');
  assert.equal(payload.jti, sessionId.toString('hex'));
  assert.deepEqual(await verifySessionJwt(token, options), { userId, sessionId });
  assert.equal(Object.keys(payload).some(name => /secret|password|license|email|role/i.test(name)), false);
});

test('JWT rejects changed payload, changed signature, wrong signing key and unsigned algorithms', async () => {
  const valid = tokenFor();
  const parts = valid.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, sub: 'ef7bd783-5eca-4362-a95e-292418327ff4' })).toString('base64url');
  for (const token of [`${parts[0]}.${forgedPayload}.${parts[2]}`, `${parts[0]}.${parts[1]}.invalid`,
    tokenFor(claims, undefined, randomBytes(32)), tokenFor(claims, { alg: 'none', typ: 'JWT' }),
    tokenFor(claims, { alg: 'HS384', typ: 'JWT' }), tokenFor(claims, { alg: 'HS256', typ: 'OTHER' })]) {
    assert.equal(await verifySessionJwt(token, options), null);
  }
});

test('JWT validates expiry, issued time, not-before, issuer, audience and maximum lifetime', async () => {
  for (const change of [{ exp: now }, { exp: now - 1 }, { iat: now + 1 }, { nbf: now + 1 },
    { exp: now + SESSION_SECONDS + 1 }, { exp: now + 0.5 }, { iat: now - 0.5 }, { nbf: now - 0.5 },
    { exp: claims.iat }, { iss: 'another-api' }, { aud: 'another-client' }]) {
    assert.equal(await verifySessionJwt(tokenFor({ ...claims, ...change }), options), null, JSON.stringify(change));
  }
  assert.deepEqual(await verifySessionJwt(tokenFor({ ...claims, nbf: now }), options), { userId, sessionId });
});

test('JWT requires correctly typed user/session IDs and all required registered claims', async () => {
  for (const name of ['sub', 'jti', 'iat', 'exp', 'iss', 'aud']) {
    const { [name]: _removed, ...payload } = claims;
    assert.equal(await verifySessionJwt(tokenFor(payload), options), null, name);
  }
  for (const change of [{ sub: 'not-a-user' }, { sub: 5 }, { jti: 'a'.repeat(63) }, { jti: 'Z'.repeat(64) },
    { jti: [] }, { iat: String(now) }, { exp: String(now + 1000) }, { exp: null }]) {
    assert.equal(await verifySessionJwt(tokenFor({ ...claims, ...change }), options), null);
  }
});

test('JWT malformed input fails closed without exposing token/configuration details', async () => {
  for (const token of [null, undefined, '', 'opaque-legacy-cookie', '..', 'a.b.c', 'a'.repeat(4097), {}, []]) {
    assert.equal(await verifySessionJwt(token, options), null);
  }
  await assert.rejects(verifySessionJwt(tokenFor(), { env: {} }), { code: 'AUTH_CONFIGURATION_REQUIRED', status: 503 });
});

test('JWT issuer rejects malformed IDs, invalid dates and excessive lifetime', async () => {
  const expires = new Date(currentDate.getTime() + 3600000);
  for (const args of [['bad-user', sessionId, expires], [userId, randomBytes(31), expires],
    [userId, sessionId, new Date('invalid')], [userId, sessionId, currentDate],
    [userId, sessionId, new Date(currentDate.getTime() + (SESSION_SECONDS + 1) * 1000)]]) {
    await assert.rejects(signSessionJwt(...args, options));
  }
});
