// Google OAuth 2.0 (authorization code + PKCE) for the operator account (Gmail B).
// Secrets handled here: client secret (env), refresh token (encrypted at rest), access token (RAM only),
// PKCE verifier (encrypted, single-use row). None of them is ever logged or returned to a browser.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { apiError } from './errors.js';
import { createDriveClient, DRIVE_BASE } from './client.js';
import { withRetry } from './backoff.js';
import { decryptSecret, driveTokenKey, encryptSecret, stateAad, tokenAad } from './crypto.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_MINUTES = 10;
const sha256 = value => createHash('sha256').update(value).digest();
const b64url = buffer => Buffer.from(buffer).toString('base64url');

// Only variable NAMES are reported, never values.
export function loadDriveConfig(env = process.env) {
  const errors = [];
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = (env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  if (!clientId) errors.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!clientSecret) errors.push('GOOGLE_OAUTH_CLIENT_SECRET');
  try {
    const u = new URL(redirectUri);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) || u.username || u.password || u.hash) throw new Error();
  } catch { errors.push('GOOGLE_OAUTH_REDIRECT_URI'); }
  try { driveTokenKey(env); } catch { errors.push('DRIVE_TOKEN_KEY'); }
  const adminUiUrl = (env.ADMIN_UI_URL || env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return { configured: errors.length === 0, errors, clientId, clientSecret, redirectUri, adminUiUrl };
}

