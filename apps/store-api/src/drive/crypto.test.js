import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptSecret, driveTokenKey, encryptSecret, tokenAad } from './crypto.js';

const env = () => ({ DRIVE_TOKEN_KEY: randomBytes(32).toString('base64') });

test('round trip; ciphertext does not contain the plaintext', () => {
  const e = env(); const aad = tokenAad('11111111-1111-4111-8111-111111111111');
  const sealed = encryptSecret('1//refresh-token-secret', aad, e);
  assert.ok(!sealed.ciphertext.includes(Buffer.from('refresh-token-secret')));
  assert.equal(decryptSecret(sealed, aad, e), '1//refresh-token-secret');
});

test('AAD binds the ciphertext to its owner row', () => {
  const e = env();
  const sealed = encryptSecret('secret', tokenAad('aaaaaaaa-1111-4111-8111-111111111111'), e);
  assert.throws(() => decryptSecret(sealed, tokenAad('bbbbbbbb-1111-4111-8111-111111111111'), e));
});

test('tampered ciphertext / tag and a different key are rejected', () => {
  const e = env(); const aad = tokenAad('x');
  const sealed = encryptSecret('secret', aad, e);
  assert.throws(() => decryptSecret({ ...sealed, ciphertext: Buffer.concat([sealed.ciphertext.subarray(0, -1), Buffer.from([sealed.ciphertext.at(-1) ^ 1])]) }, aad, e));
  assert.throws(() => decryptSecret({ ...sealed, authTag: randomBytes(16) }, aad, e));
  assert.throws(() => decryptSecret(sealed, aad, env()));
});

test('every encryption uses a fresh IV', () => {
  const e = env();
  const a = encryptSecret('same', 'aad', e), b = encryptSecret('same', 'aad', e);
  assert.notDeepEqual(a.iv, b.iv); assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test('key must be canonical 32-byte base64', () => {
  for (const bad of [undefined, '', 'short', randomBytes(16).toString('base64'), randomBytes(32).toString('hex'), randomBytes(33).toString('base64')]) {
    assert.throws(() => driveTokenKey({ DRIVE_TOKEN_KEY: bad }), /DRIVE_TOKEN_KEY/);
  }
});
