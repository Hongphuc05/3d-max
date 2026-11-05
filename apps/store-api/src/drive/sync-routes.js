// Admin API cho luot dong bo, theo docs/v3-implementation-plan.md §2.2 (P3.2/P3.3). Mount SAU guard admin trong createDriveRouter.
// Chi tra cot an toan: khong checkpoint, lease_owner, requested_by, Drive file ID. File loi hien ten + duong dan, khong ID.
import express from 'express';
import { apiError } from './errors.js';
import { cancelJob, enqueueJob } from '../worker/queue.js';
import { latestArchiveSnapshot } from '../worker/archive-snapshot.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_STATUSES = new Set(['PENDING', 'DONE', 'FAILED', 'SKIPPED']);
const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
const COLUMNS = `id, source_id, mode, status, stage, scanned_folders, scanned_files, new_count, updated_count, unchanged_count,
  missing_count, review_count, skipped_count, error_count, bytes_downloaded, started_at, finished_at, heartbeat_at, error_code, error_message`;

// Job = {id,sourceId,mode,status,stage,counters:{scannedFolders,scannedFiles,new,updated,unchanged,missing,review,skipped,errors},
//        bytesDownloaded,startedAt,finishedAt,heartbeatAt,errorCode,errorMessage}  (plan §2.2). JobSummary trong danh sach = cung dang.
const publicJob = (r) => ({
  id: r.id, sourceId: r.source_id, mode: r.mode, status: r.status, stage: r.stage,
  counters: {
    scannedFolders: r.scanned_folders, scannedFiles: r.scanned_files, new: r.new_count, updated: r.updated_count,
    unchanged: r.unchanged_count, missing: r.missing_count, review: r.review_count, skipped: r.skipped_count, errors: r.error_count,
  },
  bytesDownloaded: Number(r.bytes_downloaded), startedAt: r.started_at, finishedAt: r.finished_at, heartbeatAt: r.heartbeat_at,
  errorCode: r.error_code, errorMessage: r.error_message,
});

const bodyKeys = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !allowed.includes(k))) throw apiError('INVALID_PARAMS');
  return body;
};
const uuidParam = (v) => { if (!UUID.test(v ?? '')) throw apiError('JOB_NOT_FOUND'); return v; };

