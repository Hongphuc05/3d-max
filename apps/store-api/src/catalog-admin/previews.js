// D29: admin tai anh preview len VPS. POST /previews?category=A/B&filename=x.jpg[&replace=1] voi body = bytes anh (image/jpeg|png|webp, <= 15 MB).
// Xu ly: magic bytes -> sharp (gioi han pixel) -> 2 ban WebP content-addressed -> 1 transaction: ghep cap theo stem + cong bo neu tap cong khai doi.
// DELETE /models/:id/preview go anh (model chua co file nen thi bi xoa luon). Khong dung dependency moi: express.raw.
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { apiError } from '../drive/errors.js';
import { refreshCatalogState } from '../catalog-v1/manifest.js';
import { checkMagic, makeVariants } from '../worker/previews.js';
import { createCategoryResolver } from '../worker/categories.js';
import { displayName, IMAGE, normalizeStem, parseCategoryPath } from '../worker/stem.js';
import { audit, bad, inTransaction, UUID } from './shared.js';

export const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PIXELS = 40_000_000;

const rawBody = express.raw({ type: TYPES, limit: MAX_PREVIEW_BYTES });
const body = (req, res, next) => rawBody(req, res, (e) => next(e?.type === 'entity.too.large' ? apiError('PREVIEW_TOO_LARGE') : e));

async function toVariants(buffer, dir) {
  await mkdir(path.join(dir, 'tmp'), { recursive: true });
  const part = path.join(dir, 'tmp', `${randomUUID()}.part`);
  try {
    await writeFile(part, buffer);
    await checkMagic(part);
    return await makeVariants(part, dir, MAX_PIXELS);
  } catch (e) {
    throw apiError(e?.code === 'PREVIEW_TOO_LARGE' ? 'PREVIEW_TOO_LARGE' : 'PREVIEW_INVALID');
  } finally { await rm(part, { force: true }); }
}

const insertVariants = async (c, modelId, v, version) => {
  for (const name of ['sm', 'lg']) {
    const x = v[name];
    await c.query(
      `insert into model_previews (model_id, source, local_path, sha256, file_size, width, height, variant, version, is_primary)
       values ($1, 'UPLOAD', $2, $3, $4, $5, $6, $7, $8, true)`, [modelId, x.path, x.sha256, x.fileSize, x.width, x.height, name, version]);
  }
};

export function addPreviewRoutes(router, { pool, pre, previewDir }) {
  router.post('/previews', ...pre, body, async (req, res, next) => {
    try {
      const filename = req.query.filename;
      if (typeof filename !== 'string' || filename.length > 300 || /[\u0000-\u001f\u007f/\\]/.test(filename) || !IMAGE.test(filename)) throw bad();
      const stem = normalizeStem(filename), parts = parseCategoryPath(req.query.category);
      if (!stem || !parts) throw bad();
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw apiError('PREVIEW_INVALID');
      const variants = await toVariants(req.body, previewDir);
      const name = displayName(filename).slice(0, 300), replace = req.query.replace === '1';

      const out = await inTransaction(pool, async (c) => {
        await c.query('select 1 from catalog_state where id = 1 for update'); // tuan tu hoa voi publish cua worker
        const categoryId = await createCategoryResolver(c).resolve(parts);
        const model = (await c.query(
          `select m.*, exists(select 1 from model_previews p where p.model_id = m.id and p.is_primary) as has_preview
             from models m where m.stem = $1 for update`, [stem])).rows[0];
        let modelId, replaced = false, version = 1;
        if (model?.has_preview) {
          if (model.category_id !== categoryId) { // cung ten, khac danh muc: khong tu ghep, khong ghi de
            const path_ = parts.join(' / '), fp = createHash('sha256').update(['PREVIEW_COLLISION', path_, stem].join('\n')).digest('hex');
            const dup = await c.query("select 1 from review_items where payload->>'fingerprint' = $1", [fp]);
            if (!dup.rowCount) await c.query("insert into review_items (source_id, kind, payload) values (null, 'AMBIGUOUS_PAIR', $1::jsonb)",
              [JSON.stringify({ path: path_, files: [filename], fingerprint: fp })]);
            return { collision: true };
          }
          if (!replace) return { exists: true };
          version = Number((await c.query('select max(version) as v from model_previews where model_id = $1', [model.id])).rows[0].v) + 1;
          await c.query('delete from model_previews where model_id = $1', [model.id]);
          modelId = model.id; replaced = true;
          await c.query('update models set name = case when name_overridden then name else $2 end, updated_at = now() where id = $1', [modelId, name]);
        } else if (model) { // da co file nen: anh quyet dinh danh muc
          modelId = model.id;
          await c.query('update models set category_id = $2, name = case when name_overridden then name else $3 end, updated_at = now() where id = $1', [modelId, categoryId, name]);
        } else {
          modelId = (await c.query(
            `insert into models (category_id, name, status, stem, published_at) values ($1, $2, 'PUBLISHED', $3, now()) returning id`, [categoryId, name, stem])).rows[0].id;
        }
        await insertVariants(c, modelId, variants, version);
        await audit(c, req.user.id, replaced ? 'PREVIEW_REPLACED' : 'PREVIEW_UPLOADED', 'model', modelId, { category: parts.join(' / '), filename });
        await refreshCatalogState(c); // chi tang phien ban khi tap model cong khai doi
        const row = (await c.query(
          `select m.primary_file_id is not null as has_archive, (m.drive_category_id is not null and m.drive_category_id <> m.category_id) as mismatch from models m where m.id = $1`, [modelId])).rows[0];
        return { id: modelId, replaced, state: row.has_archive ? 'FULL' : 'PREVIEW_ONLY', mismatch: row.mismatch };
      });
      if (out.collision) throw apiError('PREVIEW_COLLISION');
      if (out.exists) throw apiError('PREVIEW_EXISTS');
      res.status(out.replaced ? 200 : 201).json(out);
    } catch (e) { next(e); }
  });

  router.delete('/models/:id/preview', ...pre, async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) throw apiError('MODEL_NOT_FOUND');
      const out = await inTransaction(pool, async (c) => {
        await c.query('select 1 from catalog_state where id = 1 for update');
        const m = (await c.query('select id, primary_file_id from models where id = $1 for update', [req.params.id])).rows[0];
        if (!m) throw apiError('MODEL_NOT_FOUND');
        await c.query('delete from model_previews where model_id = $1', [m.id]);
        let result = 'PREVIEW';
        if (!m.primary_file_id) { await c.query('delete from models where id = $1', [m.id]); result = 'MODEL'; } // khong con gi de giu
        else await c.query('update models set category_id = coalesce(drive_category_id, category_id), updated_at = now() where id = $1', [m.id]);
        await audit(c, req.user.id, 'PREVIEW_DELETED', 'model', m.id, { result });
        await refreshCatalogState(c);
        return { deleted: result };
      });
      res.json(out);
    } catch (e) { next(e); }
  });
}
