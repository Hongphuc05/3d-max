import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generateLicenseKey, normalizeLicenseKey, hashLicenseKey, encryptLicenseKey, decryptLicenseKey, validateLicenseConfiguration } from './crypto.js';

process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');

test('keys use 160 random bits and consistent normalization/HMAC', () => {
  const keys = Array.from({ length: 500 }, generateLicenseKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^3DM-(?:[A-F0-9]{8}-){4}[A-F0-9]{8}$/);
  const key = keys[0];
  assert.equal(normalizeLicenseKey(` ${key.toLowerCase()} `), key);
  assert.deepEqual(hashLicenseKey(key), hashLicenseKey(key.toLowerCase()));
  assert.notDeepEqual(hashLicenseKey(keys[0]), hashLicenseKey(keys[1]));
  assert.throws(() => normalizeLicenseKey('not-a-license'), { code: 'INVALID_LICENSE_KEY' });
});

test('AES-GCM ciphertext authenticates license key and owner', () => {
  const key = generateLicenseKey();
  const encrypted = encryptLicenseKey(key, 'owner-id');
  assert.equal(decryptLicenseKey(encrypted, 'owner-id'), key);
  assert.throws(() => decryptLicenseKey(encrypted, 'other-id'));
  const damaged = { ...encrypted, key_ciphertext: Buffer.from(encrypted.key_ciphertext) };
  damaged.key_ciphertext[0] ^= 1;
  assert.throws(() => decryptLicenseKey(damaged, 'owner-id'));
  assert.notDeepEqual(encrypted.key_iv, encryptLicenseKey(key, 'owner-id').key_iv);
});

test('license secrets are mandatory distinct canonical 32-byte base64', () => {
  assert.doesNotThrow(() => validateLicenseConfiguration());
  assert.throws(() => validateLicenseConfiguration({}), /LICENSE_HMAC_SECRET/);
  const secret = randomBytes(32).toString('base64');
  assert.throws(() => validateLicenseConfiguration({ LICENSE_HMAC_SECRET: secret, LICENSE_ENCRYPTION_KEY: secret }), /distinct/);
  assert.throws(() => validateLicenseConfiguration({ LICENSE_HMAC_SECRET: 'abc', LICENSE_ENCRYPTION_KEY: secret }), /32-byte/);
});
