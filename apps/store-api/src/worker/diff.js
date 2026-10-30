// Giai doan COMPARING: so anh chup Drive (drive_inventory cua job nay) voi catalog -> ke hoach NEW/MODIFIED/UNCHANGED/MISSING.
// CHI DOC, khong ghi gi: publish (P2.7) ap dung ke hoach trong 1 transaction nen loi giua chung khong de lai nua vo.
// Danh tinh model = drive_file_id cua file model (Drive giu ID khi doi ten/chuyen thu muc), khop voi model da seed tu catalog cu.
import { createHash } from 'node:crypto';
import { mapFolder } from './mapper.js';

const normStem = (s) => s.replace(/\.[^.]+$/, '').normalize('NFC').replace(/\s+/g, ' ').trim();
const toDbPath = (p) => (p ? p.split('/').join(' / ') : 'Uncategorized');
const fingerprint = (kind, path, parts) => createHash('sha256').update([kind, path, ...[...parts].sort()].join('\n')).digest('hex');
const num = (v) => (v === null || v === undefined ? null : Number(v));

export async function computeDiff(pool, { sourceId, jobId }) {
  const job = await pool.query('select checkpoint from drive_sync_jobs where id = $1 and source_id = $2', [jobId, sourceId]);
  // last_seen_job_id chi dang tin khi lan quet da xong; quet do thi "mat" se bi danh dau nham hang loat.
  if (job.rows[0]?.checkpoint?.scan?.done !== true) throw Object.assign(new Error('SCAN_NOT_COMPLETE'), { code: 'SCAN_NOT_COMPLETE' });

  const inv = (await pool.query(
    `select drive_file_id, parent_drive_id, path, filename, size_bytes, md5_checksum, is_folder, is_shortcut
       from drive_inventory where source_id = $1 and last_seen_job_id = $2`, [sourceId, jobId])).rows;
  const seen = new Set(inv.map((r) => r.drive_file_id));

  const dirs = new Map();
  for (const r of inv) {
    if (r.is_folder || r.is_shortcut) continue;
    const key = r.parent_drive_id ?? '';
    if (!dirs.has(key)) dirs.set(key, { path: r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '', files: [] });
    dirs.get(key).files.push({ id: r.drive_file_id, name: r.filename, size: num(r.size_bytes), md5: r.md5_checksum });
  }

  const existing = new Map(); // drive_file_id -> model/file row
  for (const r of (await pool.query(
    `select m.id as model_id, m.name, m.name_overridden, m.missing_scans, c.full_path, f.drive_file_id, f.filename, f.size_bytes, f.md5_checksum
       from model_files f join models m on m.id = f.model_id join categories c on c.id = m.category_id
      where f.source_id = $1`, [sourceId])).rows) existing.set(r.drive_file_id, r);
  const previewsOf = new Map(); // model_id -> { byImage: Map(id -> md5), primary }
  for (const p of (await pool.query(
    `select p.model_id, p.source_drive_file_id, p.source_md5, p.is_primary from model_previews p
       join model_files f on f.model_id = p.model_id where f.source_id = $1 and p.variant = 'sm'`, [sourceId])).rows) {
    const e = previewsOf.get(p.model_id) ?? previewsOf.set(p.model_id, { byImage: new Map(), primary: null }).get(p.model_id);
    e.byImage.set(p.source_drive_file_id, p.source_md5);
    if (p.is_primary) e.primary = p.source_drive_file_id;
  }

  // File da bien mat nhung con md5+size: ung vien de khop voi file moi (Drive doi ID khi tai len lai).
  const missingByHash = new Map(), missing = [];
  for (const r of existing.values()) {
    if (seen.has(r.drive_file_id)) continue;
    if (!missing.includes(r.model_id)) missing.push(r.model_id);
    if (r.md5_checksum && r.size_bytes !== null) missingByHash.set(`${r.md5_checksum}:${num(r.size_bytes)}`, r);
  }

  const plan = { models: [], previews: [], missing, recovered: [], reviews: [] };
  let skipped = 0;
  const addReview = (kind, path, files, extra = {}) =>
    plan.reviews.push({ kind, payload: { path, files, ...extra, fingerprint: fingerprint(kind, path, [...files, ...Object.values(extra).map(String)]) } });

  for (const dir of [...dirs.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const mapped = mapFolder(dir);
    skipped += mapped.skipped.length;
    for (const r of mapped.reviews) addReview(r.kind, r.path, r.files);

    for (const m of mapped.models) {
      const categoryPath = toDbPath(m.categoryPath);
      const ex = existing.get(m.file.id);
      const entry = { action: 'NEW', modelId: null, name: m.name, categoryPath, status: m.suggested ? 'NEEDS_REVIEW' : 'PUBLISHED', suggested: m.suggested,
        file: m.file, images: m.images, changes: {} };

      if (!ex) {
        const prev = m.file.md5 && m.file.size !== null ? missingByHash.get(`${m.file.md5}:${m.file.size}`) : undefined;
        if (prev) {
          entry.status = 'NEEDS_REVIEW';
          addReview('REMAP_CANDIDATE', dir.path, [m.file.name], { previousModelId: prev.model_id, previousModel: prev.name });
        }
        plan.models.push(entry);
        for (const img of m.images) plan.previews.push({ fileId: m.file.id, imageId: img.id, md5: img.md5, primary: img.primary });
        continue;
      }

      // Model da co: chi bao cao dung phan thay doi.
      entry.modelId = ex.model_id; entry.action = 'UNCHANGED'; entry.status = null;
      const c = entry.changes;
      if ((ex.md5_checksum && m.file.md5 && ex.md5_checksum !== m.file.md5) || (ex.size_bytes !== null && m.file.size !== null && num(ex.size_bytes) !== m.file.size)) c.file = true;
      if ((ex.md5_checksum === null && m.file.md5) || (ex.size_bytes === null && m.file.size !== null)) c.enrich = true; // model seed: chi dien them, khong tinh la thay doi
      if (ex.filename !== m.file.name) {
        c.filename = true;
        if (!ex.name_overridden && normStem(ex.filename) !== normStem(m.file.name)) c.name = m.name; // ten dep da seed khong bi ghi de khi ten file giu nguyen
      }
      if (ex.full_path !== categoryPath) c.category = categoryPath;

      const have = previewsOf.get(ex.model_id) ?? { byImage: new Map(), primary: null };
      const need = m.images.filter((img) => !have.byImage.has(img.id) || (img.md5 && have.byImage.get(img.id) && img.md5 !== have.byImage.get(img.id)));
      const primary = m.images.find((i) => i.primary)?.id ?? null;
      const gone = [...have.byImage.keys()].some((id) => !m.images.some((i) => i.id === id));
      if (need.length || gone || (have.primary !== null && have.primary !== primary)) c.previews = true;
      for (const img of need) plan.previews.push({ fileId: m.file.id, imageId: img.id, md5: img.md5, primary: img.primary });

      if (c.file || c.name || c.filename || c.category || c.previews) entry.action = 'MODIFIED';
      if (ex.missing_scans > 0) plan.recovered.push(ex.model_id);
      plan.models.push(entry);
    }
  }

  const count = (a) => plan.models.filter((m) => m.action === a).length;
  plan.counters = {
    newCount: count('NEW'), updatedCount: count('MODIFIED'), unchangedCount: count('UNCHANGED'),
    missingCount: missing.length, reviewCount: plan.reviews.length, skippedCount: skipped,
  };
  return plan;
}
