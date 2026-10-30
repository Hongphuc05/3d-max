// Nap catalog cu (library/public/catalog.json) vao PostgreSQL: categories, models (legacy_id), model_files.
// Chay lai khong nhan doi, khong ghi de thu admin da sua. Khong copy anh (preview do worker sinh lai).
import { createCategoryResolver } from './categories.js';

const LEGACY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
const ARCHIVE_EXT = /\.(rar|zip|7z)$/i;


// Loi chi nem "item #n": khong bao gio dua Drive id hay duong dan vao thong bao.
function clean(raw, n) {
  const bad = (why) => new Error(`catalog item #${n}: ${why}`);
  if (!raw || typeof raw !== 'object') throw bad('not an object');
  const id = typeof raw.id === 'string' ? raw.id : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const parts = typeof raw.category === 'string' ? raw.category.split(' / ').map((p) => p.trim()) : [];
  if (!LEGACY_ID.test(id)) throw bad('invalid id');
  if (name.length < 1 || name.length > 300) throw bad('invalid name');
  if (!parts.length || parts.length > 4 || parts.some((p) => !p || p.length > 200)) throw bad('invalid category');
  if (!DRIVE_ID.test(raw.driveFileId ?? '')) throw bad('invalid drive file id');
  if (!SHA256.test(raw.sha256 ?? '')) throw bad('invalid sha256');
  const ext = fileName.match(ARCHIVE_EXT);
  if (!ext) throw bad('unsupported file extension');
  const entry = typeof raw.entryFile === 'string' && raw.entryFile.trim() ? raw.entryFile.trim().slice(0, 500) : null;
  return { id, name, parts, driveFileId: raw.driveFileId, fileName, fileType: ext[1].toLowerCase(), sha256: raw.sha256.toLowerCase(), entry };
}

/**
 * @param pool pg Pool. Mot transaction duy nhat: loi o bat ky muc nao thi khong ghi gi.
 * @returns {categories, models:{inserted,existing}, files} - so dong MOI tao.
 */
export async function seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd }) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  if (!Number.isInteger(defaultPriceVnd) || defaultPriceVnd < 0) throw new Error('default price must be a non-negative integer');
  const rows = items.map((it, i) => clean(it, i + 1));
  for (const key of ['id', 'driveFileId']) {
    const seen = new Set();
    rows.forEach((r, i) => { if (seen.has(r[key])) throw new Error(`catalog item #${i + 1}: duplicate ${key === 'id' ? 'id' : 'drive file id'}`); seen.add(r[key]); });
  }

  const c = await pool.connect();
  try {
    await c.query('begin');
    if (!(await c.query('select 1 from drive_sources where id = $1', [sourceId])).rowCount) throw new Error('source not found');

    const out = { categories: 0, models: { inserted: 0, existing: 0 }, files: 0 };
    const categories = createCategoryResolver(c);

    for (const r of rows) {
      const categoryId = await categories.resolve(r.parts);
      const ins = await c.query(
        `insert into models (legacy_id, category_id, name, status, price_vnd, published_at)
         values ($1, $2, $3, 'PUBLISHED', $4, now()) on conflict (legacy_id) do nothing returning id`,
        [r.id, categoryId, r.name, defaultPriceVnd]);
      if (!ins.rowCount) { out.models.existing++; continue; } // da co: giu nguyen tat ca (admin co the da sua)
      out.models.inserted++;
      const modelId = ins.rows[0].id;
      const file = await c.query(
        `insert into model_files (model_id, source_id, drive_file_id, filename, file_type, sha256, entry_file)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [modelId, sourceId, r.driveFileId, r.fileName, r.fileType, r.sha256, r.entry]);
      out.files++;
      await c.query('update models set primary_file_id = $1 where id = $2', [file.rows[0].id, modelId]);
    }
    await c.query('commit');
    out.categories = categories.created;
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
