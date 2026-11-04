import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { publicKeyXml } from '../../../tools/license-owner/owner.mjs';
import { validSecurityConfig } from './security.mjs';

// This password was previously published as a default and must not be used.
const rejectedPasswordHash = '53620e79a071f3cb310adc1302f47cedb930ceb292953da534984a36c0e88c30';

export function validateLocalConfig(env) {
  if (!validSecurityConfig(env) || createHash('sha256').update(env.ADMIN_PASSWORD).digest('hex') === rejectedPasswordHash) {
    throw new Error('Set a unique ADMIN_PASSWORD (16–256 bytes) and ADMIN_SESSION_SECRET (at least 32 bytes).');
  }
  try {
    if (!env.LICENSE_PRIVATE_KEY_B64 || !env.LICENSE_PUBLIC_KEY_B64) throw new Error();
    const privateKey = createPrivateKey(Buffer.from(env.LICENSE_PRIVATE_KEY_B64, 'base64'));
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
    const actualXml = publicKeyXml(createPublicKey(privateKey));
    const configuredXml = Buffer.from(env.LICENSE_PUBLIC_KEY_B64, 'base64').toString('utf8').trim();
    if (actualXml !== configuredXml) throw new Error();
  } catch {
    throw new Error('Configure the existing matching LICENSE_PRIVATE_KEY_B64 and LICENSE_PUBLIC_KEY_B64 RSA keys.');
  }
}
