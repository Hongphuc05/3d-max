import test from 'node:test';
import assert from 'node:assert/strict';
import { proveDevice, licenseError } from './license-flow.js';

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

test('license errors are shown in Vietnamese', () => {
  assert.match(licenseError({ code: 'DEVICE_LIMIT_REACHED' }), /2 thiết bị/);
});
