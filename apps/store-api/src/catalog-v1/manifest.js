// Catalog cong khai (contract v3 §2.3). Mot nguon su that cho: publish (tinh checksum) va API khach (doc catalog).
// Chi chon CAC COT CONG KHAI: khong Drive id, khong duong dan nguon, khong sha256 cua file model.
import { createHash } from 'node:crypto';

export const CATALOG_CHANNEL = 'catalog_v1';

/** Chay fn trong 1 snapshot nhat quan (REPEATABLE READ, chi doc) de version + du lieu khong lech nhau. */
export async function withSnapshot(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    try { return await fn(c); } finally { await c.query('rollback'); }
  } finally { c.release(); }
}

export async function readCatalogState(db) {
  const r = await db.query('select active_version, manifest_checksum, published_at from catalog_state where id = 1');
  const row = r.rows[0];
  return { version: Number(row.active_version), checksum: row.manifest_checksum, publishedAt: row.published_at };
}

/** @param db pg client/pool; goi trong snapshot hoac trong transaction publish. */
export async function buildManifest(db) {
  const cats = (await db.query('select id, parent_id, name, full_path from categories')).rows;
  const models = (await db.query(
    `select m.id, m.name, m.category_id, coalesce(f.size_bytes, 0) as size_bytes, f.file_type
       from models m join model_files f on f.id = m.primary_file_id
      where m.status = 'PUBLISHED' order by m.id`)).rows;
  const previews = (await db.query(
    `select p.model_id, p.variant, p.local_path, p.sha256, p.version, p.file_size, p.width, p.height
       from model_previews p join models m on m.id = p.model_id
      where m.status = 'PUBLISHED' and p.is_primary order by p.model_id, p.variant`)).rows;

  // modelCount tinh ca danh muc con: danh muc cha hien so model cua ca nhanh.
  const own = new Map();
  for (const m of models) own.set(m.category_id, (own.get(m.category_id) ?? 0) + 1);
  const children = new Map();
  for (const c of cats) (children.get(c.parent_id) ?? children.set(c.parent_id, []).get(c.parent_id)).push(c.id);
  const total = (id) => (own.get(id) ?? 0) + (children.get(id) ?? []).reduce((n, child) => n + total(child), 0);

  const out = {
    categories: cats.map((c) => ({ id: c.id, parentId: c.parent_id, name: c.name, fullPath: c.full_path, modelCount: total(c.id) }))
      .filter((c) => c.modelCount > 0).sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0)),
    models: models.map((m) => ({ id: m.id, name: m.name, categoryId: m.category_id, sizeBytes: Number(m.size_bytes), fileType: m.file_type, status: 'PUBLISHED' })),
    previews: previews.map((p) => ({ modelId: p.model_id, variant: p.variant, url: `/previews/${p.local_path}`, sha256: p.sha256, version: p.version, fileSize: p.file_size, width: p.width, height: p.height })),
  };
  out.checksum = createHash('sha256').update(JSON.stringify({ categories: out.categories, models: out.models, previews: out.previews })).digest('hex');
  return out;
}

/**
 * Tinh lai manifest va CHI tang active_version khi no doi (nhin tu phia khach). Phai goi trong transaction
 * dang giu khoa catalog_state. Admin sua ten/gia (P3) cung goi ham nay de plugin thay ban cap nhat.
 */
export async function refreshCatalogState(c, { jobId = null } = {}) {
  const state = (await c.query('select active_version, manifest_checksum from catalog_state where id = 1 for update')).rows[0];
  const manifest = await buildManifest(c);
  const first = state.manifest_checksum === null;
  if (manifest.checksum === state.manifest_checksum || (first && manifest.models.length === 0)) {
    return { changed: false, version: Number(state.active_version), checksum: state.manifest_checksum };
  }
  const r = await c.query(
    `update catalog_state set active_version = active_version + 1, manifest_checksum = $1, published_at = now(), published_by_job = $2
      where id = 1 returning active_version`, [manifest.checksum, jobId]);
  const version = Number(r.rows[0].active_version);
  // NOTIFY duoc giu den luc COMMIT: rollback thi khong ai nhan duoc; tien trinh API (khac tien trinh worker) nghe kenh nay.
  await c.query('select pg_notify($1, $2)', [CATALOG_CHANNEL, String(version)]);
  return { changed: true, version, checksum: manifest.checksum };
}
