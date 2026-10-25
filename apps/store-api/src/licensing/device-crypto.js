import { createPublicKey, createHash, verify, constants } from 'node:crypto';
import { licenseError, objectBody } from './errors.js';

export function validatedPublicKey(jwk) {
  objectBody(jwk, ['kty', 'n', 'e']);
  if (jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || typeof jwk.n !== 'string'
    || !/^[A-Za-z0-9_-]{342,683}$/.test(jwk.n)) throw licenseError('INVALID_DEVICE_KEY');
  try {
    const modulus = Buffer.from(jwk.n, 'base64url');
    if (modulus.toString('base64url') !== jwk.n || modulus[0] === 0) throw new Error('invalid modulus');
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: 'AQAB' }, format: 'jwk' });
    const bits = key.asymmetricKeyDetails.modulusLength;
    if (![2048, 3072, 4096].includes(bits)) throw new Error('unsupported key size');
    return {
      pem: key.export({ type: 'spki', format: 'pem' }),
      hash: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest(),
    };
  } catch { throw licenseError('INVALID_DEVICE_KEY'); }
}

export function validSignature(message, publicKeyPem, signature) {
  if (typeof signature !== 'string' || signature.length > 684 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  try {
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.toString('base64') !== signature || ![256,384,512].includes(bytes.length)) return false;
    return verify('RSA-SHA256', Buffer.from(message, 'utf8'), {
      key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING,
    }, bytes);
  } catch { return false; }
}
