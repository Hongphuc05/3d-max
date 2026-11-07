// Explicit maintenance task: copy first, verify bytes, then update references. Old flat URLs remain valid.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadWorkerConfig } from '../src/worker/config.js';
import { refreshCatalogState } from '../src/catalog-v1/manifest.js';

const FLAT = /^[0-9a-f]{64}\.webp$/;
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function relocateLegacyPreviews({ pool, previewDir, apply = false }) {
  const rows = (await pool.query(`select p.id, p.local_path, p.sha256 from model_previews p
    join models m on m.id=p.model_id where m.content_domain='3dmodels' and p.local_path !~ '/' order by p.id`)).rows;
  for (const row of rows) if (!FLAT.test(row.local_path) || row.local_path !== `${row.sha256}.webp`) throw new Error('UNSAFE_LEGACY_PREVIEW_PATH');
  if (!apply) return { references: rows.length, blobs: new Set(rows.map(r => r.local_path)).size, applied: false };
  const targetDir = path.join(previewDir, '3dmodels');
  await mkdir(path.join(targetDir, 'tmp'), { recursive: true });
  for (const row of new Map(rows.map(r => [r.local_path, r])).values()) {
    const target = path.join(targetDir, row.local_path);
    const present = await stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (present) {
      if (await digest(target) !== row.sha256) throw new Error('PREVIEW_HASH_MISMATCH');
      continue;
    }
    const temp = path.join(targetDir, 'tmp', `${randomUUID()}.part`);
    try {
      await copyFile(path.join(previewDir, row.local_path), temp);
      if (await digest(temp) !== row.sha256) throw new Error('PREVIEW_HASH_MISMATCH');
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
  }
  const c = await pool.connect();
  let updated = 0;
  try {
    await c.query('begin');
    await c.query('select 1 from catalog_state where id=1 for update');
    for (const row of rows) updated += (await c.query(`update model_previews p set local_path='3dmodels/' || p.local_path
      from models m where m.id=p.model_id and m.content_domain='3dmodels' and p.id=$1 and p.local_path=$2 and p.sha256=$3`,
    [row.id, row.local_path, row.sha256])).rowCount;
    await refreshCatalogState(c);
    await c.query('commit');
  } catch (error) { await c.query('rollback'); throw error; }
  finally { c.release(); }
  return { references: updated, blobs: new Set(rows.map(r => r.local_path)).size, applied: true };
}

if (process.argv[1] === import.meta.filename) {
  const { pool } = await import('../src/db.js');
  try {
    console.log(JSON.stringify(await relocateLegacyPreviews({ pool, previewDir: loadWorkerConfig().previewDir, apply: process.argv.includes('--apply') })));
  } catch (error) { console.error('Preview relocation failed:', /^[A-Z_]+$/.test(error.message) ? error.message : error.code ?? 'FILESYSTEM_ERROR'); process.exitCode = 1; }
  finally { await pool.end(); }
}