export function createSyncJobsRouter({ pool, pollMs = 2000, maxStreams = 5 }) {
  const router = express.Router();
  let streams = 0;
  const getJob = async (id) => (await pool.query(`select ${COLUMNS} from drive_sync_jobs where id = $1`, [id])).rows[0] ?? null;
  const mustGet = async (id) => (await getJob(uuidParam(id))) ?? (() => { throw apiError('JOB_NOT_FOUND'); })();

  router.get('/summary', async (req, res, next) => {
    try {
      const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : '';
      if (!UUID.test(sourceId)) throw apiError('INVALID_PARAMS');
      const source = (await pool.query('select 1 from drive_sources where id = $1', [sourceId])).rowCount;
      if (!source) throw apiError('INVALID_PARAMS');
      const [snapshot, models, reviews] = await Promise.all([
        latestArchiveSnapshot(pool, sourceId),
        pool.query(`select
          count(*) filter (where has_preview)::int as preview_count,
          count(*) filter (where m.status = 'PUBLISHED' and f.id is not null
            and f.download_status not in ('MISSING','ERROR','RESTRICTED') and f.can_download is not false and has_preview)::int as ready_count,
          count(*) filter (where m.primary_file_id is null and has_preview)::int as preview_only_count,
          count(*) filter (where m.primary_file_id is not null and not has_preview)::int as archive_only_count
          from models m
          left join model_files f on f.id = m.primary_file_id
          cross join lateral (select exists (select 1 from model_previews p where p.model_id = m.id and p.is_primary and p.variant = 'sm') as has_preview) preview_state`),
        pool.query("select count(*)::int n from review_items where source_id = $1 and status = 'OPEN'", [sourceId]),
      ]);
      res.json({
        hasFullScan: Boolean(snapshot), driveArchiveCount: snapshot ? Number(snapshot.archive_count) : null,
        lastFullScanAt: snapshot?.finished_at ?? null,
        previewCount: models.rows[0].preview_count, readyCount: models.rows[0].ready_count,
        previewOnlyCount: models.rows[0].preview_only_count, archiveOnlyCount: models.rows[0].archive_only_count,
        openReviewCount: Number(reviews.rows[0].n),
      });
    } catch (e) { next(e); }
  });

  router.post('/sync-jobs', express.json({ limit: '1kb' }), async (req, res, next) => {
    try {
      const { sourceId, mode } = bodyKeys(req.body, ['sourceId', 'mode']);
      if (!UUID.test(sourceId ?? '') || !['FULL', 'INCREMENTAL'].includes(mode)) throw apiError('INVALID_PARAMS');
      const source = (await pool.query('select enabled from drive_sources where id = $1', [sourceId])).rows[0];
      if (!source?.enabled) throw apiError('INVALID_PARAMS');
      if (mode === 'INCREMENTAL' && !(await latestArchiveSnapshot(pool, sourceId))) throw apiError('FULL_SCAN_REQUIRED');
      const job = await enqueueJob(pool, { sourceId, mode, requestedBy: req.user?.id ?? null });
      res.status(202).json({ jobId: job.id });
    } catch (e) { next(e); }
  });

  // Keyset theo (created_at, id): on dinh khi co job moi chen vao giua luc admin dang lat trang.
  router.get('/sync-jobs', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
      let after = null;
      if (req.query.cursor !== undefined) {
        const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)_([0-9a-f-]{36})$/i.exec(String(req.query.cursor));
        if (!m || !UUID.test(m[2])) throw apiError('INVALID_PARAMS');
        after = m;
      }
      const rows = (await pool.query(
        `select ${COLUMNS}, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as seq from drive_sync_jobs
          where $1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::uuid)
          order by created_at desc, id desc limit $3`, [after?.[1] ?? null, after?.[2] ?? null, limit + 1])).rows;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      res.json({ items: page.map(publicJob), nextCursor: rows.length > limit ? `${last.seq}_${last.id}` : null });
    } catch (e) { next(e); }
  });

  router.get('/sync-jobs/:id', async (req, res, next) => {
    try { res.json(publicJob(await mustGet(req.params.id))); } catch (e) { next(e); }
  });

  // Plan §2.2: GET /sync-jobs/:id/items?status=FAILED -> [{driveFileName,path,action,status,errorCode,errorMessage}]. Ten + duong dan, khong Drive ID.
  router.get('/sync-jobs/:id/items', async (req, res, next) => {
    try {
      const job = await mustGet(req.params.id);
      const status = req.query.status ?? 'FAILED';
      if (!ITEM_STATUSES.has(status)) throw apiError('INVALID_PARAMS');
      const rows = (await pool.query(
        `select i.action, i.status, i.error_code, i.error_message, v.filename, v.path
           from drive_sync_job_items i left join drive_inventory v on v.source_id = $2 and v.drive_file_id = i.drive_file_id
          where i.job_id = $1 and i.status = $3 order by v.path nulls last, i.id limit 500`, [job.id, job.source_id, status])).rows;
      res.json(rows.map((r) => ({ driveFileName: r.filename ?? null, path: r.path ?? null, action: r.action, status: r.status, errorCode: r.error_code, errorMessage: r.error_message })));
    } catch (e) { next(e); }
  });

  router.post('/sync-jobs/:id/cancel', async (req, res, next) => {
    try {
      const job = await mustGet(req.params.id);
      if (!(await cancelJob(pool, job.id))) throw apiError('JOB_NOT_CANCELLABLE');
      res.status(202).end();
    } catch (e) { next(e); }
  });

  // Thu lai = xep job moi cung nguon + mode. Dang co job chay/cho -> 409 SYNC_ALREADY_RUNNING (tu enqueueJob).
  router.post('/sync-jobs/:id/retry', async (req, res, next) => {
    try {
      const job = await mustGet(req.params.id);
      const source = (await pool.query('select enabled from drive_sources where id = $1', [job.source_id])).rows[0];
      if (!source?.enabled) throw apiError('INVALID_PARAMS');
      if (job.mode === 'INCREMENTAL' && !(await latestArchiveSnapshot(pool, job.source_id))) throw apiError('FULL_SCAN_REQUIRED');
      const created = await enqueueJob(pool, { sourceId: job.source_id, mode: job.mode, requestedBy: req.user?.id ?? null });
      res.status(202).json({ jobId: created.id });
    } catch (e) { next(e); }
  });

  // SSE: DB la nguon su that (worker la tien trinh khac), nen hoi dinh ky; chi gui khi doi. `done` roi dong.
  router.get('/sync-jobs/:id/events', async (req, res, next) => {
    try {
      let job = await mustGet(req.params.id);
      if (streams >= maxStreams) throw apiError('CATALOG_EVENTS_BUSY');
      streams++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      let last = '', timer = null, closed = false;
      const finish = () => { if (closed) return; closed = true; clearInterval(timer); streams--; res.end(); };
      const emit = (j) => {
        const data = JSON.stringify(publicJob(j));
        if (TERMINAL.has(j.status)) { res.write(`event: done\ndata: ${data}\n\n`); return finish(); }
        if (data !== last) { last = data; res.write(`event: progress\ndata: ${data}\n\n`); }
      };
      req.on('close', finish);
      emit(job);
      if (closed) return;
      timer = setInterval(async () => {
        try { job = (await getJob(job.id)) ?? job; if (!closed) emit(job); } catch { /* DB loi tam thoi: lan sau thu lai */ }
      }, pollMs);
    } catch (e) { next(e); }
  });

  return router;
}
