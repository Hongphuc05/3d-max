import { createHash, createPrivateKey, createPublicKey, randomUUID, timingSafeEqual } from 'node:crypto';
import { issueLicense, requireRsa } from '../server/license-core.mjs';
import { authorizeMutation } from '../server/route-auth.mjs';
import { jsonResponse, readJsonObject } from '../server/security.mjs';

function privateKeyFromEnvironment(value) {
  if (typeof value !== 'string' || value.length > 16_384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('License signing is not configured.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 256 || bytes.toString('base64') !== value) throw new Error('License signing is not configured.');
  return createPrivateKey({ key: bytes, format: 'pem' });
}

function publicKeyFromEnvironment(value) {
  if (typeof value !== 'string' || value.length > 16_384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('License verification key is not configured.');
  }
  const xmlBytes = Buffer.from(value, 'base64');
  if (xmlBytes.toString('base64') !== value) throw new Error('License verification key is not configured.');
  const xml = xmlBytes.toString('utf8');
  const match = /^<RSAKeyValue><Modulus>([A-Za-z0-9+/=]+)<\/Modulus><Exponent>([A-Za-z0-9+/=]+)<\/Exponent><\/RSAKeyValue>\s*$/.exec(xml);
  if (!match) throw new Error('License verification key is not configured.');
  const modulus = Buffer.from(match[1], 'base64');
  const exponent = Buffer.from(match[2], 'base64');
  if (modulus.length < 256 || modulus.length > 512 || !exponent.length || modulus.toString('base64') !== match[1] || exponent.toString('base64') !== match[2]) {
    throw new Error('License verification key is not configured.');
  }
  const publicKey = createPublicKey({ key: { kty: 'RSA', n: modulus.toString('base64url'), e: exponent.toString('base64url') }, format: 'jwk' });
  requireRsa(publicKey);
  return publicKey;
}

function assertKeyPair(privateKey, expectedPublicKey) {
  const actual = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const expected = expectedPublicKey.export({ type: 'spki', format: 'der' });
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(actualHash, expectedHash)) throw new Error('License signing key does not match the configured verification key.');
}

async function handle(request) {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  const authorization = authorizeMutation(request);
  if (!authorization.ok) return jsonResponse(authorization.status, { error: authorization.message });

  let body;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonResponse(error.status ?? 400, { error: error.message });
  }
  if (Object.keys(body).some(key => !['machineCode', 'licenseId'].includes(key))) return jsonResponse(400, { error: 'Unexpected input.' });
  if (typeof body.machineCode !== 'string' || !/^MAX-[A-F0-9]{64}$/.test(body.machineCode)) {
    return jsonResponse(400, { error: 'Mã máy cần có dạng MAX- và 64 ký tự hex in hoa.' });
  }
  if (body.licenseId !== undefined && body.licenseId !== ''
      && (typeof body.licenseId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.licenseId))) {
    return jsonResponse(400, { error: 'Mã tham chiếu chỉ được dùng chữ, số, dấu gạch ngang hoặc gạch dưới (tối đa 80 ký tự).' });
  }

  const licenseId = body.licenseId || randomUUID();
  let privateKey;
  try {
    privateKey = privateKeyFromEnvironment(process.env.LICENSE_PRIVATE_KEY_B64);
    const publicKey = publicKeyFromEnvironment(process.env.LICENSE_PUBLIC_KEY_B64);
    assertKeyPair(privateKey, publicKey);
    const licenseToken = issueLicense(privateKey, body.machineCode, licenseId);
    return jsonResponse(200, { licenseId, licenseToken });
  } catch {
    return jsonResponse(503, { error: 'Chưa cấu hình được khóa ký license trên server.' });
  }
}

export default { fetch: handle };
