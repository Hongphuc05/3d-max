// Minimal Google Drive v3 REST client (fetch only, no SDK). Everything here is server-side:
// callers never return Drive IDs, tokens, or upstream payloads to browsers/plugins.
// Request shapes follow the public Drive v3 reference; they are VERIFIED ONLY AGAINST A STUB until
// scripts/drive-probe.js is run against the real shared folder (docs/v3-implementation-plan.md P1.3).
import { Readable } from 'node:stream';
import { apiError } from './errors.js';
import { withRetry } from './backoff.js';

export const DRIVE_BASE = 'https://www.googleapis.com';
export const FOLDER = 'application/vnd.google-apps.folder';
export const SHORTCUT = 'application/vnd.google-apps.shortcut';
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const API_KEY_RE = /^[A-Za-z0-9_-]{20,256}$/;
const FILE_FIELDS = 'id,name,mimeType,parents,size,modifiedTime,md5Checksum,resourceKey,driveId,ownedByMe,'
  + 'capabilities(canDownload),shortcutDetails(targetId,targetMimeType,targetResourceKey)';
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'backendError']);

export function validId(id) { return typeof id === 'string' && ID_RE.test(id); }

// Retry-After is delta-seconds or an HTTP date. Absent/garbage must mean "unknown" (→ backoff), never 0.
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || String(value).trim() === '') return undefined;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

// Pure: HTTP status + parsed error body → ApiError (retryable flag decides backoff).
export function classifyDriveError(status, body, headers) {
  // Google chan tai hang loat bang trang HTML (403, khong co JSON): day la gioi han toc do tam thoi, khong phai thieu quyen.
  if (status === 403 && body === null && /html/i.test(headers?.get?.('content-type') ?? '')) return apiError('DRIVE_QUOTA_EXCEEDED', { reason: 'automatedQueries' });
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
  const retryAfterMs = parseRetryAfter(headers?.get?.('retry-after'));
  if (status === 401) return apiError('DRIVE_AUTH_REVOKED', { reason });
  if (status === 429 || (status === 403 && RATE_REASONS.has(reason))) return apiError('DRIVE_QUOTA_EXCEEDED', { retryable: true, retryAfterMs, reason });
  if (status === 403) return apiError('DRIVE_PERMISSION_DENIED', { reason });
  if (status === 404) return apiError('DRIVE_NOT_FOUND', { reason });
  if (status >= 500) return apiError('DRIVE_UPSTREAM_ERROR', { retryable: true, retryAfterMs, reason });
  return apiError('DRIVE_BAD_REQUEST', { reason });
}

