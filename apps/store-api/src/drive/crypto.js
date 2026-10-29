// AES-256-GCM for Drive secrets. Key = DRIVE_TOKEN_KEY (canonical 32-byte base64), env only.
// AAD binds every ciphertext to its owner row, so a copied ciphertext cannot be replayed elsewhere.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function driveTokenKey(env = process.env) {
  const value = env.DRIVE_TOKEN_KEY;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('DRIVE_TOKEN_KEY must be a canonical 32-byte base64 secret');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new Error('DRIVE_TOKEN_KEY must be a canonical 32-byte base64 secret');
  return bytes;
}

export const tokenAad = connectionId => `3DM-DRIVE-TOKEN-V1|${connectionId}`;
export const stateAad = stateHashHex => `3DM-DRIVE-STATE-V1|${stateHashHex}`;

export function encryptSecret(plaintext, aad, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', driveTokenKey(env), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptSecret({ ciphertext, iv, authTag }, aad, env = process.env) {
  const decipher = createDecipheriv('aes-256-gcm', driveTokenKey(env), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
