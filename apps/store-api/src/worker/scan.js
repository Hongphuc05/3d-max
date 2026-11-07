// Giai doan SCANNING: duyet cay thu muc Drive (BFS) va ghi anh chup moi nhat vao drive_inventory.
// Khong so sanh, khong danh dau "mat" o day: last_seen_job_id chi co nghia khi lan quet nay hoan tat (done=true).
// Checkpoint {queue, pageToken, visited, counters} duoc luu sau MOI trang; so dem luu tuyet doi trong checkpoint
// nen chay lai mot trang sau khi crash khong dem doi.
import { FOLDER, SHORTCUT, validId } from '../drive/client.js';
import { apiError } from '../drive/errors.js';
import { isModelLibrarySource, MODEL_SCOPE_POLICY, resolveModelScope } from './model-scope.js';

const GOOGLE_APPS = 'application/vnd.google-apps.';
const MD5 = /^[0-9a-fA-F]{32}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_FAILURES = new Set(['DRIVE_NOT_FOUND', 'DRIVE_PERMISSION_DENIED']);

const limitError = () => Object.assign(new Error('SCAN_LIMIT_EXCEEDED'), { code: 'SCAN_LIMIT_EXCEEDED' });
// Ten tren Drive la du lieu khong tin cay: khong de no tao them doan duong dan hay ky tu dieu khien.
const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
const segment = (name) => { const s = cleanName(name).replace(/[/\\]/g, '_').slice(0, 255); return s === '' || s === '.' || s === '..' ? '_' : s; };

function toRow(f, parentId, path) {
  const size = Number(f.size);
  return {
    id: f.id, parent: parentId, path, name: cleanName(f.name).slice(0, 1000), mime: f.mimeType ?? 'application/octet-stream',
    isFolder: f.mimeType === FOLDER, isShortcut: f.mimeType === SHORTCUT,
    target: f.mimeType === SHORTCUT && validId(f.shortcutDetails?.targetId) ? f.shortcutDetails.targetId : null,
    size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    modified: f.modifiedTime && !Number.isNaN(Date.parse(f.modifiedTime)) ? f.modifiedTime : null,
    md5: typeof f.md5Checksum === 'string' && MD5.test(f.md5Checksum) ? f.md5Checksum.toLowerCase() : null,
    rk: typeof f.resourceKey === 'string' && RESOURCE_KEY.test(f.resourceKey) ? f.resourceKey : null,
    canDownload: typeof f.capabilities?.canDownload === 'boolean' ? f.capabilities.canDownload : null,
  };
}

// Mot job chi ghi mot file mot lan (file nam o 2 thu muc: lan thay dau thang) -> khong dung ON CONFLICT hai lan trong 1 cau lenh.
async function upsertRows(pool, sourceId, jobId, rows, batchSize, domain) {
  const unique = [...new Map(rows.map((r) => [r.id, r]).reverse()).values()].reverse();
  for (let i = 0; i < unique.length; i += batchSize) {
    const b = unique.slice(i, i + batchSize);
    const col = (k) => b.map((r) => r[k]);
    await pool.query(
      `insert into drive_inventory (source_id, drive_file_id, parent_drive_id, path, filename, mime_type, is_folder, is_shortcut,
                                    shortcut_target_id, size_bytes, modified_time, md5_checksum, resource_key, can_download, last_seen_job_id, content_domain)
       select $1::uuid, t.id, t.parent, t.path, t.name, t.mime, t.is_folder, t.is_shortcut, t.target, t.size, t.modified, t.md5, t.rk, t.can_dl, $2::uuid, $16
         from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::boolean[], $9::boolean[], $10::text[], $11::bigint[],
                     $12::timestamptz[], $13::text[], $14::text[], $15::boolean[])
              as t(id, parent, path, name, mime, is_folder, is_shortcut, target, size, modified, md5, rk, can_dl)
       on conflict (source_id, content_domain, drive_file_id) do update set
         parent_drive_id = excluded.parent_drive_id, path = excluded.path, filename = excluded.filename, mime_type = excluded.mime_type,
         is_folder = excluded.is_folder, is_shortcut = excluded.is_shortcut, shortcut_target_id = excluded.shortcut_target_id,
         size_bytes = excluded.size_bytes, modified_time = excluded.modified_time, md5_checksum = excluded.md5_checksum,
         resource_key = excluded.resource_key, can_download = excluded.can_download, last_seen_job_id = excluded.last_seen_job_id
       where drive_inventory.last_seen_job_id is distinct from excluded.last_seen_job_id`,
      [sourceId, jobId, col('id'), col('parent'), col('path'), col('name'), col('mime'), col('isFolder'), col('isShortcut'),
        col('target'), col('size'), col('modified'), col('md5'), col('rk'), col('canDownload'), domain]);
  }
}

/**
 * @returns {done:true,counters} | {status:'CANCELLED'} | {interrupted:true} | {leaseLost:true}; nem loi khi loi khong phuc hoi duoc
 * (thu muc goc loi, loi tam het luot retry, vuot tran) de job thanh FAILED thay vi bo qua am tham.
 */
