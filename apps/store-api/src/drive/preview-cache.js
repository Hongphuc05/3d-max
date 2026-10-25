import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DriveError } from './provider.js';

const validName = /^[a-f0-9]{64}\.webp$/;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const fail = code => Object.assign(new Error(code), { code, status: 502 });

// Only this small storage interface depends on the filesystem. It can be replaced
// by object storage; model rows contain opaque keys rather than absolute paths.
export class FilePreviewStorage {
  constructor(directory, minAgeMs = 3600000) { this.directory = path.resolve(directory); this.minAgeMs = minAgeMs; }
  resolve(key) {
    if (!validName.test(key || '')) throw fail('PREVIEW_INVALID_PATH');
    return path.join(this.directory, key);
  }
  async exists(key) { try { return (await stat(this.resolve(key))).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  async put(key, bytes) {
    await mkdir(this.directory, { recursive: true });
    const destination = this.resolve(key), staging = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
    try { await writeFile(staging, bytes, { flag: 'wx' }); await rename(staging, destination); }
    finally { await rm(staging, { force: true }); }
  }
  async cleanup(references) {
    const keep = new Set(references);
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (validName.test(name) && !keep.has(name) && Date.now() - (await stat(this.resolve(name))).mtimeMs >= this.minAgeMs) await rm(this.resolve(name), { force: true });
    }
  }
}

export class PreviewCache {
  constructor({ directory, provider, cleanupGraceMs = 3600000, storage = new FilePreviewStorage(directory, cleanupGraceMs), maxBytes = 20 * 1024 * 1024, maxPixels = 40_000_000 }) {
    Object.assign(this, { provider, storage, maxBytes, maxPixels });
  }
  resolve(key) { return this.storage.resolve(key); }
  cleanup(references) { return this.storage.cleanup(references); }
  async prepare(model,{signal} = {}) {
    const preview = model.preview;
    if (!preview) return { cachedPreviewPath: null, previewVersion: null, previewUpdated: false };
    if (!mimeTypes.has(preview.mimeType)) throw fail('PREVIEW_INVALID_MIME');
    const version = createHash('sha256').update(JSON.stringify([preview.id, preview.md5Checksum || null, preview.modifiedTime || null, preview.size || null])).digest('hex');
    const key = `${version}.webp`;
    if (await this.storage.exists(key)) return { cachedPreviewPath: key, previewVersion: version, previewUpdated: false };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    const timer = setTimeout(() => controller.abort(), 60000);
    let stream;
    try {
      const result = await this.provider.openDownload(preview, { signal: controller.signal });
      stream = result.data;
      controller.signal.addEventListener('abort',()=>stream.destroy(fail('PREVIEW_TIMEOUT')),{once:true});
      const type = (result.headers?.get?.('content-type') || result.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!mimeTypes.has(type)) throw fail('PREVIEW_INVALID_MIME');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > this.maxBytes) throw fail('PREVIEW_TOO_LARGE');
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (preview.size && BigInt(preview.size) !== BigInt(buffer.length)) throw fail('PREVIEW_SIZE_MISMATCH');
      if (preview.md5Checksum && createHash('md5').update(buffer).digest('hex') !== preview.md5Checksum) throw fail('PREVIEW_CHECKSUM_MISMATCH');
      const image = sharp(buffer, { limitInputPixels: this.maxPixels, failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw fail('PREVIEW_INVALID_IMAGE');
      const output = await image.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      await this.storage.put(key, output);
      return { cachedPreviewPath: key, previewVersion: version, previewUpdated: true };
    } catch (error) {
      if(error instanceof DriveError)throw Object.assign(new DriveError(error.code,error.status),{sourceFileId:preview.id});
      throw error.code?.startsWith('PREVIEW_') ? error : fail('PREVIEW_DOWNLOAD_OR_IMAGE_INVALID');
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); stream?.destroy(); controller.abort(); }
  }
}
