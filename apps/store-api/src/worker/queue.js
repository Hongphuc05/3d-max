// Hang doi job dong bo Drive tren PostgreSQL (khong Redis). Moi ham ghi sau khi nhan job deu kiem lease_owner:
// worker bi mat lease (treo, VPS khoi dong lai) khong the ghi de worker da nhan job do.
export const MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 60_000;
const MODES = new Set(['FULL', 'INCREMENTAL']);
const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
const STAGES = new Set(['SCANNING', 'COMPARING', 'DOWNLOADING_PREVIEWS', 'PUBLISHING']);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,60}$/;
// Ten cot co dinh o day; key tu worker khong bao gio duoc noi vao SQL.
const COUNTERS = {
  scannedFolders: 'scanned_folders', scannedFiles: 'scanned_files', newCount: 'new_count', updatedCount: 'updated_count',
  unchangedCount: 'unchanged_count', missingCount: 'missing_count', reviewCount: 'review_count', skippedCount: 'skipped_count', errorCount: 'error_count',
};
const LIVE = "status in ('RUNNING','CANCELLING')";

const apiError = (code, status, message) => Object.assign(new Error(message), { code, status });
const leaseExpr = (n) => `now() + ($${n}::double precision * interval '1 millisecond')`;

export async function enqueueJob(pool, { sourceId, mode, requestedBy = null }) {
  if (!MODES.has(mode)) throw apiError('INVALID_PARAMS', 400, 'Invalid sync mode.');
  try {
    const r = await pool.query(
      "insert into drive_sync_jobs (source_id, mode, status, requested_by) values ($1, $2, 'QUEUED', $3) returning *",
      [sourceId, mode, requestedBy]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505' && e.constraint === 'drive_sync_jobs_one_active_idx') {
      throw apiError('SYNC_ALREADY_RUNNING', 409, 'A sync job is already active for this source.');
    }
    throw e;
  }
}

/** Nhan 1 job: QUEUED, hoac RUNNING da het lease (worker truoc chet). Tra ve null neu khong co viec. */
export async function claimJob(pool, workerId, { leaseMs = DEFAULT_LEASE_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  // Job chet qua nhieu lan: dung lai, khong de mot job doc lam sap worker mai mai.
  await pool.query(
    `update drive_sync_jobs set status = 'FAILED', error_code = 'JOB_ATTEMPTS_EXCEEDED', finished_at = now(),
            lease_owner = null, lease_expires_at = null, stage = null
      where status = 'RUNNING' and lease_expires_at < now() and attempt >= $1`, [maxAttempts]);
  // Dang huy ma worker da chet: ket thuc huy thay worker.
  await pool.query(
    `update drive_sync_jobs set status = 'CANCELLED', finished_at = now(), lease_owner = null, lease_expires_at = null, stage = null
      where status = 'CANCELLING' and lease_expires_at < now()`);
  const r = await pool.query(
    `with picked as (
       select id from drive_sync_jobs
        where status = 'QUEUED' or (status = 'RUNNING' and lease_expires_at < now())
        order by created_at, id
        for update skip locked limit 1)
     update drive_sync_jobs j
        set status = 'RUNNING', lease_owner = $1, lease_expires_at = ${leaseExpr(2)}, heartbeat_at = now(),
            started_at = coalesce(j.started_at, now()), attempt = j.attempt + 1, stage = coalesce(j.stage, 'SCANNING')
       from picked where j.id = picked.id
     returning j.*`, [workerId, leaseMs]);
  return r.rows[0] ?? null;
}

/** Gia han lease. null = worker nay khong con so huu job (phai dung ngay). */
export async function heartbeat(pool, jobId, workerId, { leaseMs = DEFAULT_LEASE_MS } = {}) {
  const r = await pool.query(
    `update drive_sync_jobs set lease_expires_at = ${leaseExpr(3)}, heartbeat_at = now()
      where id = $1 and lease_owner = $2 and ${LIVE} returning cancel_requested`, [jobId, workerId, leaseMs]);
  return r.rows[0] ? { cancelRequested: r.rows[0].cancel_requested } : null;
}

/** Luu checkpoint/so lieu. false = mat lease. */
export async function saveProgress(pool, jobId, workerId, { checkpoint, stage, counters = {}, bytesDownloaded } = {}) {
  const sets = [], params = [jobId, workerId];
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)); };
  if (checkpoint !== undefined) add('checkpoint = ?::jsonb', JSON.stringify(checkpoint));
  if (stage !== undefined) {
    if (stage !== null && !STAGES.has(stage)) throw new Error('invalid stage');
    add('stage = ?', stage);
  }
  for (const [key, value] of Object.entries(counters)) {
    if (!Object.hasOwn(COUNTERS, key) || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid counter');
    add(`${COUNTERS[key]} = ?`, value);
  }
  if (bytesDownloaded !== undefined) {
    if (!Number.isSafeInteger(bytesDownloaded) || bytesDownloaded < 0) throw new Error('invalid counter');
    add('bytes_downloaded = ?', String(bytesDownloaded));
  }
  if (!sets.length) sets.push('heartbeat_at = heartbeat_at');
  const r = await pool.query(`update drive_sync_jobs set ${sets.join(', ')} where id = $1 and lease_owner = $2 and ${LIVE}`, params);
  return r.rowCount === 1;
}

