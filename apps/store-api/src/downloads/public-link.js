// P4.2 (D26): VPS tai ho file tu link Drive cong khai (`drive.google.com/uc?export=download&id=`).
// Port tu plugin-csharp GoogleDriveDownloader.cs: xac nhan tai file lon + phat hien trang HTML + allowlist host.
// Khong theo redirect tu dong: moi buoc (redirect, form xac nhan) deu duoc kiem host/scheme/port truoc khi goi.
// Drive ID chi ton tai o day; loi tra ra ngoai chi mang ma phan loai, khong co URL/noi dung cua Google.
import { pipeline, Readable, Transform } from 'node:stream';

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_STEPS = 8;
const MAX_HTML_BYTES = 256 * 1024;

const failure = () => Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED', status: 502 });

function allowedUrl(url) {
  const host = url.hostname;
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && url.hash === ''
    && (host === 'drive.google.com' || host === 'drive.usercontent.google.com' || host === 'drive.googleusercontent.com' || host.endsWith('.googleusercontent.com'));
}

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);
function attributes(text) {
  const out = new Map();
  for (const m of text.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\s*=\s*["']([^"']*)["']/g)) out.set(m[1].toLowerCase(), decode(m[2]));
  return out;
}

// Chi nhan form GET cua Google toi usercontent /download, voi dung cac truong vo huong; id luon la id cua ta.
function confirmationUrl(html, fileId) {
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = attributes(form[1]);
    const action = attrs.get('action');
    if (action === undefined || (attrs.has('method') && attrs.get('method').toLowerCase() !== 'get')) continue;
    let url; try { url = new URL(action); } catch { continue; }
    if (!allowedUrl(url) || url.hostname !== 'drive.usercontent.google.com' || url.pathname !== '/download' || url.search !== '') continue;
    const fields = new Map([['id', fileId], ['export', 'download']]);
    for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
      const a = attributes(input[1]);
      const name = a.get('name'), value = a.get('value');
      if ((name === 'confirm' || name === 'uuid') && value !== undefined && /^[A-Za-z0-9_-]{1,200}$/.test(value)) fields.set(name, value);
    }
    if (!fields.has('confirm')) continue;
    return `${url.origin}${url.pathname}?${[...fields].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
  }
  return null;
}

async function readBounded(body, limit) {
  const chunks = []; let total = 0;
  for await (const c of Readable.fromWeb(body)) { total += c.length; if (total > limit) throw failure(); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

// Trang HTML dong vai file nhi phan (dang nhap, het han muc): dung truoc khi nhả byte dau tien.
function htmlGuard() {
  let first = true;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (first) {
        first = false;
        if (chunk.subarray(0, 512).toString('latin1').trimStart().startsWith('<')) return cb(failure());
      }
      cb(null, chunk);
    },
  });
}

/** @returns {{ open(fileId, {signal}): Promise<{status:200, headers:Headers, data:Readable}> }} */
export function createPublicLinkFetcher({ fetchImpl = fetch } = {}) {
  return {
    async open(fileId, { signal } = {}) {
      if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) throw failure();
      let target = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
      for (let step = 0; step < MAX_STEPS; step++) {
        signal?.throwIfAborted();
        const url = new URL(target);
        if (!allowedUrl(url)) throw failure();
        let response;
        try { response = await fetchImpl(url.href, { redirect: 'manual', signal }); } catch (e) { if (signal?.aborted) throw e; throw failure(); }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {});
          const location = response.headers.get('location');
          if (!location) throw failure();
          try { target = new URL(location, url).href; } catch { throw failure(); }
          continue;
        }
        if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw failure(); }
        const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (type === 'text/html' || type === 'application/xhtml+xml') {
          let page; try { page = await readBounded(response.body, MAX_HTML_BYTES); } catch (e) { if (signal?.aborted) throw e; throw failure(); }
          const next = confirmationUrl(page, fileId);
          if (!next) throw failure();
          target = next;
          continue;
        }
        const data = pipeline(Readable.fromWeb(response.body), htmlGuard(), () => {}); // pipeline: loi/huy o bat ky doan nao ket thuc ca hai
        const stop = () => data.destroy(signal.reason ?? new Error('aborted'));
        signal?.addEventListener('abort', stop, { once: true });
        data.once('close', () => signal?.removeEventListener('abort', stop));
        return { status: 200, headers: response.headers, data };
      }
      throw failure();
    },
  };
}
