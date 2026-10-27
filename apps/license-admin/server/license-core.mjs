import { constants, randomUUID, sign } from 'node:crypto';

export function requireRsa(key) {
  const bits = key?.asymmetricKeyDetails?.modulusLength;
  if (key?.asymmetricKeyType !== 'rsa' || !Number.isInteger(bits) || bits < 2048 || bits > 4096) {
    throw new Error('Use an RSA 2048–4096 bit key.');
  }
}

export function issueLicense(privateKey, machineCode, licenseId = randomUUID()) {
  if (!/^MAX-[A-F0-9]{64}$/.test(machineCode ?? '')) {
    throw new Error('Machine code must be MAX- followed by 64 uppercase hexadecimal characters.');
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(licenseId ?? '')) {
    throw new Error('License ID must contain 1–80 letters, digits, hyphens or underscores.');
  }
  requireRsa(privateKey);
  if (privateKey.type !== 'private') throw new Error('Signing requires the owner private key.');

  const payload = Buffer.from(JSON.stringify({ version: 1, product: '3dsmood-library', machineCode, licenseId }), 'utf8');
  const signature = sign('RSA-SHA256', payload, { key: privateKey, padding: constants.RSA_PKCS1_PADDING });
  return `MXL1.${payload.toString('base64url')}.${signature.toString('base64url')}`;
}
