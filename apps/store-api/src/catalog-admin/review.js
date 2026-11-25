// P3.4 — "Can duyet" (plan §2.2): GET /catalog/review, POST /catalog/review/:id {action: ACCEPT|DISMISS}.
// Quyet dinh cua chu du an: ACCEPT SUGGESTED_PAIR = danh dau xong + duyet model dang NEEDS_REVIEW; DISMISS khong dong den model;
// ACCEPT REMAP_CANDIDATE = GOP file moi vao model cu (giu ID, gia, ten, legacy_id) roi xoa model moi trung; cac loai khac chi duoc DISMISS.
// `choice` (chon anh chinh / ghep tay) chua ho tro: bi tu choi. Khong tra Drive ID, fingerprint, ID model hay ID nguon.
import { contentDomain } from '../content-domain.js';
import { apiError } from '../drive/errors.js';
import { refreshCatalogState } from '../catalog-v1/manifest.js';
import { audit, bad, HAS_ARCHIVE_SQL, HAS_PREVIEW_SQL, inTransaction, MISMATCH_SQL, UUID } from './shared.js';

const ACCEPTABLE = new Set(['SUGGESTED_PAIR', 'REMAP_CANDIDATE']);

const summaryOf = (kind, p) => {
  const where = p.path ? ` trong "${p.path}"` : '';
  switch (kind) {
    case 'AMBIGUOUS_PAIR': return `Không rõ ghép cặp nào đúng${where} (${(p.files ?? []).length} file).`;
    case 'ORPHAN_IMAGE': return `Ảnh không có file model đi kèm${where}.`;
    case 'ORPHAN_MODEL': return `File model không có ảnh đi kèm${where}.`;
    case 'SUGGESTED_PAIR': return `Gợi ý ghép ảnh với file model dù tên lệch nhau${where}.`;
    case 'REMAP_CANDIDATE': return `File${where} trùng nội dung (MD5 và dung lượng) với model đã mất "${p.previousModel ?? '?'}": có thể là cùng một model đã đổi ID trên Drive.`;
    case 'PREVIEW_IN_ARCHIVE': return `Ảnh xem trước nằm trong file nén${where}.`;
    default: return `Mục cần xem${where}.`;
  }
};
const itemView = (r) => ({ id: r.id, kind: r.kind, summary: summaryOf(r.kind, r.payload ?? {}), candidates: (r.payload?.files ?? []).map((name) => ({ name: String(name) })) });

// Muc suy ra tu du lieu model (khong luu, tu het khi duoc sua): chi doc, khong co hanh dong, khong tra ID.
const DERIVED_LIMIT = 200;
const DERIVED = [
  ['MISSING_PREVIEW', `${HAS_ARCHIVE_SQL} and not ${HAS_PREVIEW_SQL}`],
  ['MISSING_ARCHIVE', `${HAS_PREVIEW_SQL} and not ${HAS_ARCHIVE_SQL}`],
  ['CATEGORY_MISMATCH', MISMATCH_SQL],
];
const DERIVED_SQL = DERIVED.map(([kind, where], i) => `(select '${kind}' as kind, m.name, c.full_path, dc.full_path as drive_path, count(*) over () as total
    from models m join categories c on c.id = m.category_id left join categories dc on dc.id = m.drive_category_id
    left join model_previews p on p.model_id = m.id and p.variant = 'sm' and p.is_primary
    where m.content_domain = $1 and m.status <> 'HIDDEN' and ${where} order by m.name, m.id limit ${DERIVED_LIMIT})`).join(' union all ');
const derivedSummary = (kind, r) => {
  if (kind === 'MISSING_PREVIEW') return `Có file nhưng chưa có ảnh preview (${r.full_path}).`;
  if (kind === 'MISSING_ARCHIVE') return `Có ảnh preview nhưng chưa có file nén (${r.full_path}).`;
  return `Ảnh ở "${r.full_path}" nhưng file trên Drive ở "${r.drive_path ?? '?'}".`;
};
const derivedView = (r, i) => ({ id: `${r.kind}:${i}`, kind: r.kind, derived: true, total: Number(r.total), summary: derivedSummary(r.kind, r), candidates: [{ name: r.name }] });
const notApplicable = () => apiError('REVIEW_NOT_APPLICABLE');

