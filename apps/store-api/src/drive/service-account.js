// Service Account token provider — used by scripts/drive-probe.js to EVALUATE Q4 (OAuth user vs service account).
// Not wired into the HTTP routes. Standard "JWT bearer" grant: RS256 assertion signed with the SA private key.
import { importPKCS8, SignJWT } from 'jose';
import { apiError } from './errors.js';

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SA_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export function serviceAccountTokenProvider({ clientEmail, privateKey, tokenUrl = DEFAULT_TOKEN_URL, fetchImpl = globalThis.fetch, now = Date.now, scope = SA_SCOPE }) {
  if (typeof clientEmail !== 'string' || !clientEmail.includes('@') || typeof privateKey !== 'string' || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new TypeError('service account JSON needs client_email and private_key');
  }
  let cached = null, inflight = null;
  async function mint() {
    const key = await importPKCS8(privateKey, 'RS256');
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(clientEmail).setAudience(tokenUrl).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(key);
    let response;
    try {
      response = await fetchImpl(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(20_000) });
    } catch { throw apiError('DRIVE_UPSTREAM_ERROR', { retryable: true }); }
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.access_token !== 'string') throw apiError(response.status >= 500 ? 'DRIVE_UPSTREAM_ERROR' : 'DRIVE_AUTH_REVOKED');
    cached = { token: body.access_token, expiresAt: now() + Math.max(0, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return cached.token;
  }
  return async ({ force = false } = {}) => {
    if (!force && cached && cached.expiresAt > now()) return cached.token;
    inflight ??= mint().finally(() => { inflight = null; });
    return inflight;
  };
}
