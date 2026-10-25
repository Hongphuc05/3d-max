import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicKey, createHash, verify, constants } from 'node:crypto';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const publicKey = createPublicKey({ key: fixture.identity.publicKey, format: 'jwk' });
const hash = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
assert.equal(hash, fixture.spkiHash);
assert.equal(verify('sha256', Buffer.from(fixture.message), {
  key: publicKey, padding: constants.RSA_PKCS1_PADDING,
}, Buffer.from(fixture.signature, 'base64')), true);
console.log('PASS native RSA JWK/SPKI/signature interoperates with Node.js crypto');
