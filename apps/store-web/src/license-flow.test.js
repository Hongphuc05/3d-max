import test from 'node:test';
import assert from 'node:assert/strict';
import { proveDevice, safeCheckoutUrl, orderIdFromLocation, licenseError } from './license-flow.js';

test('activation obtains native identity and signs server challenge before sending key', async () => {
  const calls = [];
  const identity = { deviceId: 'device', publicKey: { kty: 'RSA', n: 'public', e: 'AQAB' }, keyProtection: 'TPM', deviceName: 'PC' };
  const native = {
    getDeviceIdentity: async () => identity,
    signDeviceChallenge: async (...args) => { calls.push(['sign', ...args]); return { signature: 'signed' }; },
  };
  const api = {
    deviceChallenge: async (body) => { calls.push(['challenge', body]); return { challengeId: 'challenge', message: 'server-message' }; },
    activateLicense: async (body) => { calls.push(['activate', body]); return { expiresAt: 'future' }; },
  };
  await proveDevice({ api, native, licenseKey: '3DM-KEY' });
  assert.deepEqual(calls, [
    ['challenge', { ...identity, purpose: 'ACTIVATE' }],
    ['sign', 'challenge', 'server-message'],
    ['activate', { challengeId: 'challenge', signature: 'signed', licenseKey: '3DM-KEY' }],
  ]);
});

test('restore proves existing device without reading/sending license key', async () => {
  let body;
  const api = {
    deviceChallenge: async (request) => { assert.equal(request.purpose, 'VERIFY'); return { challengeId: 'id', message: 'proof' }; },
    verifyDevice: async (request) => { body = request; return { device: { id: 'old' } }; },
  };
  const native = { getDeviceIdentity: async () => ({ deviceId: 'same' }), signDeviceChallenge: async () => ({ signature: 'sig' }) };
  await proveDevice({ api, native });
  assert.deepEqual(body, { challengeId: 'id', signature: 'sig' });
});

test('failed native proof never calls activation API', async () => {
  let activated = false;
  await assert.rejects(proveDevice({ licenseKey: 'key',
    native: { getDeviceIdentity: async () => { throw Object.assign(new Error(), { code: 'DEVICE_IDENTITY_LOST' }); } },
    api: { activateLicense: async () => { activated = true; } },
  }));
  assert.equal(activated, false);
});

test('checkout only allows exact HTTPS payOS host and ignores forged paid flags', () => {
  assert.equal(safeCheckoutUrl('https://pay.payos.vn/web/abc'), 'https://pay.payos.vn/web/abc');
  for (const value of ['javascript:alert(1)', 'http://pay.payos.vn/x', 'https://pay.payos.vn.evil.test/x', 'https://user:pass@pay.payos.vn/x']) {
    assert.equal(safeCheckoutUrl(value), null);
  }
  assert.equal(orderIdFromLocation('?status=PAID&success=true'), null);
  assert.equal(orderIdFromLocation('?orderId=8f7a0302-85f1-4405-9c06-1dcffba8da5a&status=PAID'), '8f7a0302-85f1-4405-9c06-1dcffba8da5a');
  assert.match(licenseError({ code: 'DEVICE_LIMIT_REACHED' }), /2 thiết bị/);
});
