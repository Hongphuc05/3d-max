import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import sessionRoute from '../api/session.js';
import issueLicenseRoute from '../api/issue-license.js';
import { createSession, SESSION_COOKIE } from './security.mjs';

const sessionSecret = 'api-route-tests-session-secret-at-least-thirty-two-bytes';
const adminPassword = 'unit-test-only-admin-password';
const signingKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = signingKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = createPublicKey(privatePem);
const signingKeyBase64 = Buffer.from(privatePem).toString('base64');
const publicJwk = publicKey.export({ format: 'jwk' });
const publicXml = `<RSAKeyValue><Modulus>${Buffer.from(publicJwk.n, 'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(publicJwk.e, 'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
const publicKeyBase64 = Buffer.from(publicXml).toString('base64');

function setAdminEnvironment() {
  process.env.ADMIN_PASSWORD = adminPassword;
  process.env.ADMIN_SESSION_SECRET = sessionSecret;
}

function authRequest(url, { method = 'GET', body, csrf = true } = {}) {
  const session = createSession({ secret: sessionSecret });
  const headers = {
    Origin: new URL(url).origin,
    Cookie: `${SESSION_COOKIE}=${session.token}`,
    'X-Real-IP': '127.0.0.21'
  };
  if (csrf) headers['X-CSRF-Token'] = session.csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return {
    request: new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    session
  };
}

test('admin login issues a protected session and logout clears it', async () => {
  setAdminEnvironment();
  const origin = 'https://admin.example.test';
  const wrongOrigin = await sessionRoute.fetch(new Request(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword })
  }));
  assert.equal(wrongOrigin.status, 403);

  const login = await sessionRoute.fetch(new Request(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Real-IP': '127.0.0.20' }, body: JSON.stringify({ password: adminPassword })
  }));
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(loginBody.authenticated, true);
  assert.ok(loginBody.csrfToken);

  const sessionResponse = await sessionRoute.fetch(new Request(`${origin}/api/session`, { headers: { Cookie: cookie.split(';')[0] } }));
  assert.equal((await sessionResponse.json()).authenticated, true);

  const logout = await sessionRoute.fetch(new Request(`${origin}/api/session`, {
    method: 'DELETE', headers: { Origin: origin, Cookie: cookie.split(';')[0], 'X-CSRF-Token': loginBody.csrfToken }
  }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('admin login throttles repeated failures', async () => {
  setAdminEnvironment();
  const origin = 'https://admin.example.test';
  const send = () => sessionRoute.fetch(new Request(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Real-IP': '127.0.0.22' }, body: JSON.stringify({ password: 'incorrect' })
  }));
  for (let attempt = 0; attempt < 8; attempt += 1) assert.equal((await send()).status, 401);
  assert.equal((await send()).status, 429);
});

test('license signing is authenticated, machine-bound and verifies with the public key', async () => {
  setAdminEnvironment();
  process.env.LICENSE_PRIVATE_KEY_B64 = signingKeyBase64;
  process.env.LICENSE_PUBLIC_KEY_B64 = publicKeyBase64;
  const unauthorized = await issueLicenseRoute.fetch(new Request('https://admin.example.test/api/issue-license', { method: 'POST' }));
  assert.equal(unauthorized.status, 401);

  const invalidMachine = authRequest('https://admin.example.test/api/issue-license', {
    method: 'POST', body: { machineCode: 'MAX-not-a-real-machine-code', licenseId: 'customer-01' }
  });
  assert.equal((await issueLicenseRoute.fetch(invalidMachine.request)).status, 400);

  const valid = authRequest('https://admin.example.test/api/issue-license', {
    method: 'POST', body: { machineCode: `MAX-${'A'.repeat(64)}`, licenseId: 'customer-01' }
  });
  const response = await issueLicenseRoute.fetch(valid.request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.licenseId, 'customer-01');
  const [version, payloadText, signatureText] = result.licenseToken.split('.');
  const payload = Buffer.from(payloadText, 'base64url');
  assert.equal(version, 'MXL1');
  assert.equal(verify('RSA-SHA256', payload, publicKey, Buffer.from(signatureText, 'base64url')), true);
  assert.deepEqual(JSON.parse(payload.toString('utf8')), {
    version: 1, product: '3dsmood-library', machineCode: `MAX-${'A'.repeat(64)}`, licenseId: 'customer-01'
  });
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('license signing fails closed when the server key is missing or invalid', async () => {
  setAdminEnvironment();
  const valid = authRequest('https://admin.example.test/api/issue-license', {
    method: 'POST', body: { machineCode: `MAX-${'B'.repeat(64)}` }
  });
  delete process.env.LICENSE_PRIVATE_KEY_B64;
  process.env.LICENSE_PUBLIC_KEY_B64 = publicKeyBase64;
  let response = await issueLicenseRoute.fetch(valid.request);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE KEY/);

  process.env.LICENSE_PRIVATE_KEY_B64 = 'not-a-private-key';
  const retry = authRequest('https://admin.example.test/api/issue-license', {
    method: 'POST', body: { machineCode: `MAX-${'B'.repeat(64)}` }
  });
  response = await issueLicenseRoute.fetch(retry.request);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /not-a-private-key/);

  process.env.LICENSE_PRIVATE_KEY_B64 = signingKeyBase64;
  const wrongKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongJwk = wrongKeyPair.publicKey.export({ format: 'jwk' });
  const wrongXml = `<RSAKeyValue><Modulus>${Buffer.from(wrongJwk.n, 'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(wrongJwk.e, 'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
  process.env.LICENSE_PUBLIC_KEY_B64 = Buffer.from(wrongXml).toString('base64');
  const mismatch = authRequest('https://admin.example.test/api/issue-license', {
    method: 'POST', body: { machineCode: `MAX-${'C'.repeat(64)}` }
  });
  response = await issueLicenseRoute.fetch(mismatch.request);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE KEY/);
});
