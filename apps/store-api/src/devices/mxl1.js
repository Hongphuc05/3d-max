// Xac minh license MXL1 cu o phia may chu (plan P4.1): MXL1.<payload base64url>.<chu ky RSA-SHA256 PKCS1 base64url>.
// Payload: { version:1, product:'3dsmood-library', machineCode:'MAX-<64 hex>', licenseId }. Token hop le + machineCode KHOP thiet bi -> quyen ALL_MODELS.
// Moi sai lech tra null (khong nem, khong chap nhan mot phan): license cu khong duoc phep chan viec dang ky thiet bi.
import { constants, createPublicKey, verify } from 'node:crypto';

const MACHINE = /^MAX-[A-F0-9]{64}$/;
const LICENSE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_TOKEN_CHARS = 2048;

function requireRsa(key) {
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa' || !(bits >= 2048 && bits <= 4096)) throw new Error('unsupported licence key');
  return key;
}

// Khoa cong khai cua plugin la XML .NET <RSAKeyValue>; chap nhan them PEM va DER SPKI. Tat ca di qua base64 (bien LICENSE_PUBLIC_KEY_B64).
function keyFromXml(text) {
  if (/<!DOCTYPE|<!ENTITY|<\s*(D|P|Q|DP|DQ|InverseQ)\s*>/.test(text)) throw new Error('licence key XML must hold only the public part');
  const modulus = /<Modulus>\s*([A-Za-z0-9+/=]+)\s*<\/Modulus>/.exec(text)?.[1];
  const exponent = /<Exponent>\s*([A-Za-z0-9+/=]+)\s*<\/Exponent>/.exec(text)?.[1];
  if (!modulus || !exponent || !BASE64.test(modulus) || !BASE64.test(exponent)) throw new Error('invalid licence key XML');
  return createPublicKey({ key: { kty: 'RSA', n: Buffer.from(modulus, 'base64').toString('base64url'), e: Buffer.from(exponent, 'base64').toString('base64url') }, format: 'jwk' });
}

/** @returns KeyObject, hoac null khi chua cau hinh; NEM neu co cau hinh nhung khong dung duoc (de khong im lang bo qua loi). */
export function loadLegacyPublicKey(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) return null;
  const raw = Buffer.from(base64.trim(), 'base64');
  if (!raw.length) return null;
  const text = raw.toString('utf8');
  if (text.includes('PRIVATE KEY')) throw new Error('a private key must never be configured here');
  if (text.includes('-----BEGIN PUBLIC KEY-----')) return requireRsa(createPublicKey(text));
  if (text.includes('<RSAKeyValue')) return requireRsa(keyFromXml(text));
  return requireRsa(createPublicKey({ key: raw, format: 'der', type: 'spki' }));
}

/** @returns licenseId, hoac null neu bat ky dieu kien nao sai. */
export function verifyLegacyLicense(token, publicKey, machineCode) {
  try {
    if (!publicKey || typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !MACHINE.test(machineCode ?? '')) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'MXL1') return null;
    const [, payloadText, signatureText] = parts;
    if (!BASE64URL.test(payloadText ?? '') || !BASE64URL.test(signatureText ?? '')) return null;
    const payload = Buffer.from(payloadText, 'base64url');
    const signature = Buffer.from(signatureText, 'base64url');
    if (payload.toString('base64url') !== payloadText || signature.toString('base64url') !== signatureText) return null; // dang chuan duy nhat
    if (payload.length > 1024 || ![256, 384, 512].includes(signature.length)) return null;
    let body;
    try { body = JSON.parse(payload.toString('utf8')); } catch { return null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    if (body.version !== 1 || body.product !== '3dsmood-library' || body.machineCode !== machineCode
      || typeof body.licenseId !== 'string' || !LICENSE_ID.test(body.licenseId)) return null;
    return verify('RSA-SHA256', payload, { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, signature) ? body.licenseId : null;
  } catch { return null; }
}
