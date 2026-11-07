// D29: admin tai anh preview len VPS. POST /previews?category=A/B&filename=x.jpg[&replace=1] voi body = bytes anh (image/jpeg|png|webp, <= 15 MB).
// Xu ly: magic bytes -> sharp (gioi han pixel) -> 2 ban WebP content-addressed -> 1 transaction: ghep cap theo stem + cong bo neu tap cong khai doi.
// DELETE /models/:id/preview go anh (model chua co file nen thi bi xoa luon). Khong dung dependency moi: express.raw.
import express from 'express';
import { contentDomain } from '../content-domain.js';
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
      const domain = contentDomain(req.query.contentDomain);
      const filename = req.query.filename;
      if (typeof filename !== 'string' || filename.length > 300 || /[\u0000-\u001f\u007f/\\]/.test(filename) || !IMAGE.test(filename)) throw bad();
      const stem = normalizeStem(filename), parts = parseCategoryPath(req.query.category);
      if (!stem || !parts) throw bad();
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw apiError('PREVIEW_INVALID');
      const variants = await toVariants(req.body, path.join(previewDir, domain));
      for (const variant of Object.values(variants)) variant.path = `${domain}/${variant.path}`;
      const name = displayName(filename).slice(0, 300), replace = req.query.replace === '1';

      const out = await inTransaction(pool, async (c) => {
        await c.query('select 1 from catalog_state where id = 1 for update'); // tuan tu hoa voi publish cua worker
        const categoryId = await createCategoryResolver(c, domain).resolve(parts);
        const model = (await c.query(
          `select m.*, exists(select 1 from model_previews p where p.model_id = m.id and p.is_primary) as has_preview
             from models m where m.stem = $1 and m.content_domain = $2 for update`, [stem, domain])).rows[0];
        let modelId, replaced = false, version = 1;
        if (model?.has_preview) {
          if (domain === '3dscenes') {
            const previous = (await c.query('select variant,sha256 from model_previews where model_id=$1 and is_primary', [model.id])).rows;
            const identical = ['sm','lg'].every(variant => previous.some(p => p.variant === variant && p.sha256 === variants[variant].sha256));
            if (identical && !replace) {
              const added = await c.query('insert into model_categories(model_id,category_id,from_upload) values($1,$2,true) on conflict(model_id,category_id) do update set from_upload=true where not model_categories.from_upload returning category_id', [model.id, categoryId]);
              if (added.rowCount) await audit(c, req.user.id, 'PREVIEW_CATEGORY_ADDED', 'model', model.id, { contentDomain: domain, category: parts.join(' / ') });
              await refreshCatalogState(c);
              return { id: model.id, contentDomain: domain, replaced: false, reused: true, categoryAdded: Boolean(added.rowCount), state: model.primary_file_id ? 'FULL' : 'PREVIEW_ONLY', mismatch: false };
            }
          }
          const member = (await c.query('select 1 from model_categories where model_id=$1 and category_id=$2', [model.id, categoryId])).rowCount > 0;
          if ((domain === '3dmodels' && model.category_id !== categoryId) || (domain === '3dscenes' && !member && !replace)) {
            const path_ = parts.join(' / '), fp = createHash('sha256').update(['PREVIEW_COLLISION', path_, stem].join('\n')).digest('hex');
            const dup = await c.query("select 1 from review_items where payload->>'fingerprint' = $1 and content_domain = $2", [fp, domain]);
            if (!dup.rowCount) await c.query("insert into review_items (source_id, kind, payload, content_domain) values (null, 'AMBIGUOUS_PAIR', $1::jsonb, $2)",
              [JSON.stringify({ path: path_, files: [filename], fingerprint: fp }), domain]);
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
            `insert into models (category_id, name, status, stem, published_at, content_domain) values ($1, $2, 'PUBLISHED', $3, now(), $4) returning id`, [categoryId, name, stem, domain])).rows[0].id;
        }
        if (domain === '3dscenes') await c.query('insert into model_categories(model_id,category_id,from_upload) values($1,$2,true) on conflict(model_id,category_id) do update set from_upload=true', [modelId, categoryId]);
        await insertVariants(c, modelId, variants, version);
        await audit(c, req.user.id, replaced ? 'PREVIEW_REPLACED' : 'PREVIEW_UPLOADED', 'model', modelId, { category: parts.join(' / '), filename });
        await refreshCatalogState(c); // chi tang phien ban khi tap model cong khai doi
        const row = (await c.query(
          `select m.primary_file_id is not null as has_archive, (m.drive_category_id is not null and m.drive_category_id <> m.category_id) as mismatch from models m where m.id = $1`, [modelId])).rows[0];
        return { id: modelId, contentDomain: domain, replaced, state: row.has_archive ? 'FULL' : 'PREVIEW_ONLY', mismatch: row.mismatch };
      });
      if (out.collision) throw apiError('PREVIEW_COLLISION');
      if (out.exists) throw apiError('PREVIEW_EXISTS');
      res.status(out.replaced ? 200 : 201).json(out);
    } catch (e) { next(e); }
  });

  router.delete('/models/:id/preview', ...pre, async (req, res, next) => {
    try {
      const domain = contentDomain(req.query.contentDomain);
      if (!UUID.test(req.params.id)) throw apiError('MODEL_NOT_FOUND');
      const out = await inTransaction(pool, async (c) => {
        await c.query('select 1 from catalog_state where id = 1 for update');
        const m = (await c.query('select id, primary_file_id from models where id = $1 and content_domain = $2 for update', [req.params.id, domain])).rows[0];
        if (!m) throw apiError('MODEL_NOT_FOUND');
        await c.query('delete from model_previews where model_id = $1', [m.id]);
        let result = 'PREVIEW';
        if (!m.primary_file_id) { await c.query('delete from models where id = $1', [m.id]); result = 'MODEL'; } // khong con gi de giu
        else {
          await c.query('delete from model_categories where model_id = $1 and not from_drive', [m.id]);
          await c.query('update model_categories set from_upload=false where model_id=$1', [m.id]);
          await c.query('update models set category_id = coalesce(drive_category_id, category_id), updated_at = now() where id = $1', [m.id]);
        }
        await audit(c, req.user.id, 'PREVIEW_DELETED', 'model', m.id, { result });
        await refreshCatalogState(c);
        return { deleted: result };
      });
      res.json(out);
    } catch (e) { next(e); }
  });
}
