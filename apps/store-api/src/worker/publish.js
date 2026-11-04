// Giai doan PUBLISHING: ap dung ke hoach cua diff vao catalog trong MOT transaction.
// Loi giua chung -> rollback -> catalog dang chay (models/previews/version) giu nguyen, khong nua vo.
import { refreshCatalogState } from '../catalog-v1/manifest.js';
import { createCategoryResolver } from './categories.js';

const planStale = () => Object.assign(new Error('PLAN_STALE'), { code: 'PLAN_STALE' });
const VARIANT_NAMES = ['sm', 'lg'];

const usable = (r) => Boolean(r?.sm && r?.lg);

/** Thay hang preview theo anh nguon; giu hang cu khi anh khong tai lai duoc; dat primary. */
async function writePreviews(c, modelId, images, results) {
  await c.query('update model_previews set is_primary = false where model_id = $1 and is_primary', [modelId]);
  await c.query('delete from model_previews where model_id = $1 and not (coalesce(source_drive_file_id, \'\') = any($2::text[]))', [modelId, images.map((i) => i.id)]);
  for (const img of images) {
    const res = results[img.id];
    if (!usable(res)) continue; // khong co ban moi: de nguyen hang cu (neu co)
    const prev = await c.query('select coalesce(max(version), 0) as v from model_previews where model_id = $1 and source_drive_file_id = $2', [modelId, img.id]);
    await c.query('delete from model_previews where model_id = $1 and source_drive_file_id = $2', [modelId, img.id]);
    for (const name of VARIANT_NAMES) {
      const v = res[name];
      await c.query(
        `insert into model_previews (model_id, source, source_drive_file_id, source_md5, local_path, sha256, file_size, width, height, variant, version, is_primary)
         values ($1, 'DRIVE_IMAGE', $2, $3, $4, $5, $6, $7, $8, $9, $10, false)`,
        [modelId, img.id, res.sourceMd5 ?? img.md5 ?? null, v.path, v.sha256, v.fileSize, v.width, v.height, name, Number(prev.rows[0].v) + 1]);
    }
  }
  const primary = images.find((i) => i.primary);
  if (primary) await c.query('update model_previews set is_primary = true where model_id = $1 and source_drive_file_id = $2', [modelId, primary.id]);
}

/**
 * @param plan ket qua computeDiff (tinh LAI ngay truoc khi publish de khong dung ke hoach cu)
 * @param results anh -> { sourceMd5, sm, lg } tu runPreviewStage
 * @returns { version, changed, created, updated }
 */
export async function publishPlan(pool, { sourceId, jobId = null, plan, results = {} }) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select 1 from catalog_state where id = 1 for update'); // tuan tu hoa cac lan publish
    const categories = createCategoryResolver(c);
    const modelOfFile = new Map(); // drive id cua file model -> model id (de gan review)
    let created = 0, updated = 0;

    for (const e of plan.models) {
      if (e.action === 'NEW') {
        const categoryId = await categories.resolve(e.categoryPath.split(' / '));
        const primary = e.images.find((i) => i.primary);
        const status = e.status === 'PUBLISHED' && !usable(results[primary?.id]) ? 'NEEDS_REVIEW' : e.status; // khong cong bo model khong co anh chinh
        const m = await c.query(
          `insert into models (category_id, name, status, published_at) values ($1, $2, $3, case when $3 = 'PUBLISHED' then now() end) returning id`,
          [categoryId, e.name, status]);
        const modelId = m.rows[0].id;
        const f = await c.query(
          `insert into model_files (model_id, source_id, drive_file_id, filename, file_type, size_bytes, md5_checksum) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [modelId, sourceId, e.file.id, e.file.name, e.file.type, e.file.size, e.file.md5]);
        await c.query('update models set primary_file_id = $1 where id = $2', [f.rows[0].id, modelId]);
        await writePreviews(c, modelId, e.images, results);
        modelOfFile.set(e.file.id, modelId);
        created++;
        continue;
      }

      modelOfFile.set(e.file.id, e.modelId);
      const ch = e.changes;
      if (!(ch.name || ch.category || ch.file || ch.enrich || ch.filename || ch.previews)) continue;
      const found = await c.query(
        `select m.id from models m join model_files f on f.model_id = m.id
          where m.id = $1 and f.source_id = $2 and f.drive_file_id = $3 for update of m`, [e.modelId, sourceId, e.file.id]);
      if (!found.rowCount) throw planStale();

      if (ch.name || ch.category) {
        const categoryId = ch.category ? await categories.resolve(e.categoryPath.split(' / ')) : null;
        await c.query('update models set name = coalesce($2, name), category_id = coalesce($3, category_id), updated_at = now() where id = $1',
          [e.modelId, ch.name ?? null, categoryId]);
      }
      if (ch.file || ch.enrich || ch.filename) {
        // md5/size chi duoc dien them, khong bao gio ghi de gia tri da biet bang NULL; noi dung doi thi sha256 cu het gia tri.
        await c.query(
          `update model_files set filename = $2, file_type = $3, size_bytes = coalesce($4, size_bytes), md5_checksum = coalesce($5, md5_checksum),
                  sha256 = case when $6 then null else sha256 end
            where source_id = $7 and drive_file_id = $1`,
          [e.file.id, e.file.name, e.file.type, e.file.size, e.file.md5, Boolean(ch.file), sourceId]);
      }
      if (ch.previews) await writePreviews(c, e.modelId, e.images, results);
      if (ch.name || ch.category || ch.file || ch.filename || ch.previews) updated++;
    }

    if (plan.missing?.length) await c.query('update models set missing_scans = missing_scans + 1 where id = any($1::uuid[])', [plan.missing]);
    if (plan.recovered?.length) await c.query('update models set missing_scans = 0 where id = any($1::uuid[])', [plan.recovered]);

    for (const r of plan.reviews) {
      // Cung fingerprint da co (ke ca da DISMISS/RESOLVED): khong mo lai moi lan quet.
      const dup = await c.query("select 1 from review_items where source_id = $1 and payload->>'fingerprint' = $2", [sourceId, r.payload.fingerprint]);
      if (dup.rowCount) continue;
      await c.query('insert into review_items (source_id, kind, payload, model_id) values ($1, $2, $3::jsonb, $4)',
        [sourceId, r.kind, JSON.stringify(r.payload), r.forFile ? modelOfFile.get(r.forFile) ?? null : null]);
    }

    const state = await refreshCatalogState(c, { jobId });
    await c.query('commit');
    return { version: state.version, changed: state.changed, created, updated };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
