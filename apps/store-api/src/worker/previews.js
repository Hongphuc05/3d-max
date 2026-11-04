// Giai doan DOWNLOADING_PREVIEWS: tai anh tu Drive, sinh 2 ban WebP (sm 480 / lg 1400), ten file = sha256 noi dung.
// Moi anh deu qua: tran dung luong -> kiem magic bytes -> Sharp co gioi han pixel -> ghi .part -> rename nguyen tu.
// Khong gia tri nao tu Drive (ten file, id) duoc dung de dat ten/duong dan tren dia.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

sharp.concurrency(1); // VPS 2 GB: moi lan chi 1 luong giai ma/ma hoa

export const VARIANTS = [{ name: 'sm', width: 480 }, { name: 'lg', width: 1400 }];
const HOUR_MS = 3_600_000;
const CODE = /^[A-Z][A-Z0-9_]{1,60}$/;
const codeError = (code) => Object.assign(new Error(code), { code });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function looksLikeImage(b) {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(PNG);
  const webp = b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

const defaultFreeDisk = async (dir) => { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); };
const pause = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
const exists = (p) => stat(p).then(() => true, () => false);

/** Xoa *.part cu trong <dir>/tmp (worker chet giua chung de lai). Tra ve so file da xoa. */
export async function cleanStaleParts(dir, { maxAgeMs = HOUR_MS, now = Date.now() } = {}) {
  const tmp = path.join(dir, 'tmp');
  let names;
  try { names = await readdir(tmp); } catch { return 0; }
  let removed = 0;
  for (const name of names.filter((x) => x.endsWith('.part'))) {
    const file = path.join(tmp, name);
    try { if (now - (await stat(file)).mtimeMs > maxAgeMs) { await rm(file, { force: true }); removed++; } } catch { /* file vua bi nguoi khac xoa */ }
  }
  return removed;
}

async function download(client, imageId, part, { maxBytes, signal }) {
  const res = await client.openMedia(imageId, { signal });
  res.data.on('error', () => {}); // loi tre cua undici ('terminated') sau khi ta da huy khong duoc thanh uncaughtException
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { res.data.destroy(); throw codeError('PREVIEW_TOO_LARGE'); }
  let size = 0, tooBig = false;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) { tooBig = true; return cb(codeError('PREVIEW_TOO_LARGE')); }
      cb(null, chunk);
    },
  });
  try { await pipeline(res.data, limit, createWriteStream(part), { signal }); }
  catch (e) { throw tooBig ? codeError('PREVIEW_TOO_LARGE') : e; } // loi nguon co the toi truoc loi cua ta
  return size;
}

export async function checkMagic(part) {
  const fh = await open(part, 'r');
  try { const buf = Buffer.alloc(12); const { bytesRead } = await fh.read(buf, 0, 12, 0); if (!looksLikeImage(buf.subarray(0, bytesRead))) throw codeError('PREVIEW_INVALID'); }
  finally { await fh.close(); }
}

export async function makeVariants(part, dir, maxPixels) {
  const out = {};
  for (const v of VARIANTS) {
    let data, info;
    try {
      ({ data, info } = await sharp(part, { limitInputPixels: maxPixels, failOn: 'error' })
        .rotate().resize({ width: v.width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true }));
    } catch (e) { throw codeError(/pixel limit/i.test(e?.message) ? 'PREVIEW_TOO_LARGE' : 'PREVIEW_INVALID'); }
    const hash = createHash('sha256').update(data).digest('hex');
    const final = path.join(dir, `${hash}.webp`);
    if (!(await exists(final))) {
      const tmp = path.join(dir, 'tmp', `${randomUUID()}.part`);
      try { await writeFile(tmp, data); } catch (e) { await rm(tmp, { force: true }); throw e; }
      await rename(tmp, final); // nguyen tu: file cuoi chi xuat hien khi da ghi du
    }
    out[v.name] = { path: `${hash}.webp`, sha256: hash, fileSize: data.length, width: info.width, height: info.height };
  }
  return out;
}

/**
 * @param images [{ imageId, md5, primary }] (ke hoach cua diff)
 * @returns {done, results, errors} | {status:'CANCELLED'} | {interrupted:true} | {leaseLost:true}; nem DISK_SPACE_LOW.
 */
