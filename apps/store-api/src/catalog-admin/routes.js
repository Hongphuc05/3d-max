// Admin: cai dat (app_settings) va bang model (plan §2.7, P3.7). Guard gan TUNG route (khong router.use) de cac duong dan khac
// roi xuong adminRouter cu nguyen ven (guard va dinh dang loi cua no khong doi).
// Gia thu vien (D28.1): chua co dong app_settings thi tra gia mac dinh (envDefaultPrice).
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { refreshCatalogState } from '../catalog-v1/manifest.js';
import { addPreviewRoutes } from './previews.js';
import { addReviewRoutes } from './review.js';
import { audit, bad, inTransaction, UUID } from './shared.js';

const CONTROL = /[\u0000-\u001f\u007f]/;
const MODEL_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'NEEDS_REVIEW', 'HIDDEN']);
const EDITABLE_STATUSES = new Set(['PUBLISHED', 'HIDDEN']);
const PRICE_MAX = 100_000_000;
const SETTING_FIELDS = ['bankName', 'bankBin', 'accountNo', 'accountName', 'libraryPriceVnd', 'orderTtlMinutes', 'maxPendingOrdersPerDevice'];

const exactKeys = (body, keys) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const got = Object.keys(body);
  if (got.length !== keys.length || !keys.every((k) => got.includes(k))) throw bad();
  return body;
};
const someKeys = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const got = Object.keys(body);
  if (!got.length || got.some((k) => !allowed.includes(k))) throw bad();
  return body;
};
// Chuoi tuy chon: null/'' -> null; con lai cat khoang trang, gioi han do dai, cam ky tu dieu khien.
function optionalText(v, max, pattern) {
  if (v === null) return null;
  if (typeof v !== 'string') throw bad();
  const t = v.trim();
  if (t === '') return null;
  if (t.length > max || CONTROL.test(t) || (pattern && !pattern.test(t))) throw bad();
  return t;
}
const integer = (v, min, max) => { if (!Number.isInteger(v) || v < min || v > max) throw bad(); return v; };

function parseSettings(body) {
  exactKeys(body, SETTING_FIELDS);
  return {
    bankName: optionalText(body.bankName, 100),
    bankBin: optionalText(body.bankBin, 6, /^\d{6}$/),            // ma BIN ngan hang VietQR: 6 chu so
    accountNo: optionalText(body.accountNo, 19, /^\d{6,19}$/),
    accountName: optionalText(body.accountName, 100),
    libraryPriceVnd: integer(body.libraryPriceVnd, 0, PRICE_MAX),
    orderTtlMinutes: integer(body.orderTtlMinutes, 1, 43200),
    maxPendingOrdersPerDevice: integer(body.maxPendingOrdersPerDevice, 1, 20),
  };
}
const settingsView = (r) => ({
  bankName: r.bank_name, bankBin: r.bank_bin, accountNo: r.account_no, accountName: r.account_name,
  libraryPriceVnd: r.library_price_vnd, orderTtlMinutes: r.order_ttl_minutes, maxPendingOrdersPerDevice: r.max_pending_orders_per_device,
  updatedAt: r.updated_at,
});
// D29: trang thai ghep cap suy ra tu du lieu (khong luu): FULL = anh + file nen = cong khai; con lai chi hien o admin.
const STATE_WHERE = { FULL: 'has_archive and has_preview', PREVIEW_ONLY: 'has_preview and not has_archive', ARCHIVE_ONLY: 'has_archive and not has_preview', MISMATCH: 'mismatch' };
const BASE = `select m.id, m.name, m.category_id, c.full_path, m.status, m.name_overridden, m.updated_at, p.local_path as thumb_path,
    (m.primary_file_id is not null) as has_archive, (p.local_path is not null) as has_preview,
    (m.drive_category_id is not null and m.drive_category_id <> m.category_id) as mismatch
  from models m join categories c on c.id = m.category_id
  left join model_previews p on p.model_id = m.id and p.variant = 'sm' and p.is_primary`;
