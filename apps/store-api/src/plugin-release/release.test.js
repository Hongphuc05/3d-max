import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createReleaseReader, readZipEntry } from './release.js';
import { createPluginReleaseRouter } from './routes.js';

// Zip toi thieu (CRC=0: reader khong kiem CRC) de khong them dependency cho test.
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const { name, data, deflate } of entries) {
    const n = Buffer.from(name), body = deflate ? deflateRawSync(data) : data, method = deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body); central.push(ch, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('reads version.txt (stored and deflated) and reports sha256/size', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rel-'));
  try {
    for (const deflate of [false, true]) {
      const file = path.join(dir, `p${deflate}.mzp`);
      const buf = zip([{ name: 'mzp.run', data: Buffer.from('x') }, { name: 'version.txt', data: Buffer.from('1.5.0\n'), deflate }]);
      await writeFile(file, buf);
      assert.deepEqual(await createReleaseReader({ file })(), { version: '1.5.0', sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects garbage version, non-zip; missing file is null', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rel-'));
  try {
    const bad = path.join(dir, 'bad.mzp');
    await writeFile(bad, zip([{ name: 'version.txt', data: Buffer.from('../evil') }]));
    await assert.rejects(createReleaseReader({ file: bad })(), /invalid version/);
    await writeFile(bad, 'not a zip');
    await assert.rejects(readZipEntry(bad, 'version.txt'), /not a zip/);
    assert.equal(await createReleaseReader({ file: path.join(dir, 'none.mzp') })(), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('route: 200 with release, 503 PLUGIN_RELEASE_NOT_FOUND when absent', async () => {
  for (const [latest, status] of [[async () => ({ version: '1.5.0', sha256: 'a', size: 1 }), 200], [async () => null, 503]]) {
    const app = express().use('/api/v1', createPluginReleaseRouter({ latest }));
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/plugin/latest`);
      assert.equal(res.status, status);
      const body = await res.json();
      if (status === 200) assert.equal(body.version, '1.5.0'); else assert.equal(body.error.code, 'PLUGIN_RELEASE_NOT_FOUND');
    } finally { server.close(); }
  }
});
