import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, constants } from 'node:crypto';
import { validatedPublicKey, validSignature } from './crypto.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = keys.publicKey.export({ format: 'jwk' });
test('accepts RSA public JWK and verifies exact UTF-8 PKCS1 SHA256 message', () => {
  const { pem, hash } = validatedPublicKey(jwk);
  assert.equal(hash.length, 32);
  const message = '3DM-DEVICE-V1|test';
  const signature = sign('RSA-SHA256', Buffer.from(message), keys.privateKey).toString('base64');
  assert.equal(validSignature(message, pem, signature), true);
  assert.equal(validSignature(`${message}changed`, pem, signature), false);
  assert.equal(validSignature(message, pem, 'not-base64'), false);
  assert.equal(validSignature(message, pem, signature.replace(/=+$/, '')), false);
  const pss = sign('RSA-SHA256', Buffer.from(message), { key: keys.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING }).toString('base64');
  assert.equal(validSignature(message, pem, pss), false);
});
test('rejects weak, private, malformed and unsupported keys', () => {
  assert.throws(() => validatedPublicKey({ ...jwk, d: 'secret' }));
  assert.throws(() => validatedPublicKey({ ...jwk, e: 'Aw' }));
  assert.throws(() => validatedPublicKey({ ...jwk, kty: 'EC' }));
  assert.throws(() => validatedPublicKey({ ...jwk, n: 'bad' }));
  assert.throws(() => validatedPublicKey(null));
  assert.throws(() => validatedPublicKey(generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' })));
});