export async function finishJob(pool, jobId, workerId, { status, errorCode = null, errorMessage = null }) {
  if (!TERMINAL.has(status)) throw new Error('invalid terminal status');
  if (errorCode !== null && !ERROR_CODE.test(errorCode)) throw new Error('invalid error code');
  const r = await pool.query(
    `with completed as (
       update drive_sync_jobs set status = $3, finished_at = now(), lease_owner = null, lease_expires_at = null, stage = null,
              error_code = $4, error_message = $5
        where id = $1 and lease_owner = $2 and ${LIVE}
        returning id, source_id, mode, status, error_count
     ), pruned as (
       -- Keep one clean FULL baseline per source; discard failed/partial FULL snapshots and older baselines.
       delete from drive_archive_snapshot_runs r using completed c
        where c.mode = 'FULL' and r.source_id = c.source_id
          and ((c.status = 'COMPLETED' and c.error_count = 0 and r.job_id <> c.id)
            or ((c.status <> 'COMPLETED' or c.error_count <> 0) and r.job_id = c.id))
        returning r.job_id
     )
     select id from completed`,
    [jobId, workerId, status, errorCode, errorMessage === null ? null : String(errorMessage).slice(0, 500)]);
  return r.rowCount === 1;
}

/** Tat may nhe nhang (SIGTERM): tra job ve hang doi, giu checkpoint, khong tinh la mot lan thu. */
export async function releaseJob(pool, jobId, workerId) {
  const r = await pool.query(
    `update drive_sync_jobs set status = 'QUEUED', lease_owner = null, lease_expires_at = null, heartbeat_at = null,
            attempt = greatest(attempt - 1, 0)
      where id = $1 and lease_owner = $2 and status = 'RUNNING'`, [jobId, workerId]);
  return r.rowCount === 1;
}

/** QUEUED -> CANCELLED ngay; RUNNING/CANCELLING -> CANCELLING (worker dung o diem an toan). false = khong huy duoc. */
export async function cancelJob(pool, jobId) {
  const r = await pool.query(
    `update drive_sync_jobs
        set status = case when status = 'QUEUED' then 'CANCELLED' else 'CANCELLING' end,
            cancel_requested = true,
            finished_at = case when status = 'QUEUED' then now() else finished_at end
      where id = $1 and status in ('QUEUED','RUNNING','CANCELLING') returning status`, [jobId]);
  return r.rows[0]?.status ?? false;
}
