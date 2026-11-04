// Giai doan COMPARING (D29): so anh chup Drive (drive_inventory cua job nay) voi catalog. CHI DOC, khong ghi gi.
// Drive chi cung cap FILE NEN (.zip/.rar/.7z); anh tren Drive bi bo qua hoan toan. Ghep cap theo stem (worker/stem.js), khong theo thu muc.
// Hai file nen cung stem = mo ho -> muc "can duyet", khong ghep. Publish (publish.js) ap dung ke hoach trong 1 transaction.
import { createHash } from 'node:crypto';
import { ARCHIVE, displayName, normalizeStem } from './stem.js';

const toDbPath = (p) => (p ? p.split('/').join(' / ') : 'Uncategorized');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const fingerprint = (kind, path, parts) => createHash('sha256').update([kind, path, ...[...parts].sort()].join('\n')).digest('hex');
const num = (v) => (v === null || v === undefined ? null : Number(v));

export async function computeDiff(pool, { sourceId, jobId }) {
  const job = await pool.query('select checkpoint from drive_sync_jobs where id = $1 and source_id = $2', [jobId, sourceId]);
  // last_seen_job_id chi dang tin khi lan quet da xong; quet do thi "mat" se bi danh dau nham hang loat.
  if (job.rows[0]?.checkpoint?.scan?.done !== true) throw Object.assign(new Error('SCAN_NOT_COMPLETE'), { code: 'SCAN_NOT_COMPLETE' });

  const inv = (await pool.query(
    `select drive_file_id, path, filename, size_bytes, md5_checksum, is_folder, is_shortcut
       from drive_inventory where source_id = $1 and last_seen_job_id = $2`, [sourceId, jobId])).rows;
  const seen = new Set(inv.map((r) => r.drive_file_id));

  const folders = new Set(), byStem = new Map();
  let skipped = 0;
  for (const r of inv) {
    if (r.is_folder) { folders.add(toDbPath(r.path)); continue; }
    if (r.is_shortcut) continue;
    if (!ARCHIVE.test(r.filename)) { skipped++; continue; } // anh va file khac tren Drive: bo qua (D29)
    const stem = normalizeStem(r.filename);
    if (!stem) { skipped++; continue; }
    const f = { id: r.drive_file_id, name: r.filename, size: num(r.size_bytes), md5: r.md5_checksum, type: r.filename.match(/\.([^.]+)$/)[1].toLowerCase(), dir: dirOf(r.path) };
    (byStem.get(stem) ?? byStem.set(stem, []).get(stem)).push(f);
  }

  const existing = new Map(); // drive_file_id -> hang file/model hien co
  for (const r of (await pool.query(
    `select m.id as model_id, m.stem, m.missing_scans, f.drive_file_id, f.filename, f.size_bytes, f.md5_checksum, dc.full_path as drive_path
       from model_files f join models m on m.id = f.model_id left join categories dc on dc.id = m.drive_category_id
      where f.source_id = $1`, [sourceId])).rows) existing.set(r.drive_file_id, r);

  const plan = { archives: [], folders: [...folders].sort(), missing: [], recovered: [], reviews: [] };
  for (const [stem, files] of [...byStem].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (files.length > 1) {
      const names = files.map((f) => f.name);
      const path = files.map((f) => f.dir).sort()[0];
      plan.reviews.push({ kind: 'AMBIGUOUS_PAIR', payload: { path, files: names, fingerprint: fingerprint('AMBIGUOUS_PAIR', path, [stem, ...names]) } });
      continue;
    }
    const [file] = files;
    const ex = existing.get(file.id);
    const categoryPath = toDbPath(file.dir);
    let action = 'NEW';
    if (ex) {
      action = 'UNCHANGED';
      const changed = ex.filename !== file.name || ex.stem !== stem || ex.drive_path !== categoryPath
        || (ex.md5_checksum && file.md5 && ex.md5_checksum !== file.md5) || (ex.size_bytes !== null && file.size !== null && num(ex.size_bytes) !== file.size)
        || (ex.md5_checksum === null && file.md5) || (ex.size_bytes === null && file.size !== null);
      if (changed) action = 'MODIFIED';
      if (ex.missing_scans > 0) plan.recovered.push(ex.model_id);
    }
    plan.archives.push({ action, stem, name: displayName(file.name), categoryPath, file });
  }

  const missing = new Set();
  for (const r of existing.values()) if (!seen.has(r.drive_file_id)) missing.add(r.model_id);
  plan.missing = [...missing];

  const count = (a) => plan.archives.filter((m) => m.action === a).length;
  plan.counters = {
    newCount: count('NEW'), updatedCount: count('MODIFIED'), unchangedCount: count('UNCHANGED'),
    missingCount: plan.missing.length, reviewCount: plan.reviews.length, skippedCount: skipped,
  };
  return plan;
}
