import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSessionCookie,
  consumeLoginAttempt,
  createSession,
  getCookie,
  hasSameOrigin,
  hasValidCsrf,
  readJsonObject,
  readSession,
  resetLoginAttempts,
  SESSION_COOKIE,
  sessionCookie,
  validSecurityConfig
} from './security.mjs';

const secret = 'test-only-session-secret-with-at-least-thirty-two-bytes';

test('signed admin sessions expire, reject tampering, and carry a CSRF token', () => {
  const now = 1_800_000_000_000;
  const session = createSession({ secret, now });
  const parsed = readSession(session.token, { secret, now: now + 1 });
  assert.equal(parsed.csrfToken, session.csrfToken);
  assert.equal(parsed.expiresAt, now + 8 * 60 * 60 * 1000);
  assert.equal(readSession(session.token, { secret: `${secret}x`, now }), null);
  assert.equal(readSession(`${session.token}x`, { secret, now }), null);
  assert.equal(readSession(session.token, { secret, now: session.expiresAt }), null);
  assert.throws(() => createSession({ secret: 'too-short' }), /at least 32 bytes/i);
});

test('admin cookies are HttpOnly, SameSite strict, and Secure on HTTPS', () => {
  const session = createSession({ secret });
  const httpsRequest = new Request('https://admin.example.test/api/session');
  assert.match(sessionCookie(session.token, httpsRequest), /HttpOnly/);
  assert.match(sessionCookie(session.token, httpsRequest), /Secure/);
  assert.match(sessionCookie(session.token, httpsRequest), /SameSite=Strict/);
  assert.match(clearSessionCookie(httpsRequest), /Max-Age=0/);
  const localCookie = sessionCookie(session.token, new Request('http://localhost:3000/api/session'));
  assert.doesNotMatch(localCookie, /; Secure/);
});

test('mutations require an exact same origin and the session CSRF token', () => {
  const session = createSession({ secret });
  const valid = new Request('https://admin.example.test/api/issue-license', {
    method: 'POST',
    headers: { Origin: 'https://admin.example.test', 'X-CSRF-Token': session.csrfToken }
  });
  assert.equal(hasSameOrigin(valid), true);
  assert.equal(hasValidCsrf(valid, session), true);
  assert.equal(hasSameOrigin(new Request('https://admin.example.test/api/issue-license', { method: 'POST' })), false);
  const foreign = new Request('https://admin.example.test/api/issue-license', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'X-CSRF-Token': session.csrfToken }
  });
  assert.equal(hasValidCsrf(foreign, session), false);
  const crossSite = new Request('https://admin.example.test/api/issue-license', {
    method: 'POST',
    headers: { Origin: 'https://admin.example.test', 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Token': session.csrfToken }
  });
  assert.equal(hasValidCsrf(crossSite, session), false);
});

test('cookie parsing, security configuration, JSON size and login throttling are bounded', async () => {
  const session = createSession({ secret });
  const request = new Request('https://admin.example.test/api', { headers: { Cookie: `other=x; ${SESSION_COOKIE}=${session.token}` } });
  assert.equal(getCookie(request), session.token);
  assert.equal(validSecurityConfig({ ADMIN_PASSWORD: 'long-test-password', ADMIN_SESSION_SECRET: secret }), true);
  assert.equal(validSecurityConfig({ ADMIN_PASSWORD: 'short', ADMIN_SESSION_SECRET: secret }), false);
  await assert.rejects(readJsonObject(new Request('https://admin.example.test', { method: 'POST', body: 'x' })), /JSON/i);
  await assert.rejects(readJsonObject(new Request('https://admin.example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'a'.repeat(3000) }) })), /too large/i);

  const ip = 'security-test-rate-limit-unique';
  resetLoginAttempts(ip);
  for (let attempt = 0; attempt < 8; attempt += 1) assert.equal(consumeLoginAttempt(ip, 1000).allowed, true);
  const blocked = consumeLoginAttempt(ip, 1001);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  resetLoginAttempts(ip);
});