export async function scanSource({ pool, client, job, source, ctx, pageSize = 1000, batchSize = 200, maxFiles = 100_000, maxFolders = 10_000 }) {
  if (ctx.cancelled) return { status: 'CANCELLED' };
  if (ctx.shuttingDown) return { interrupted: true };
  if (job.checkpoint?.scan && ((isModelLibrarySource(source) && job.checkpoint.scan.scopePolicy !== MODEL_SCOPE_POLICY) || (job.checkpoint.scan.contentDomain ?? '3dmodels') !== (job.content_domain ?? '3dmodels')))
    throw apiError('FULL_SCAN_REQUIRED'); // Never resume a partially scanned old, wider tree.
  let scope;
  if (!job.checkpoint?.scan) {
    try { scope = await resolveModelScope(client, source, { signal: ctx.signal, contentDomain: job.content_domain ?? '3dmodels' }); }
    catch (error) {
      if (ctx.cancelled) return { status: 'CANCELLED' };
      if (ctx.shuttingDown) return { interrupted: true };
      throw error;
    }
  }
  const state = job.checkpoint?.scan ?? {
    contentDomain: job.content_domain ?? '3dmodels',
    scopePolicy: isModelLibrarySource(source) ? MODEL_SCOPE_POLICY : 'legacy-v1',
    queue: [{ id: scope.id, path: '', rk: scope.resourceKey, root: true }],
    pageToken: null, visited: [scope.id],
    counters: { scannedFolders: 0, scannedFiles: 0, skippedCount: 0, errorCount: 0 }, done: false,
  };
  if (state.done) return { done: true, counters: state.counters };
  const visited = new Set(state.visited);
  const persist = (extra = {}) => ctx.saveProgress({
    stage: 'SCANNING', counters: state.counters,
    checkpoint: { ...job.checkpoint, stage: 'SCANNING', scan: { ...state, visited: [...visited] } }, ...extra,
  });
  const enqueue = (id, path, rk) => {
    if (visited.has(id)) return;
    if (visited.size >= maxFolders) throw limitError();
    visited.add(id);
    state.queue.push({ id, path, rk: typeof rk === 'string' && RESOURCE_KEY.test(rk) ? rk : null });
  };

  while (state.queue.length) {
    const stop = ctx.cancelled ? { status: 'CANCELLED' } : ctx.shuttingDown ? { interrupted: true } : null;
    if (stop) return (await persist()) ? stop : { leaseLost: true };

    const folder = state.queue[0];
    let page;
    try {
      page = await client.listChildren(folder.id, {
        pageToken: state.pageToken ?? undefined, resourceKey: folder.rk ?? undefined, driveId: source.drive_id ?? undefined, pageSize, signal: ctx.signal,
      });
    } catch (error) {
      if (ctx.signal?.aborted) { if (ctx.cancelled || ctx.shuttingDown) continue; return { leaseLost: true }; }
      if (!folder.root && SAFE_FAILURES.has(error.code)) {
        // Thu muc con bien mat/mat quyen: ghi nhan roi quet tiep. Ten/duong dan lay tu hang inventory cua chinh thu muc do.
        await pool.query(
          `insert into drive_sync_job_items (job_id, drive_file_id, action, status, error_code) values ($1, $2, 'SCAN', 'FAILED', $3)
           on conflict (job_id, drive_file_id, action) do update set status = 'FAILED', error_code = excluded.error_code`,
          [job.id, folder.id, error.code]);
        state.counters.errorCount++;
        state.queue.shift(); state.pageToken = null;
        if (!(await persist())) return { leaseLost: true };
        continue;
      }
      throw error;
    }

    const rows = [];
    for (const f of page.files) {
      if (!f?.id || !validId(f.id)) { state.counters.skippedCount++; continue; }
      const isFolder = f.mimeType === FOLDER, isShortcut = f.mimeType === SHORTCUT;
      if (!isFolder && !isShortcut && String(f.mimeType).startsWith(GOOGLE_APPS)) { state.counters.skippedCount++; continue; }
      const path = folder.path ? `${folder.path}/${segment(f.name)}` : segment(f.name);
      rows.push(toRow(f, folder.id, path));
      if (isFolder) enqueue(f.id, path, f.resourceKey);
      else {
        state.counters.scannedFiles++;
        if (isShortcut && f.shortcutDetails?.targetMimeType === FOLDER && validId(f.shortcutDetails.targetId)) {
          enqueue(f.shortcutDetails.targetId, path, f.shortcutDetails.targetResourceKey);
        }
      }
    }
    await upsertRows(pool, source.id, job.id, rows, batchSize, job.content_domain ?? '3dmodels');
    if (state.counters.scannedFiles > maxFiles) throw limitError();

    state.pageToken = page.nextPageToken ?? null;
    if (!state.pageToken) { state.queue.shift(); state.counters.scannedFolders++; }
    if (!(await persist())) return { leaseLost: true };
  }

  state.done = true; visited.clear();
  const ok = await ctx.saveProgress({ stage: 'COMPARING', counters: state.counters, checkpoint: { ...job.checkpoint, stage: 'COMPARING', scan: { ...state, visited: [] } } });
  return ok ? { done: true, counters: state.counters } : { leaseLost: true };
}
