import { randomBytes, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { licenseError } from './errors.js';

function secret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`${name} must be a canonical 32-byte base64 secret`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) {
    throw new Error(`${name} must be a canonical 32-byte base64 secret`);
  }
  return bytes;
}

export function validateLicenseConfiguration(env = process.env) {
  const hmac = secret(env, 'LICENSE_HMAC_SECRET');
  const encryption = secret(env, 'LICENSE_ENCRYPTION_KEY');
  if (timingSafeEqual(hmac, encryption)) throw new Error('License encryption and HMAC secrets must be distinct');
  return { hmac, encryption };
}

// 20 CSPRNG bytes = 160 bits; hexadecimal avoids ambiguous base32 characters.
export function generateLicenseKey() {
  return `3DM-${randomBytes(20).toString('hex').toUpperCase().match(/.{8}/g).join('-')}`;
}

export function normalizeLicenseKey(value) {
  if (typeof value !== 'string' || value.length > 80) throw licenseError('INVALID_LICENSE_KEY');
  const normalized = value.trim().toUpperCase();
  if (!/^3DM-(?:[A-F0-9]{8}-){4}[A-F0-9]{8}$/.test(normalized)) throw licenseError('INVALID_LICENSE_KEY');
  return normalized;
}

export function hashLicenseKey(value) {
  return createHmac('sha256', validateLicenseConfiguration().hmac).update(normalizeLicenseKey(value)).digest();
}

export function encryptLicenseKey(value, ownerId) {
  const key_iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', validateLicenseConfiguration().encryption, key_iv);
  cipher.setAAD(Buffer.from(`3DM-LICENSE-V1|${ownerId}`));
  const key_ciphertext = Buffer.concat([cipher.update(normalizeLicenseKey(value), 'utf8'), cipher.final()]);
  return { key_ciphertext, key_iv, key_auth_tag: cipher.getAuthTag() };
}

export function decryptLicenseKey(row, ownerId) {
  const decipher = createDecipheriv('aes-256-gcm', validateLicenseConfiguration().encryption, row.key_iv);
  decipher.setAAD(Buffer.from(`3DM-LICENSE-V1|${ownerId}`));
  decipher.setAuthTag(row.key_auth_tag);
  return Buffer.concat([decipher.update(row.key_ciphertext), decipher.final()]).toString('utf8');
}
