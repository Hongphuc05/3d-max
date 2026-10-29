// In-process fake of the few Google endpoints P1 touches. Test support only.
import http from 'node:http';

// files: [{ id, name, mimeType, parents:[id], size?, md5Checksum?, canDownload?, content?: Buffer, resourceKey? }]
export async function startFakeDrive({ files = [], user = { emailAddress: 'operator@example.test' }, pageSize = 2 } = {}) {
  const state = { files, requests: [], failures: [], tokens: new Set(['good-token']), user };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    // A failure with `media:true` only fires on alt=media requests (lets a test pass list/get and refuse the download).
    const at = state.failures.findIndex(f => !f.media || url.searchParams.get('alt') === 'media');
    const fail = at >= 0 ? state.failures.splice(at, 1)[0] : undefined;
    if (fail) return send(fail.status, fail.body ?? { error: { errors: [{ reason: fail.reason }] } }, fail.headers);
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!state.tokens.has(auth)) return send(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });

    const meta = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, size: f.size != null ? String(f.size) : undefined,
      modifiedTime: '2026-01-01T00:00:00.000Z', md5Checksum: f.md5Checksum, resourceKey: f.resourceKey, driveId: f.driveId, shortcutDetails: f.shortcutDetails,
      ownedByMe: f.ownedByMe ?? false, capabilities: { canDownload: f.canDownload !== false } });

    if (url.pathname === '/drive/v3/about') return send(200, { user: state.user });
    if (url.pathname === '/drive/v3/files') {
      const folder = /^'([^']+)' in parents and trashed = false$/.exec(url.searchParams.get('q') || '')?.[1];
      if (!folder) return send(400, { error: { errors: [{ reason: 'invalidQuery' }] } });
      const all = state.files.filter(f => f.parents?.includes(folder));
      const start = Number(url.searchParams.get('pageToken') || 0);
      const size = Math.min(pageSize, Number(url.searchParams.get('pageSize')) || pageSize);
      const page = all.slice(start, start + size);
      return send(200, { files: page.map(meta), nextPageToken: start + size < all.length ? String(start + size) : undefined });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const f = state.files.find(x => x.id === one[1]);
      if (!f) return send(404, { error: { errors: [{ reason: 'notFound' }] } });
      if (url.searchParams.get('alt') === 'media') {
        if (f.canDownload === false) return send(403, { error: { errors: [{ reason: 'downloadRestricted' }] } });
        const body = f.content ?? Buffer.alloc(0);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) });
        return res.end(body);
      }
      return send(200, meta(f));
    }
    send(404, { error: { errors: [{ reason: 'notFound' }] } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
