import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { publicKeyXml } from '../../../tools/license-owner/owner.mjs';
import { validateLocalConfig } from './local-config.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  ADMIN_PASSWORD: 'A suitably long unique passphrase',
  ADMIN_SESSION_SECRET: 'x'.repeat(48),
  LICENSE_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
  LICENSE_PUBLIC_KEY_B64: Buffer.from(publicKeyXml(publicKey)).toString('base64'),
};
test('requires configured credentials and matching RSA pair', () => {
  assert.doesNotThrow(() => validateLocalConfig(env));
  for (const key of Object.keys(env)) assert.throws(() => validateLocalConfig({ ...env, [key]: '' }));
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => validateLocalConfig({ ...env, LICENSE_PUBLIC_KEY_B64: Buffer.from(publicKeyXml(other.publicKey)).toString('base64') }));
});
test('rejects the previously published default password', () => {
  const oldPassword = Buffer.from('QWRtaW5AM2RzbW9vZDIwMjYh', 'base64').toString('utf8');
  assert.throws(() => validateLocalConfig({ ...env, ADMIN_PASSWORD: oldPassword }));
});
