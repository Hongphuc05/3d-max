// P4.2 (D26): ban sao model tren dia VPS. Khach luon nhan file tu day, khong bao gio tu Google.
// Ghi `.part` trong tmp/ -> kiem size/md5/sha256 -> rename nguyen tu; chong tai trung (single-flight, dem nguoi cho);
// kiem dung luong trong; don file it dung (LRU) khi day, khong bao gio don file dang duoc dung.
// Ten file suy ra tu id ban ghi (UUID) + md5/size nen khong the thoat khoi thu muc cache va doi file thi doi ten.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs, utimes } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MD5 = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIB = 1024 ** 3;

const failure = (code, status = 502) => Object.assign(new Error(code), { code, status });
const defaultFreeDisk = async (dir) => { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); };
const isAbort = (e) => e?.name === 'AbortError' || e?.code === 'ABORT_ERR';

export function createModelCache({ dir, open, maxBytes = 20 * GIB, minFreeBytes = 2 * GIB, maxFileBytes = 4 * GIB,
  freeDiskBytes = defaultFreeDisk, diskCheckEveryBytes = 64 * 1024 * 1024 }) {
  const tmpDir = path.join(dir, 'tmp');
  const pins = new Map();       // key -> so nguoi dang giu (cho tai hoac dang doc)
  const inflight = new Map();   // key -> { controller, waiters, promise }
  const reserved = new Map();   // key -> byte da giu cho dot tai dang chay
  const sha256Seen = new Map(); // key -> sha256 (tinh luc tai; sau khi khoi dong lai lay tu ban ghi DB)
  let roomLock = Promise.resolve();

  const pin = (key) => pins.set(key, (pins.get(key) ?? 0) + 1);
  const unpin = (key) => { const n = (pins.get(key) ?? 0) - 1; if (n > 0) pins.set(key, n); else pins.delete(key); };

  function describe(file) {
    if (!file || typeof file.id !== 'string' || !UUID.test(file.id)) throw failure('STORAGE_DOWNLOAD_FAILED');
    if (file.md5 != null && !MD5.test(file.md5)) throw failure('STORAGE_DOWNLOAD_FAILED');
    if (file.sha256 != null && !SHA256.test(file.sha256)) throw failure('STORAGE_DOWNLOAD_FAILED');
    const expected = file.sizeBytes == null ? null : Number(file.sizeBytes);
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0)) throw failure('STORAGE_DOWNLOAD_FAILED');
    const key = `${file.id.toLowerCase()}-${file.md5 ?? (expected === null ? 'u' : `s${expected}`)}`;
    return { key, final: path.join(dir, `${key}.bin`), expected, md5: file.md5 ?? null, sha256: file.sha256 ?? null, driveFileId: file.driveFileId };
  }

  async function listFinals() {
    const out = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.bin')) continue;
      const s = await stat(path.join(dir, name)).catch(() => null);
      if (s?.isFile()) out.push({ key: name.slice(0, -4), path: path.join(dir, name), size: s.size, mtimeMs: s.mtimeMs });
    }
    return out;
  }

  // Tuan tu hoa: hai dot tai khong cung thay mot "cho trong" roi giat nhau.
  function makeRoom(spec) {
    const run = async () => {
      const need = spec.expected ?? 0;
      if (spec.expected !== null && spec.expected > maxFileBytes) throw failure('DOWNLOAD_SIZE_MISMATCH');
      if (need > maxBytes) throw failure('DISK_SPACE_LOW', 503);
      for (;;) {
        const files = await listFinals();
        const used = files.reduce((n, f) => n + f.size, 0) + [...reserved.values()].reduce((n, v) => n + v, 0);
        if (used + need <= maxBytes && (await freeDiskBytes(dir)) - need >= minFreeBytes) { reserved.set(spec.key, need); return; }
        const victim = files.filter((f) => !pins.has(f.key)).sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
        if (!victim) throw failure('DISK_SPACE_LOW', 503);
        await rm(victim.path, { force: true });
        sha256Seen.delete(victim.key);
      }
    };
    const result = roomLock.then(run);
    roomLock = result.catch(() => {});
    return result;
  }

  async function download(spec, signal, onVerified) {
    await makeRoom(spec);
    const part = path.join(tmpDir, `${spec.key}.${randomUUID()}.part`);
    try {
      const upstream = await open(spec.driveFileId, { signal });
      const sha = createHash('sha256'), md5 = createHash('md5');
      let size = 0, lastDiskCheck = 0;
      const guard = new Transform({
        async transform(chunk, _enc, cb) {
          try {
            size += chunk.length;
            if ((spec.expected !== null && size > spec.expected) || size > maxFileBytes) return cb(failure('DOWNLOAD_SIZE_MISMATCH'));
            // Kich thuoc da biet thi cho da giu truoc; chua biet thi vua tai vua kiem dung luong.
            if (spec.expected === null && size - lastDiskCheck >= diskCheckEveryBytes) {
              lastDiskCheck = size;
              if ((await freeDiskBytes(dir)) < minFreeBytes) return cb(failure('DISK_SPACE_LOW', 503));
            }
            sha.update(chunk); md5.update(chunk);
            cb(null, chunk);
          } catch (e) { cb(e); }
        },
      });
      try { await pipeline(upstream.data, guard, createWriteStream(part, { flags: 'wx' }), { signal }); } catch (e) {
        if (isAbort(e) || signal?.aborted) throw e;
        if (e?.code === 'ENOSPC') throw failure('DISK_SPACE_LOW', 503);
        throw typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.code) && e.status ? e : failure('STORAGE_DOWNLOAD_FAILED');
      }
      const digest = { sha256: sha.digest('hex'), md5: md5.digest('hex'), size };
      if (size === 0 || (spec.expected !== null && size !== spec.expected)) throw failure('DOWNLOAD_SIZE_MISMATCH');
      if ((spec.md5 && spec.md5 !== digest.md5) || (spec.sha256 && spec.sha256 !== digest.sha256)) throw failure('DOWNLOAD_CHECKSUM_MISMATCH');
      await rename(part, spec.final);
      sha256Seen.set(spec.key, digest.sha256);
      try { await onVerified?.(digest); } catch { /* ghi sha256 vao DB hong khong lam hong ban tai da kiem xong */ }
      return { size, sha256: digest.sha256 };
    } finally {
      reserved.delete(spec.key);
      await rm(part, { force: true });
    }
  }

  function join(entry, signal) {
    entry.waiters++;
    let left = false;
    const leave = () => { if (left) return; left = true; if (--entry.waiters === 0) entry.controller.abort(); };
    return new Promise((resolve, reject) => {
      const onAbort = () => { leave(); reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (r) => { signal?.removeEventListener('abort', onAbort); left = true; resolve(r); },
        (e) => { signal?.removeEventListener('abort', onAbort); left = true; reject(e); });
    });
  }

  // Chay dung mot lan (goi tay luc khoi dong, hoac tu dong o lan acquire dau tien).
  let ready;
  const init = () => (ready ??= (async () => {
    await mkdir(tmpDir, { recursive: true });
    for (const name of await readdir(tmpDir)) await rm(path.join(tmpDir, name), { force: true, recursive: true });
  })());

  return {
    /** Tao thu muc va xoa `.part` bo do (luc khoi dong khong co dot tai nao dang chay). */
    init,

    /** @returns {{path,size,sha256,release()}} — goi release() khi doc xong; file dang giu thi khong bi don. */
    async acquire(file, { signal, onVerified } = {}) {
      signal?.throwIfAborted();
      const spec = describe(file);
      await init();
      pin(spec.key);
      try {
        let result;
        const hit = await stat(spec.final).catch(() => null);
        if (hit?.isFile() && (spec.expected === null || hit.size === spec.expected)) {
          const now = new Date(); await utimes(spec.final, now, now).catch(() => {});
          result = { size: hit.size, sha256: spec.sha256 ?? sha256Seen.get(spec.key) ?? null };
        } else {
          if (hit?.isFile()) await rm(spec.final, { force: true }); // kich thuoc khong khop ban ghi: khong tin
          let entry = inflight.get(spec.key);
          if (!entry) {
            const controller = new AbortController();
            entry = { controller, waiters: 0 };
            entry.promise = download(spec, controller.signal, onVerified).finally(() => inflight.delete(spec.key));
            entry.promise.catch(() => {});
            inflight.set(spec.key, entry);
          }
          result = await join(entry, signal);
        }
        let released = false;
        return { path: spec.final, size: result.size, sha256: result.sha256, release() { if (!released) { released = true; unpin(spec.key); } } };
      } catch (e) { unpin(spec.key); throw e; }
    },
  };
}