// Gop file/anh cua model MOI vao model CU (da mat) trong cung transaction. Model cu giu ID, gia, ten va legacy_id.
async function mergeRemap(c, item) {
  const newId = item.model_id, oldId = item.payload?.previousModelId;
  if (!newId || !UUID.test(String(oldId ?? '')) || newId === oldId) throw notApplicable();
  const rows = (await c.query('select id, content_domain, missing_scans, primary_file_id from models where id = any($1::uuid[]) order by id for update', [[newId, oldId]])).rows;
  const fresh = rows.find((r) => r.id === newId), old = rows.find((r) => r.id === oldId);
  if (!fresh || !old || fresh.content_domain !== old.content_domain || old.missing_scans <= 0) throw notApplicable(); // model cu da quay lai hoac khong con: khong gop
  await c.query('delete from model_previews where model_id = $1', [oldId]);
  await c.query('delete from model_files where model_id = $1', [oldId]);               // file cu khong con tren Drive
  await c.query('update model_files set model_id = $1 where model_id = $2', [oldId, newId]);
  await c.query('update model_previews set model_id = $1 where model_id = $2', [oldId, newId]);
  await c.query('update models set primary_file_id = $2, missing_scans = 0, updated_at = now() where id = $1', [oldId, fresh.primary_file_id]);
  await c.query('delete from models where id = $1', [newId]);
  return oldId;
}

export function addReviewRoutes(router, { pool, pre, json }) {
  router.get('/catalog/review', ...pre, async (req, res, next) => {
    try {
      const domain = contentDomain(req.query.contentDomain);
      const rows = (await pool.query("select id, kind, payload from review_items where status = 'OPEN' and content_domain=$1 order by created_at, id limit 500", [domain])).rows;
      const derived = (await pool.query(DERIVED_SQL, [domain])).rows;
      res.json([...rows.map(itemView), ...derived.map(derivedView)]);
    } catch (e) { next(e); }
  });

  router.post('/catalog/review/:id', ...pre, json, async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) throw apiError('REVIEW_NOT_FOUND');
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action','contentDomain'].includes(key)) || !['ACCEPT', 'DISMISS'].includes(body.action)) throw bad();
      const { action } = body;
      const domain = contentDomain(body.contentDomain ?? req.query.contentDomain);

      await inTransaction(pool, async (c) => {
        const item = (await c.query('select * from review_items where id = $1 and content_domain=$2 for update', [req.params.id, domain])).rows[0];
        if (!item) throw apiError('REVIEW_NOT_FOUND');
        if (item.status !== 'OPEN') throw apiError('REVIEW_ALREADY_RESOLVED');

        if (action === 'DISMISS') {
          await c.query("update review_items set status = 'DISMISSED', resolved_by = $2, resolved_at = now() where id = $1", [item.id, req.user.id]);
          await audit(c, req.user.id, 'REVIEW_DISMISSED', 'review_item', item.id, { kind: item.kind });
          return;
        }
        if (!ACCEPTABLE.has(item.kind)) throw bad();

        let published = false, mergedInto = null;
        if (item.kind === 'REMAP_CANDIDATE') mergedInto = await mergeRemap(c, item);
        else if (item.model_id) {
          published = (await c.query(
            `update models set status = 'PUBLISHED', published_at = coalesce(published_at, now()), updated_at = now()
              where id = $1 and status = 'NEEDS_REVIEW' returning id`, [item.model_id])).rowCount === 1;
        }
        await c.query("update review_items set status = 'RESOLVED', resolved_by = $2, resolved_at = now() where id = $1", [item.id, req.user.id]);
        if (published || mergedInto) await refreshCatalogState(c); // du lieu cong khai doi: tang phien ban cho plugin
        await audit(c, req.user.id, 'REVIEW_ACCEPTED', 'review_item', item.id, { kind: item.kind, published, ...(mergedInto ? { mergedInto } : {}) });
      });
      res.status(200).end();
    } catch (e) { next(e); }
  });
}
