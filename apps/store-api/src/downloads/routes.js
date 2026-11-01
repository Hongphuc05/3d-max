// P4.2 (plan §2.5): phien tai model. Khach chi nhan byte tu ban sao tren dia VPS; Drive ID/link khong bao gio roi may chu.
//   POST /api/v1/models/:modelId/import-session  (requireDevice) -> 201 phien dung mot lan, 5 phut
//   GET  /api/v1/model-downloads/:sessionId      (requireDevice) -> stream nhi phan (kiem lai quyen luc mo)
// Guard gan TUNG route (khong router.use) de duong dan khac roi xuong router phia sau.
import express from 'express';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { inTransaction, UUID } from '../catalog-admin/shared.js';
import { requireDevice } from '../devices/routes.js';
import { createArchiveSender } from '../download-stream.js';

const SESSION = /^[A-Za-z0-9_-]{43}$/;
const sha256 = (value) => createHash('sha256').update(value).digest();
// Loi phia kho/Google/dia: plugin chi thay mot ma; ma that di vao nhat ky tai.
const STORAGE_CODES = new Set(['STORAGE_DOWNLOAD_FAILED', 'DOWNLOAD_SIZE_MISMATCH', 'DOWNLOAD_CHECKSUM_MISMATCH', 'DISK_SPACE_LOW', 'DOWNLOAD_TIMEOUT', 'DOWNLOAD_CANCELLED']);
const logCode = (e) => (/^[A-Z][A-Z0-9_]{1,60}$/.test(e?.code ?? '') ? e.code : 'INTERNAL');

const FILE_SQL = `select m.status as model_status, f.id as file_id, f.drive_file_id, f.file_type, f.size_bytes, f.md5_checksum, f.sha256, f.entry_file,
                         f.can_download, f.download_status
                    from models m left join model_files f on f.id = m.primary_file_id where m.id = $1`;
const ENTITLEMENT_SQL = `select id from entitlements where device_id = $1 and revoked_at is null
                          and (scope = 'ALL_MODELS' or (scope = 'MODEL' and model_id = $2)) limit 1`;

function checkOfferable(row) {
  if (!row || row.model_status !== 'PUBLISHED' || !row.file_id || row.download_status === 'MISSING' || row.download_status === 'ERROR') throw apiError('MODEL_NOT_AVAILABLE');
  if (row.can_download === false || row.download_status === 'RESTRICTED') throw apiError('MODEL_DOWNLOAD_RESTRICTED');
}
const cacheRecord = (row) => ({ id: row.file_id, driveFileId: row.drive_file_id, sizeBytes: row.size_bytes, md5: row.md5_checksum, sha256: row.sha256 });

