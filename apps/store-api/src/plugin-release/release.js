// Phien ban goi cai dat moi nhat: doc version.txt NGAY TRONG file mzp tren VPS, nen version luon khop file that.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const VERSION = /^\d+\.\d+\.\d+([-.][A-Za-z0-9.-]+)?$/;
const MAX_ENTRY = 1024; // version.txt chi vai byte; chan entry bat thuong truoc khi giai nen.

/** Doc 1 entry nho tu zip qua central directory (khong them dependency). shortcut: khong ho tro zip64, mzp < 4GB. */
export async function readZipEntry(file, name) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('not a zip');
    const total = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset + cdSize > size) throw new Error('bad central directory');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    for (let p = 0, i = 0; i < total && p + 46 <= cdSize; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32), local = cd.readUInt32LE(p + 42);
      if (cd.toString('utf8', p + 46, p + 46 + nameLen) === name) {
        if (usize > MAX_ENTRY || csize > MAX_ENTRY) throw new Error('entry too large');
        const lh = Buffer.alloc(30);
        await fh.read(lh, 0, 30, local);
        if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
        const data = Buffer.alloc(csize);
        await fh.read(data, 0, csize, local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data);
        throw new Error('unsupported compression');
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } finally { await fh.close(); }
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

/** Tra ve { version, sha256, size } hoac null neu chua co goi. Cache theo mtime+size nen khong bam lai file lon moi lan goi. */
export function createReleaseReader({ file }) {
  let cached = null;
  return async () => {
    let st;
    try { st = await stat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const key = `${st.mtimeMs}:${st.size}`;
    if (cached?.key === key) return cached.value;
    const raw = await readZipEntry(file, 'version.txt');
    const version = raw?.toString('utf8').trim();
    if (!version || !VERSION.test(version)) throw new Error('invalid version.txt in package');
    const value = { version, sha256: await sha256(file), size: st.size };
    cached = { key, value };
    return value;
  };
}