// Two auth modes: OAuth/service account (getAccessToken, P1) or a plain API key for publicly shared folders (D26).
// The API key travels in the URL query, so it must never reach logs or errors: errors are built from status codes only.
export function createDriveClient({
  getAccessToken, apiKey, backupApiKey, baseUrl = DRIVE_BASE, fetchImpl = globalThis.fetch,
  retry = {}, metadataTimeoutMs = 30_000, mediaHeadersTimeoutMs = 60_000,
}) {
  if (apiKey !== undefined) {
    if (typeof apiKey !== 'string' || !API_KEY_RE.test(apiKey)) throw new TypeError('apiKey is malformed');
  } else if (typeof getAccessToken !== 'function') throw new TypeError('getAccessToken or apiKey is required');

  if (backupApiKey !== undefined && (typeof backupApiKey !== 'string' || !API_KEY_RE.test(backupApiKey) || !apiKey)) throw new TypeError('backupApiKey is malformed or missing primary key');

  const resourceKeyHeader = (id, key) => (key ? { 'X-Goog-Drive-Resource-Keys': `${id}/${key}` } : {});

  // One logical call = retries for transient errors + a single forced token refresh on 401.
  async function call({ path, params, headers, signal, media = false }) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (apiKey) url.searchParams.set('key', apiKey);
    let refreshed = false;
    let activeKey = apiKey;
    return withRetry(async () => {
      for (;;) {
        if (activeKey) url.searchParams.set('key', activeKey);
        const token = apiKey ? null : await getAccessToken({ force: refreshed });
        const timer = new AbortController();
        const timeout = setTimeout(() => timer.abort(new DOMException('Timeout', 'TimeoutError')), media ? mediaHeadersTimeoutMs : metadataTimeoutMs);
        const link = signal ? AbortSignal.any([signal, timer.signal]) : timer.signal;
        let response;
        try {
          response = await fetchImpl(url, { headers: { ...(apiKey ? {} : { Authorization: `Bearer ${token}` }), ...headers }, signal: link });
        } catch (error) {
          clearTimeout(timeout);
          if (signal?.aborted) throw error; // caller cancelled: not a Drive failure
          throw apiError('DRIVE_UPSTREAM_ERROR', { retryable: true }); // network/timeout
        }
        clearTimeout(timeout); // headers arrived; the body may stream for as long as the caller allows
        if (response.ok) return response;
        const body = await response.json().catch(() => null); // error bodies are small JSON, also for alt=media
        response.body?.cancel?.().catch(() => {});
        const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
        const keyReasons = new Set(['keyInvalid', 'apiKeyInvalid', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'accessNotConfigured', 'ipRefererBlocked']);
        if (backupApiKey && activeKey !== backupApiKey && (response.status === 401 || response.status === 429 || RATE_REASONS.has(reason) || keyReasons.has(reason))) {
          activeKey = backupApiKey;
          continue;
        }
        const error = classifyDriveError(response.status, body, response.headers);
        // A 401 may only mean the cached access token expired: refresh once, then retry immediately.
        if (response.status === 401 && !apiKey && !refreshed) { refreshed = true; error.retryable = true; error.retryAfterMs = 0; }
        throw error;
      }
    }, { ...retry, signal });
  }

  async function json(opts) { return (await call(opts)).json(); }

  return {
    async about(signal) {
      const data = await json({ path: '/drive/v3/about', params: { fields: 'user(emailAddress,displayName)' }, signal });
      return { email: data?.user?.emailAddress ?? null };
    },

    async getFile(fileId, { resourceKey, signal } = {}) {
      if (!validId(fileId)) throw apiError('INVALID_PARAMS');
      if (resourceKey && !KEY_RE.test(resourceKey)) throw apiError('INVALID_PARAMS');
      return json({
        path: `/drive/v3/files/${fileId}`,
        params: { fields: FILE_FIELDS, supportsAllDrives: true },
        headers: resourceKeyHeader(fileId, resourceKey), signal,
      });
    },

    // The folder id is interpolated into Drive's query language, so it is validated against a strict
    // charset first: no quotes, no operators, no way to widen the query.
    async listChildren(folderId, { pageToken, resourceKey, driveId, pageSize = 1000, signal } = {}) {
      if (!validId(folderId)) throw apiError('INVALID_PARAMS');
      if (resourceKey && !KEY_RE.test(resourceKey)) throw apiError('INVALID_PARAMS');
      if (driveId && !validId(driveId)) throw apiError('INVALID_PARAMS');
      const data = await json({
        path: '/drive/v3/files',
        params: {
          q: `'${folderId}' in parents and trashed = false`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: Math.min(1000, Math.max(1, pageSize)), pageToken,
          supportsAllDrives: true, includeItemsFromAllDrives: true,
          ...(driveId ? { corpora: 'drive', driveId } : {}),
        },
        headers: resourceKeyHeader(folderId, resourceKey), signal,
      });
      return { files: data?.files ?? [], nextPageToken: data?.nextPageToken ?? null };
    },

    // Same shape createArchiveSender expects from a provider: { status, headers, data(Readable) }.
    async openMedia(fileId, { resourceKey, signal } = {}) {
      if (!validId(fileId)) throw apiError('INVALID_PARAMS');
      if (resourceKey && !KEY_RE.test(resourceKey)) throw apiError('INVALID_PARAMS');
      const response = await call({
        path: `/drive/v3/files/${fileId}`,
        params: { alt: 'media', supportsAllDrives: true },
        headers: resourceKeyHeader(fileId, resourceKey), signal, media: true,
      });
      return { status: response.status, headers: response.headers, data: Readable.fromWeb(response.body) };
    },
  };
}
