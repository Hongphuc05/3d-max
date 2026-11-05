// Giai doan COMPARING: doi chieu snapshot file nen ZIP/RAR/7Z voi model va preview tren VPS. Anh Drive bi bo qua.
// FULL dung snapshot vua quet; INCREMENTAL dung snapshot FULL thanh cong gan nhat va bo qua phat hien file mat.
// Ghep cap theo stem (worker/stem.js), khong theo thu muc. Publish ap dung ke hoach trong mot transaction.
// Hai file nen cung stem = mo ho -> muc "can duyet", khong ghep. Publish (publish.js) ap dung ke hoach trong 1 transaction.
import { createHash } from 'node:crypto';
import { displayName, normalizeStem } from './stem.js';

const toDbPath = (p) => (p ? p.split('/').join(' / ') : 'Uncategorized');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const fingerprint = (kind, path, parts) => createHash('sha256').update([kind, path, ...[...parts].sort()].join('\n')).digest('hex');
const num = (v) => (v === null || v === undefined ? null : Number(v));

export async function computeDiff(pool, { sourceId, jobId, includeDriveTree = true, detectMissing = true }) {
  const job = await pool.query('select checkpoint from drive_sync_jobs where id = $1 and source_id = $2', [jobId, sourceId]);
  // last_seen_job_id chi dang tin khi lan quet da xong; quet do thi "mat" se bi danh dau nham hang loat.
  if (job.rows[0]?.checkpoint?.scan?.done !== true) throw Object.assign(new Error('SCAN_NOT_COMPLETE'), { code: 'SCAN_NOT_COMPLETE' });

  const snapshot = await pool.query('select 1 from drive_archive_snapshot_runs where source_id = $1 and job_id = $2', [sourceId, jobId]);
  if (!snapshot.rowCount) throw Object.assign(new Error('SCAN_NOT_COMPLETE'), { code: 'SCAN_NOT_COMPLETE' });
  const inv = (await pool.query(
    `select drive_file_id, path, filename, size_bytes, md5_checksum, file_type
       from drive_archive_snapshot_files where job_id = $1 order by drive_file_id`, [jobId])).rows;
  const seen = new Set(inv.map((r) => r.drive_file_id));

  const folders = new Set(includeDriveTree ? (await pool.query(
    `select path from drive_inventory where source_id = $1 and last_seen_job_id = $2 and is_folder`, [sourceId, jobId])).rows.map((r) => toDbPath(r.path)) : []);
  const skipped = includeDriveTree ? Number((await pool.query(
    `select count(*)::int n from drive_inventory
      where source_id = $1 and last_seen_job_id = $2 and not is_folder and not is_shortcut
        and not (right(lower(filename), 4) in ('.zip', '.rar') or right(lower(filename), 3) = '.7z')`, [sourceId, jobId])).rows[0].n) : 0;
  const byStem = new Map();
  for (const r of inv) {
    const stem = normalizeStem(r.filename);
    if (!stem) continue;
    const f = { id: r.drive_file_id, name: r.filename, size: num(r.size_bytes), md5: r.md5_checksum, type: r.file_type, dir: dirOf(r.path) };
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
  if (detectMissing) for (const r of existing.values()) if (!seen.has(r.drive_file_id)) missing.add(r.model_id);
  plan.missing = [...missing];

  const count = (a) => plan.archives.filter((m) => m.action === a).length;
  plan.counters = {
    newCount: count('NEW'), updatedCount: count('MODIFIED'), unchangedCount: count('UNCHANGED'),
    missingCount: plan.missing.length, reviewCount: plan.reviews.length, skippedCount: skipped,
  };
  return plan;
}
