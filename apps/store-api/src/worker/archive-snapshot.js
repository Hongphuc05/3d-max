// Immutable archive metadata from a clean FULL scan. Incremental reconciliation must not read
// drive_inventory directly because an interrupted later scan may already have updated some rows.
import { MODEL_SCOPE_POLICY } from './model-scope.js';
const ARCHIVE_SQL = `(right(lower(filename), 4) in ('.zip', '.rar') or right(lower(filename), 3) = '.7z')`;

export async function latestArchiveSnapshot(pool, sourceId) {
  return (await pool.query(
    `select r.job_id as id, r.source_id, r.archive_count, j.finished_at
       from drive_archive_snapshot_runs r
       join drive_sync_jobs j on j.id = r.job_id
       join drive_sources s on s.id = r.source_id
      where r.source_id = $1 and j.mode = 'FULL' and j.status = 'COMPLETED' and j.error_count = 0
        and j.checkpoint #>> '{scan,done}' = 'true'
        and (upper(trim(s.root_folder_name)) not in ('3DSMOOD','3DMODELS')
          or j.checkpoint #>> '{scan,scopePolicy}' = $2)
      order by j.finished_at desc, j.id desc limit 1`, [sourceId, MODEL_SCOPE_POLICY])).rows[0] ?? null;
}

/** Copy one completed scan's archive metadata into a stable per-job snapshot. Safe to call again on resume. */
export async function captureArchiveSnapshot(pool, { sourceId, jobId }) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const job = (await c.query(
      `select 1 from drive_sync_jobs where id = $1 and source_id = $2 and mode = 'FULL'
        and checkpoint #>> '{scan,done}' = 'true' for update`, [jobId, sourceId])).rowCount;
    if (!job) throw Object.assign(new Error('SCAN_NOT_COMPLETE'), { code: 'SCAN_NOT_COMPLETE' });

    await c.query('delete from drive_archive_snapshot_runs where job_id = $1', [jobId]);
    await c.query(
      `insert into drive_archive_snapshot_runs (job_id, source_id, archive_count)
       select $2, $1, count(*)::int from drive_inventory
        where source_id = $1 and last_seen_job_id = $2 and not is_folder and not is_shortcut and ${ARCHIVE_SQL}`,
      [sourceId, jobId]);
    await c.query(
      `insert into drive_archive_snapshot_files (job_id, drive_file_id, path, filename, size_bytes, md5_checksum, file_type)
       select $2, drive_file_id, path, filename, size_bytes, md5_checksum,
              case when right(lower(filename), 4) = '.zip' then 'zip'
                   when right(lower(filename), 4) = '.rar' then 'rar' else '7z' end
         from drive_inventory
        where source_id = $1 and last_seen_job_id = $2 and not is_folder and not is_shortcut and ${ARCHIVE_SQL}`,
      [sourceId, jobId]);
    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally { c.release(); }
}