const modelView = (r) => ({ id: r.id, name: r.name, categoryPath: r.full_path, status: r.status,
  state: r.has_preview ? (r.has_archive ? 'FULL' : 'PREVIEW_ONLY') : 'ARCHIVE_ONLY', categoryMismatch: r.mismatch,
  nameOverridden: r.name_overridden, updatedAt: r.updated_at, thumbUrl: r.thumb_path ? `/previews/${r.thumb_path}` : null });

export function createCatalogAdminRouter({ pool, guards = [], rateLimit, envDefaultPrice = 500000, previewDir }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];
  const json = express.json({ limit: '4kb' });
  const defaults = () => ({ bankName: null, bankBin: null, accountNo: null, accountName: null, libraryPriceVnd: envDefaultPrice,
    orderTtlMinutes: 1440, maxPendingOrdersPerDevice: 3, updatedAt: null });

  router.get('/settings', ...pre, async (_req, res, next) => {
    try {
      const row = (await pool.query('select * from app_settings where id = 1')).rows[0];
      res.json(row ? settingsView(row) : defaults());
    } catch (e) { next(e); }
  });

  router.put('/settings', ...pre, json, async (req, res, next) => {
    try {
      const next_ = parseSettings(req.body);
      const saved = await inTransaction(pool, async (c) => {
        const prev = (await c.query('select * from app_settings where id = 1 for update')).rows[0];
        const before = prev ? settingsView(prev) : defaults();
        const changed = SETTING_FIELDS.filter((k) => before[k] !== next_[k]);
        const row = (await c.query(
          `insert into app_settings (id, bank_name, bank_bin, account_no, account_name, library_price_vnd, order_ttl_minutes, max_pending_orders_per_device, updated_by, updated_at)
           values (1, $1, $2, $3, $4, $5, $6, $7, $8, now())
           on conflict (id) do update set bank_name = excluded.bank_name, bank_bin = excluded.bank_bin, account_no = excluded.account_no, account_name = excluded.account_name,
             library_price_vnd = excluded.library_price_vnd, order_ttl_minutes = excluded.order_ttl_minutes,
             max_pending_orders_per_device = excluded.max_pending_orders_per_device, updated_by = excluded.updated_by, updated_at = now()
           returning *`,
          [next_.bankName, next_.bankBin, next_.accountNo, next_.accountName, next_.libraryPriceVnd, next_.orderTtlMinutes, next_.maxPendingOrdersPerDevice, req.user.id])).rows[0];
        if (!prev || changed.length) {
          // Chi ten truong (khong sao chep ngan hang/so tai khoan vao nhat ky); gia la so khong nhay cam nen ghi tu/den.
          await audit(c, req.user.id, 'SETTINGS_UPDATED', 'app_settings', '1', {
            changed, ...(changed.includes('libraryPriceVnd') ? { libraryPriceVnd: { from: before.libraryPriceVnd, to: next_.libraryPriceVnd } } : {}) });
        }
        return row;
      });
      res.json(settingsView(saved));
    } catch (e) { next(e); }
  });

  router.get('/models', ...pre, async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q.length > 100) throw bad();
      const status = req.query.status === undefined || req.query.status === '' ? null : String(req.query.status);
      if (status !== null && !MODEL_STATUSES.has(status)) throw bad();
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
      const like = q ? q.replace(/[\\%_]/g, '\\$&') : null; // % _ \ la ky tu thuong, khong phai ky tu thay the
      const state = req.query.state === undefined || req.query.state === '' ? null : String(req.query.state);
      if (state !== null && !(state in STATE_WHERE)) throw bad();
      const categoryId = req.query.categoryId === undefined || req.query.categoryId === '' ? null : String(req.query.categoryId);
      if (categoryId !== null && !UUID.test(categoryId)) throw bad();
      let categoryIds = null;
      if (categoryId !== null) {
        const scope = await pool.query(`with recursive descendants(id) as (
          select id from categories where id = $1::uuid
          union
          select c.id from categories c join descendants d on c.parent_id = d.id
        ) select id from descendants`, [categoryId]);
        if (!scope.rowCount) throw bad();
        categoryIds = scope.rows.map((row) => row.id);
      }
      const where = `($1::text is null or name ilike '%' || $1 || '%' escape '\\') and ($2::text is null or status = $2)
        and ($3::uuid[] is null or category_id = any($3::uuid[]))${state ? ` and ${STATE_WHERE[state]}` : ''}`;
      const total = Number((await pool.query(`with b as (${BASE}) select count(*) from b where ${where}`, [like, status, categoryIds])).rows[0].count);
      const rows = (await pool.query(
        `with b as (${BASE}) select * from b where ${where} order by lower(name), id limit $4 offset $5`, [like, status, categoryIds, limit, (page - 1) * limit])).rows;
      const c = (await pool.query(`with b as (${BASE}) select
          count(*) filter (where ${STATE_WHERE.FULL}) as full, count(*) filter (where ${STATE_WHERE.PREVIEW_ONLY}) as preview_only,
          count(*) filter (where ${STATE_WHERE.ARCHIVE_ONLY}) as archive_only, count(*) filter (where mismatch) as mismatch from b`)).rows[0];
      const counts = { FULL: Number(c.full), PREVIEW_ONLY: Number(c.preview_only), ARCHIVE_ONLY: Number(c.archive_only), MISMATCH: Number(c.mismatch) };
      res.json({ items: rows.map(modelView), total, page, limit, counts });
    } catch (e) { next(e); }
  });

  // Cay danh muc cho man tai anh: phang, client tu dung cay theo parentId. modelCount = model truc tiep trong danh muc.
  router.get('/categories', ...pre, async (_req, res, next) => {
    try {
      const rows = (await pool.query(
        `select c.id, c.parent_id, c.name, c.full_path, (select count(*) from models m where m.category_id = c.id) as n from categories c order by c.full_path`)).rows;
      res.json({ items: rows.map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, fullPath: r.full_path, modelCount: Number(r.n) })) });
    } catch (e) { next(e); }
  });

  router.patch('/models/:id', ...pre, json, async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) throw apiError('MODEL_NOT_FOUND');
      const patch = someKeys(req.body, ['name', 'status']);
      if ('name' in patch) {
        if (typeof patch.name !== 'string') throw bad();
        patch.name = patch.name.trim();
        if (!patch.name || patch.name.length > 300 || CONTROL.test(patch.name)) throw bad();
      }
      if ('status' in patch && !EDITABLE_STATUSES.has(patch.status)) throw bad();

      const view = await inTransaction(pool, async (c) => {
        const cur = (await c.query(
          `select m.*, ca.full_path from models m join categories ca on ca.id = m.category_id where m.id = $1 for update of m`, [req.params.id])).rows[0];
        if (!cur) throw apiError('MODEL_NOT_FOUND');
        const next_ = { name: patch.name ?? cur.name, status: patch.status ?? cur.status };
        const before = { name: cur.name, status: cur.status };
        const changed = ['name', 'status'].filter((k) => before[k] !== next_[k]);
        if (!changed.length) return cur.id;
        const row = (await c.query(
          `update models set name = $2, status = $3,
                  name_overridden = name_overridden or $4,
                  published_at = case when $3 = 'PUBLISHED' and published_at is null then now() else published_at end, updated_at = now()
            where id = $1 returning *`,
          [cur.id, next_.name, next_.status, changed.includes('name')])).rows[0];
        await audit(c, req.user.id, 'MODEL_UPDATED', 'model', cur.id,
          { changed, ...Object.fromEntries(changed.map((k) => [k, { from: before[k], to: next_[k] }])) });
        await refreshCatalogState(c); // ten, gia, trang thai la du lieu cong khai: tang phien ban de plugin cap nhat
        return row.id;
      });
      res.json(modelView((await pool.query(`with b as (${BASE}) select * from b where id = $1`, [view])).rows[0]));
    } catch (e) { next(e); }
  });

  if (previewDir) addPreviewRoutes(router, { pool, pre: [requestId, ...guards], previewDir }); // D29; khong gioi han rateLimit: tai hang tram anh
  addReviewRoutes(router, { pool, pre, json }); // P3.4: /catalog/review

  router.use(v3ErrorHandler);
  return router;
}
