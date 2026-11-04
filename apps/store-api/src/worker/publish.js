// Giai doan PUBLISHING (D29): ap dung ke hoach (file nen tu Drive) vao catalog trong MOT transaction.
// Loi giua chung -> rollback -> catalog giu nguyen. Model chi len catalog cong khai khi DU anh + file nen (xem catalog-v1/manifest.js).
import { refreshCatalogState } from '../catalog-v1/manifest.js';
import { createCategoryResolver } from './categories.js';

/**
 * @param plan ket qua computeDiff (tinh LAI ngay truoc khi publish)
 * @returns { version, changed, created, updated }
 */
export async function publishPlan(pool, { sourceId, jobId = null, plan }) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select 1 from catalog_state where id = 1 for update'); // tuan tu hoa cac lan publish
    const categories = createCategoryResolver(c);
    const catIds = new Map();
    const cat = async (p) => catIds.get(p) ?? catIds.set(p, await categories.resolve(p.split(' / '))).get(p);
    let created = 0, updated = 0;

    for (const p of plan.folders ?? []) if (p !== 'Uncategorized') await cat(p); // cay danh muc = cay thu muc Drive (de admin co cho tai anh)

    for (const e of plan.archives) {
      const dbCat = await cat(e.categoryPath);
      const f = e.file;
      let fileRow = (await c.query(
        `select f.id, f.model_id, m.stem from model_files f join models m on m.id = f.model_id
          where f.source_id = $1 and f.drive_file_id = $2 for update of m`, [sourceId, f.id])).rows[0];
      let model = (await c.query('select * from models where stem = $1 for update', [e.stem])).rows[0];

      if (fileRow && fileRow.stem !== null && fileRow.stem !== e.stem) { // doi ten tren Drive: file roi khoi model cu (model cu mat cap, khong bi xoa)
        await c.query('delete from model_files where id = $1', [fileRow.id]);
        fileRow = undefined;
      }
      if (fileRow && model && model.id !== fileRow.model_id) continue; // stem da thuoc model khac: de nguyen, khong ghep chong
      if (fileRow) model = (await c.query('select * from models where id = $1', [fileRow.model_id])).rows[0];

      let fileId = fileRow?.id;
      if (!model) {
        model = (await c.query(
          `insert into models (category_id, drive_category_id, name, status, stem, published_at) values ($1, $1, $2, 'PUBLISHED', $3, now()) returning *`,
          [dbCat, e.name, e.stem])).rows[0];
        created++;
      } else if (!fileRow && model.primary_file_id) { // model da co file nen khac (file cu da bien mat khoi Drive): thay bang file moi
        await c.query('delete from model_files where id = $1', [model.primary_file_id]);
      }
      if (!fileId) {
        fileId = (await c.query(
          `insert into model_files (model_id, source_id, drive_file_id, filename, file_type, size_bytes, md5_checksum) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [model.id, sourceId, f.id, f.name, f.type, f.size, f.md5])).rows[0].id;
      } else {
        // md5/size chi duoc dien them, khong bao gio ghi de gia tri da biet bang NULL; noi dung doi thi sha256 cu het gia tri.
        await c.query(
          `update model_files set filename = $2, file_type = $3, size_bytes = coalesce($4, size_bytes), md5_checksum = coalesce($5, md5_checksum),
                  sha256 = case when (md5_checksum is not null and $5::text is not null and md5_checksum <> $5) or (size_bytes is not null and $4::bigint is not null and size_bytes <> $4) then null else sha256 end
            where id = $1`, [fileId, f.name, f.type, f.size, f.md5]);
        if (e.action === 'MODIFIED') updated++;
      }
      // Co anh roi thi danh muc = danh muc cua anh (chi ghi nhan Drive o drive_category_id); chua co anh thi theo Drive.
      await c.query(
        `with t as (select case when exists(select 1 from model_previews p where p.model_id = $1 and p.is_primary) then category_id else $4::uuid end as cat from models where id = $1)
         update models m set stem = $2, primary_file_id = $3, drive_category_id = $4, category_id = t.cat, missing_scans = 0, updated_at = now() from t
          where m.id = $1 and (m.stem, m.primary_file_id, m.drive_category_id, m.category_id, m.missing_scans) is distinct from ($2::text, $3::uuid, $4::uuid, t.cat, 0)`,
        [model.id, e.stem, fileId, dbCat]);
    }

    if (plan.missing?.length) await c.query('update models set missing_scans = missing_scans + 1 where id = any($1::uuid[])', [plan.missing]);
    if (plan.recovered?.length) await c.query('update models set missing_scans = 0 where id = any($1::uuid[])', [plan.recovered]);

    for (const r of plan.reviews) {
      // Cung fingerprint da co (ke ca da DISMISS/RESOLVED): khong mo lai moi lan quet.
      const dup = await c.query("select 1 from review_items where source_id = $1 and payload->>'fingerprint' = $2", [sourceId, r.payload.fingerprint]);
      if (dup.rowCount) continue;
      await c.query('insert into review_items (source_id, kind, payload) values ($1, $2, $3::jsonb)', [sourceId, r.kind, JSON.stringify(r.payload)]);
    }

    const state = await refreshCatalogState(c, { jobId });
    await c.query('commit');
    return { version: state.version, changed: state.changed, created, updated };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