export function createOAuth({ pool, config, env = process.env, fetchImpl = globalThis.fetch, authUrl = GOOGLE_AUTH_URL,
  tokenUrl = GOOGLE_TOKEN_URL, driveBase = DRIVE_BASE, retry = {}, now = Date.now }) {
  const cache = new Map();      // connectionId → { token, expiresAt }
  const inflight = new Map();   // connectionId → Promise (one refresh at a time per connection)
  const requireConfigured = () => { if (!config.configured) throw apiError('DRIVE_OAUTH_NOT_CONFIGURED'); };

  async function tokenRequest(params) {
    return withRetry(async () => {
      let response;
      try {
        response = await fetchImpl(tokenUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch { throw apiError('DRIVE_UPSTREAM_ERROR', { retryable: true }); }
      const body = await response.json().catch(() => null);
      if (response.ok && typeof body?.access_token === 'string') return body;
      if (response.status >= 500 || response.status === 429) throw apiError('DRIVE_UPSTREAM_ERROR', { retryable: true });
      // 4xx: Google's `error` is a short enum (invalid_grant, invalid_client…); keep only that, never the description.
      const reason = typeof body?.error === 'string' ? body.error.replace(/[^a-z_]/g, '').slice(0, 40) : 'unknown';
      throw Object.assign(apiError('DRIVE_BAD_REQUEST', { reason }), { oauthError: reason });
    }, { retries: 3, ...retry });
  }

  async function start(adminUserId) {
    requireConfigured();
    const state = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(48));
    const hash = sha256(state);
    const sealed = encryptSecret(verifier, stateAad(hash.toString('hex')), env);
    await pool.query("delete from oauth_states where expires_at < now() - interval '1 day'");
    await pool.query(
      `insert into oauth_states (id, admin_user_id, verifier_ciphertext, verifier_iv, verifier_auth_tag, expires_at)
       values ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))`,
      [hash, adminUserId, sealed.ciphertext, sealed.iv, sealed.authTag, STATE_MINUTES]);
    const url = new URL(authUrl);
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: DRIVE_SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
      state, code_challenge: b64url(sha256(verifier)), code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  // Consumes the state atomically: a replayed or expired state matches no row.
  async function callback({ code, state }) {
    requireConfigured();
    if (typeof code !== 'string' || typeof state !== 'string' || code.length > 2048 || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw apiError('OAUTH_STATE_INVALID');
    const hash = sha256(state);
    const { rows } = await pool.query(
      `update oauth_states set used_at = now()
       where id = $1 and used_at is null and expires_at > now()
       returning admin_user_id, verifier_ciphertext, verifier_iv, verifier_auth_tag`, [hash]);
    if (!rows[0]) throw apiError('OAUTH_STATE_INVALID');
    let verifier;
    try { verifier = decryptSecret({ ciphertext: rows[0].verifier_ciphertext, iv: rows[0].verifier_iv, authTag: rows[0].verifier_auth_tag }, stateAad(hash.toString('hex')), env); }
    catch { throw apiError('OAUTH_STATE_INVALID'); }

    let tokens;
    try { tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier }); }
    catch (e) { throw e.oauthError === 'invalid_grant' ? apiError('OAUTH_STATE_INVALID') : e; }
    if (!String(tokens.scope || '').split(' ').includes(DRIVE_SCOPE)) throw apiError('DRIVE_SCOPE_MISSING');
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw apiError('OAUTH_NO_REFRESH_TOKEN');

    const client = createDriveClient({ baseUrl: driveBase, fetchImpl, retry: { retries: 2, ...retry }, getAccessToken: async () => tokens.access_token });
    const { email } = await client.about();
    if (!email) throw apiError('DRIVE_UPSTREAM_ERROR');
    const id = await saveConnection({ email, refreshToken: tokens.refresh_token, adminUserId: rows[0].admin_user_id });
    cache.set(id, { token: tokens.access_token, expiresAt: now() + Math.max(0, (Number(tokens.expires_in) || 3600) - 60) * 1000 });
    return { connectionId: id, email };
  }

  async function saveConnection({ email, refreshToken, adminUserId }) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = (await pool.query(
        "select id from drive_connections where lower(google_account_email) = lower($1) and auth_kind = 'OAUTH_USER'", [email])).rows[0];
      const id = existing?.id ?? randomUUID();
      const sealed = encryptSecret(refreshToken, tokenAad(id), env); // AAD = the row's own id
      try {
        if (existing) {
          await pool.query(
            `update drive_connections set encrypted_refresh_token=$2, token_iv=$3, token_auth_tag=$4, status='CONNECTED',
               connected_at=now(), last_token_refresh_at=now(), last_error_code=null, created_by=$5 where id=$1`,
            [id, sealed.ciphertext, sealed.iv, sealed.authTag, adminUserId]);
        } else {
          await pool.query(
            `insert into drive_connections (id, google_account_email, auth_kind, encrypted_refresh_token, token_iv, token_auth_tag,
               status, last_token_refresh_at, created_by) values ($1,$2,'OAUTH_USER',$3,$4,$5,'CONNECTED',now(),$6)`,
            [id, email, sealed.ciphertext, sealed.iv, sealed.authTag, adminUserId]);
        }
        cache.delete(id);
        return id;
      } catch (error) { if (error.code !== '23505' || attempt) throw error; } // lost a race on the unique e-mail: retry as update
    }
  }

  async function refresh(connectionId) {
    const row = (await pool.query('select * from drive_connections where id = $1', [connectionId])).rows[0];
    if (!row) throw apiError('DRIVE_NOT_CONNECTED');
    if (row.status !== 'CONNECTED') throw apiError('DRIVE_AUTH_REVOKED');
    const refreshToken = decryptSecret({ ciphertext: row.encrypted_refresh_token, iv: row.token_iv, authTag: row.token_auth_tag }, tokenAad(row.id), env);
    let tokens;
    try { tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }); }
    catch (error) {
      if (error.oauthError === 'invalid_grant') {
        await pool.query("update drive_connections set status='RECONNECT_REQUIRED', last_error_code='DRIVE_AUTH_REVOKED' where id=$1", [row.id]);
        cache.delete(row.id);
        throw apiError('DRIVE_AUTH_REVOKED');
      }
      if (error.oauthError === 'invalid_client') { // our own configuration is wrong; the Google grant may still be fine
        await pool.query("update drive_connections set last_error_code='DRIVE_OAUTH_NOT_CONFIGURED' where id=$1", [row.id]);
        throw apiError('DRIVE_OAUTH_NOT_CONFIGURED');
      }
      throw error;
    }
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token && tokens.refresh_token !== refreshToken) { // rotation
      const sealed = encryptSecret(tokens.refresh_token, tokenAad(row.id), env);
      await pool.query('update drive_connections set encrypted_refresh_token=$2, token_iv=$3, token_auth_tag=$4 where id=$1',
        [row.id, sealed.ciphertext, sealed.iv, sealed.authTag]);
    }
    await pool.query('update drive_connections set last_token_refresh_at = now(), last_error_code = null where id = $1', [row.id]);
    const entry = { token: tokens.access_token, expiresAt: now() + Math.max(0, (Number(tokens.expires_in) || 3600) - 60) * 1000 };
    cache.set(row.id, entry);
    return entry.token;
  }

  async function getAccessToken(connectionId, { force = false } = {}) {
    requireConfigured();
    const hit = cache.get(connectionId);
    if (!force && hit && hit.expiresAt > now()) return hit.token;
    if (!inflight.has(connectionId)) inflight.set(connectionId, refresh(connectionId).finally(() => inflight.delete(connectionId)));
    return inflight.get(connectionId);
  }

  const tokenProvider = connectionId => opts => getAccessToken(connectionId, opts);
  return { start, callback, getAccessToken, tokenProvider };
}