export async function runPreviewStage({
  pool, client, job, images, checkpoint = {}, ctx, previewDir, minFreeDiskBytes = 2 * 1024 ** 3,
  concurrency = 2, delayMs = 0, cooldownMs = 600_000, maxBytes = 20 * 1024 * 1024, maxPixels = 40_000_000, diskCheckEvery = 100, freeDiskBytes = defaultFreeDisk,
}) {
  const tmpDir = path.join(previewDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const state = checkpoint.previews ?? { results: {}, failed: {}, bytes: 0, baseErrors: Number(job.error_count) || 0, baseBytes: Number(job.bytes_downloaded) || 0 };
  const unique = [...new Map(images.map((i) => [i.imageId, i])).values()];

  const finished = async (id) => {
    const r = state.results[id];
    return Boolean(r) && (await Promise.all(VARIANTS.map((v) => exists(path.join(previewDir, r[v.name].path))))).every(Boolean);
  };
  const todo = [];
  for (const img of unique) if (!(await finished(img.imageId))) todo.push(img);

  let leaseLost = false, saving = Promise.resolve();
  const persist = () => {
    saving = saving.then(async () => {
      if (leaseLost) return;
      const ok = await ctx.saveProgress({
        stage: 'DOWNLOADING_PREVIEWS', bytesDownloaded: state.baseBytes + state.bytes,
        counters: { errorCount: state.baseErrors + Object.keys(state.failed).length },
        checkpoint: { ...checkpoint, stage: 'DOWNLOADING_PREVIEWS', previews: state },
      });
      if (!ok) leaseLost = true;
    });
    return saving;
  };

  async function processOne(img) {
    const part = path.join(tmpDir, `${randomUUID()}.part`);
    try {
      let received;
      for (;;) {
        try { received = await download(client, img.imageId, part, { maxBytes, signal: ctx.signal }); break; }
        catch (e) {
          if (e?.code !== 'DRIVE_QUOTA_EXCEEDED' || ctx.signal?.aborted) throw e;
          await pause(cooldownMs, ctx.signal); // Google chan tam thoi: nghi roi thu lai chinh anh nay, khong ghi la loi cua anh
          if (ctx.signal?.aborted) throw e;
        }
      }
      state.bytes += received; // cong SAU khi cho xong: `x += await f()` doc x truoc, nen 2 anh tai chong nhau lam mat mot lan cong
      await checkMagic(part);
      const variants = await makeVariants(part, previewDir, maxPixels);
      state.results[img.imageId] = { sourceMd5: img.md5 ?? null, ...variants };
      delete state.failed[img.imageId];
    } catch (e) {
      if (ctx.signal?.aborted) throw e; // dung chu dong (huy / shutdown / mat lease), khong phai loi cua anh
      const code = CODE.test(e?.code ?? '') ? e.code : 'PREVIEW_INVALID';
      state.failed[img.imageId] = code;
      await pool.query(
        `insert into drive_sync_job_items (job_id, drive_file_id, action, status, error_code) values ($1, $2, 'PREVIEW', 'FAILED', $3)
         on conflict (job_id, drive_file_id, action) do update set status = 'FAILED', error_code = excluded.error_code`, [job.id, img.imageId, code]);
    } finally { await rm(part, { force: true }); }
    await persist();
  }

  // Kiem truoc khi khoi dong worker: neu khong, worker thu hai co the da tai mot anh truoc khi loi duoc phat hien.
  if (todo.length && (await freeDiskBytes(previewDir)) < minFreeDiskBytes) throw codeError('DISK_SPACE_LOW');
  let next = 0, stop = null, fatal = null;
  async function worker() {
    while (!fatal && !stop) {
      stop = ctx.cancelled ? 'cancelled' : ctx.shuttingDown ? 'interrupted' : leaseLost ? 'leaseLost' : null;
      if (stop) return;
      const i = next++;
      if (i >= todo.length) return;
      try {
        if (i > 0 && i % diskCheckEvery === 0 && (await freeDiskBytes(previewDir)) < minFreeDiskBytes) throw codeError('DISK_SPACE_LOW');
        await processOne(todo[i]);
        if (delayMs > 0 && next < todo.length) await pause(delayMs, ctx.signal); // gian cach de Drive khong chan tai hang loat
      } catch (e) {
        if (ctx.signal?.aborted && !fatal) { stop ||= ctx.cancelled ? 'cancelled' : ctx.shuttingDown ? 'interrupted' : 'leaseLost'; return; }
        fatal ||= e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await persist();
  if (fatal) throw fatal;
  if (leaseLost || stop === 'leaseLost') return { leaseLost: true };
  if (stop === 'cancelled') return { status: 'CANCELLED' };
  if (stop === 'interrupted') return { interrupted: true };
  return { done: true, results: state.results, errors: Object.entries(state.failed).map(([imageId, code]) => ({ imageId, code })) };
}