export function createDownloadRouter({ pool, cache, rateLimit, sessionsPerHour = 10, maxConcurrent = 3 }) {
  if (!Number.isSafeInteger(sessionsPerHour) || sessionsPerHour < 1 || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('Invalid download config');
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : [])];
  let active = 0;

  // Sha256 chi biet sau lan tai dau tien; chi dien khi con trong (noi dung doi thi worker da xoa gia tri cu).
  const learnSha = (fileId) => async ({ sha256: digest }) => { await pool.query('update model_files set sha256 = $2 where id = $1 and sha256 is null', [fileId, digest]); };
  const warm = (row) => { cache.acquire(cacheRecord(row), { onVerified: learnSha(row.file_id) }).then((h) => h.release(), () => {}); };

  // Cung hinh dang provider cua createArchiveSender: nguon la ban sao trong cache, khong phai Google.
  const sender = createArchiveSender({
    async openDownload(model, { signal }) {
      const handle = await cache.acquire(model.record, { signal, onVerified: model.onVerified });
      try {
        const data = createReadStream(handle.path);
        model.ctx.stream = data;
        data.once('close', () => handle.release());
        return { status: 200, headers: { 'content-length': String(handle.size) }, data };
      } catch (e) { handle.release(); throw e; }
    },
  }, { maxConcurrent });

  async function finish(sessionId, deviceId, modelId, status, errorCode, bytes) {
    try {
      await inTransaction(pool, async (db) => {
        await db.query('update model_download_sessions set status = $2, finished_at = now() where id = $1 and status = $3', [sessionId, status, 'STREAMING']);
        await db.query('insert into model_download_logs (session_id, model_id, device_id, bytes_sent, status, error_code) values ($1, $2, $3, $4, $5, $6)',
          [sessionId, modelId, deviceId, bytes, status, errorCode]);
      });
    } catch { console.error('[v3] download log failed'); }
  }

  router.post('/models/:modelId/import-session', ...pre, requireDevice(pool), async (req, res) => {
    const modelId = req.params.modelId;
    if (!UUID.test(modelId)) throw apiError('INVALID_PARAMS');
    const out = await inTransaction(pool, async (db) => {
      await db.query('select 1 from devices where id = $1 for update', [req.device.id]); // tuan tu hoa phien cua mot thiet bi (gioi han toc do)
      const ent = (await db.query(ENTITLEMENT_SQL, [req.device.id, modelId])).rows[0];
      if (!ent) throw apiError('NOT_ENTITLED');
      const row = (await db.query(FILE_SQL, [modelId])).rows[0];
      checkOfferable(row);
      await db.query("update model_download_sessions set status = 'EXPIRED' where status = 'CREATED' and expires_at < now()");
      const used = (await db.query("select count(*)::int n from model_download_sessions where device_id = $1 and created_at > now() - interval '1 hour'", [req.device.id])).rows[0].n;
      if (used >= sessionsPerHour) throw apiError('RATE_LIMITED');
      const token = randomBytes(32).toString('base64url');
      const { expires_at: expiresAt } = (await db.query(
        `insert into model_download_sessions (token_hash, model_id, device_id, entitlement_id, expires_at)
         values ($1, $2, $3, $4, now() + interval '5 minutes') returning expires_at`, [sha256(token), modelId, req.device.id, ent.id])).rows[0];
      return { token, expiresAt, row };
    });
    warm(out.row);
    const { row } = out;
    res.status(201).json({ sessionId: out.token, expiresAt: out.expiresAt, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      md5: row.md5_checksum, sha256: row.sha256, fileType: row.file_type, entryFile: row.entry_file });
  });

  router.get('/model-downloads/:sessionId', ...pre, requireDevice(pool), async (req, res) => {
    const token = req.params.sessionId;
    if (!SESSION.test(token)) throw apiError('SESSION_INVALID');
    if (active >= maxConcurrent) throw apiError('DOWNLOAD_BUSY'); // truoc khi nhan phien: het cho khong lam hong phien
    active++;
    let slotHeld = true;
    const freeSlot = () => { if (slotHeld) { slotHeld = false; active--; } }; // tra cho NGAY sau khi gui xong, truoc khi ghi nhat ky
    try {
      // Nhan phien nguyen tu: dung mot lan, dung thiet bi, con han.
      const s = (await pool.query(
        `update model_download_sessions set status = 'STREAMING', started_at = now()
          where token_hash = $1 and device_id = $2 and status = 'CREATED' and expires_at > now()
          returning id, model_id`, [sha256(token), req.device.id])).rows[0];
      if (!s) throw apiError('SESSION_INVALID');
      const fail = async (code) => { await finish(s.id, req.device.id, s.model_id, 'FAILED', code, 0); throw apiError(code); };

      // Kiem lai luc mo: quyen co the bi thu hoi, model co the bi go sau khi tao phien.
      if (!(await pool.query(ENTITLEMENT_SQL, [req.device.id, s.model_id])).rows[0]) await fail('NOT_ENTITLED');
      const row = (await pool.query(FILE_SQL, [s.model_id])).rows[0];
      try { checkOfferable(row); } catch (e) { await fail(e.code); }

      const ctx = { stream: null };
      const model = { id: s.model_id, archiveExtension: `.${row.file_type}`, canDownload: true, size: row.size_bytes, record: cacheRecord(row), onVerified: learnSha(row.file_id), ctx };
      try {
        try { await sender(req, res, model); } finally { freeSlot(); }
      } catch (e) {
        await finish(s.id, req.device.id, s.model_id, 'FAILED', res.destroyed ? 'CLIENT_ABORTED' : logCode(e), ctx.stream?.bytesRead ?? 0);
        if (res.headersSent || res.destroyed) { res.destroy(); return; }
        throw STORAGE_CODES.has(e?.code) ? apiError('STORAGE_DOWNLOAD_FAILED') : e?.code === 'DOWNLOAD_BUSY' ? apiError('DOWNLOAD_BUSY') : e;
      }
      // createArchiveSender khong nem khi khach ngat giua chung (no huy luong va tra ve): phan biet bang trang thai gui.
      if (res.writableFinished) await finish(s.id, req.device.id, s.model_id, 'COMPLETED', null, ctx.stream?.bytesRead ?? 0);
      else await finish(s.id, req.device.id, s.model_id, 'FAILED', 'CLIENT_ABORTED', ctx.stream?.bytesRead ?? 0);
    } finally { freeSlot(); }
  });

  router.use(v3ErrorHandler);
  return router;
}
