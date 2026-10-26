import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const failure = (code, status) => Object.assign(new Error(code), { code, status });

// Each sender belongs to the server, so its admission limit spans all requests.
export function createArchiveSender(provider, { maxConcurrent = 4, timeoutMs = 30 * 60_000 } = {}) {
  let active = 0;
  return async function send(req, res, model) {
    if (!model || model.canDownload === false) throw failure('MODEL_DOWNLOAD_RESTRICTED', 403);
    if (active >= maxConcurrent) throw failure('DOWNLOAD_BUSY', 503);
    active++;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream;
    try {
      const result = await provider.openDownload(model, { signal: controller.signal });
      upstream = result.data;
      if (controller.signal.aborted) throw failure('DOWNLOAD_CANCELLED', 499);
      if (result.status && result.status !== 200) throw failure('STORAGE_DOWNLOAD_FAILED', 502);
      const length = result.headers?.get?.('content-length') ?? result.headers?.['content-length'];
      const expected = /^\d+$/.test(String(length)) ? BigInt(length) : model.size != null ? BigInt(model.size) : null;
      let received = 0n;
      const verify = new Transform({
        transform(chunk, _encoding, callback) {
          received += BigInt(chunk.length);
          callback(expected !== null && received > expected ? failure('DOWNLOAD_SIZE_MISMATCH', 502) : null, chunk);
        },
        flush(callback) { callback(expected !== null && received !== expected ? failure('DOWNLOAD_SIZE_MISMATCH', 502) : null); },
      });
      const filename = `${model.slug || model.id}${model.archiveExtension}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Accept-Ranges', 'none');
      if (length && /^\d+$/.test(String(length))) res.set('Content-Length', String(length));
      await pipeline(upstream, verify, res, { signal: controller.signal });
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (controller.signal.aborted) throw failure('DOWNLOAD_TIMEOUT', 504);
      throw error;
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', disconnect);
      res.removeListener('close', disconnect);
      controller.abort();
      upstream?.destroy();
      active--;
    }
  };
}
