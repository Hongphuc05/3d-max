// P3.2 — Quet dong bo (plan §P3.2). Nguon su that la DB: man nay chi hien job moi nhat va tien do qua SSE,
// roi tu chuyen sang polling moi `pollMs` (3 giay) neu SSE loi. Khong co tong khi dang quet -> thanh khong xac dinh (khong gia phan tram).
import { useEffect, useState } from 'react';
import * as api from './api.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCELLING']);
const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
const RETRYABLE = new Set(['FAILED', 'CANCELLED', 'COMPLETED_WITH_ERRORS']);
const statusLabels = { QUEUED: 'Đang chờ', RUNNING: 'Đang chạy', CANCELLING: 'Đang hủy', CANCELLED: 'Đã hủy', COMPLETED: 'Hoàn tất', COMPLETED_WITH_ERRORS: 'Hoàn tất, có lỗi', FAILED: 'Thất bại' };
const stageLabels = { SCANNING: 'Đang quét thư mục', COMPARING: 'Đang so sánh', DOWNLOADING_PREVIEWS: 'Đang tải ảnh xem trước', PUBLISHING: 'Đang công bố' };
const counterLabels = [['scannedFolders', 'Thư mục đã quét'], ['scannedFiles', 'File đã quét'], ['new', 'Mới'], ['updated', 'Cập nhật'], ['unchanged', 'Không đổi'],
  ['missing', 'Không còn trên Drive'], ['review', 'Cần duyệt'], ['skipped', 'Bỏ qua'], ['errors', 'Lỗi']];
const modeLabels = { FULL: 'Quét đầy đủ', INCREMENTAL: 'Quét thay đổi' };
const megabytes = (n) => `${(Number(n) / 1048576).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;

// Theo doi mot job: SSE truoc, loi thi polling. Don dep ca hai khi doi job hoac roi man hinh.
function useJob(jobId, pollMs) {
  const [state, setState] = useState({ job: null, error: '' });
  useEffect(() => {
    setState({ job: null, error: '' });
    if (!jobId) return undefined;
    let closed = false, source = null, timer = null;
    const stop = () => { closed = true; source?.close(); clearInterval(timer); };
    const show = (job) => { if (!closed) setState({ job, error: '' }); };
    const poll = () => {
      const tick = async () => {
        try {
          const job = await api.adminSyncJob(jobId);
          if (closed) return;
          show(job);
          if (TERMINAL.has(job.status)) stop();
        } catch (error) {
          if (closed || !(error?.status >= 400 && error.status < 500)) return; // loi mang tam thoi: lan sau thu lai
          setState((s) => ({ ...s, error: adminError(error) })); stop();
        }
      };
      tick();
      timer = setInterval(tick, pollMs);
    };
    if (typeof globalThis.EventSource === 'function') {
      source = new globalThis.EventSource(api.syncEventsUrl(jobId));
      source.addEventListener('progress', (event) => show(JSON.parse(event.data)));
      source.addEventListener('done', (event) => { show(JSON.parse(event.data)); stop(); });
      source.onerror = () => { source.close(); source = null; if (!closed) poll(); };
    } else poll();
    return stop;
  }, [jobId, pollMs]);
  return state;
}

function Progress({ job }) {
  return <div className="space-y-4">
    {['RUNNING', 'CANCELLING'].includes(job.status) && <div role="progressbar" aria-label="Tiến độ đồng bộ" aria-busy="true" className="h-2 overflow-hidden rounded bg-raised">
      <div className="h-full w-1/3 rounded bg-accent motion-safe:animate-pulse" /></div>}
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-5">
      {counterLabels.map(([key, label]) => <div key={key} className="bg-panel px-4 py-3"><dt className="text-xs text-mute">{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{job.counters[key]}</dd></div>)}
    </dl>
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-mute">Dung lượng đã tải</dt><dd className="mt-1">{megabytes(job.bytesDownloaded)}</dd></div>
      <div><dt className="text-xs text-mute">Bắt đầu</dt><dd className="mt-1">{dateTime(job.startedAt)}</dd></div>
      <div><dt className="text-xs text-mute">Kết thúc</dt><dd className="mt-1">{dateTime(job.finishedAt)}</dd></div>
    </dl>
  </div>;
}

export default function AdminSync({ pollMs = 3000 }) {
  const status = useAdminResource(api.adminDriveStatus, []);
  const latest = useAdminResource((signal) => api.adminSyncJobs({ limit: 1 }, signal), []);
  const [jobId, setJobId] = useState(null);
  const [sourceId, setSourceId] = useState(null);
  const [mode, setMode] = useState('FULL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { job, error: streamError } = useJob(jobId, pollMs);

  useEffect(() => { if (jobId === null && latest.data?.items?.[0]) setJobId(latest.data.items[0].id); }, [latest.data, jobId]);

  const sources = (status.data?.sources ?? []).filter((source) => source.enabled);
  const chosen = sourceId ?? sources[0]?.id ?? null;
  const active = Boolean(job && ACTIVE.has(job.status));
  const ready = Boolean(status.data?.configured && chosen);

  async function run(action, onDone) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onDone(await action()); }
    catch (e) { setError(adminError(e)); return e; }
    finally { setBusy(false); }
    return undefined;
  }
  const start = async () => {
    const e = await run(() => api.adminStartSync({ sourceId: chosen, mode }), ({ jobId: id }) => setJobId(id));
    if (e?.code === 'SYNC_ALREADY_RUNNING') { // da co job dang chay: gan vao no thay vi de man hinh mu
      try { const list = await api.adminSyncJobs({ limit: 1 }); if (list.items[0]) setJobId(list.items[0].id); } catch { /* giu thong bao loi */ }
    }
  };
  const cancel = () => run(() => api.adminCancelSync(jobId), () => {});
  const retry = () => run(() => api.adminRetrySync(jobId), ({ jobId: id }) => setJobId(id));

  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Quét đồng bộ</h2></div>
    <ResourceState loading={status.loading || latest.loading} error={status.error || latest.error} retry={() => globalThis.location.reload()} />
    {status.data && latest.data && <>
      <div className={`${panel} space-y-4`}>
        {!status.data.configured && <p role="alert" className="text-sm text-warn">Chưa cấu hình khóa API Drive trên máy chủ. Xem mục "Kết nối Drive".</p>}
        {status.data.configured && sources.length === 0 && <p className="text-sm text-mute">Chưa có thư mục gốc. Hãy lưu thư mục gốc ở mục "Kết nối Drive".</p>}
        <div className="flex flex-wrap items-end gap-3">
          {sources.length > 1 && <label className="text-sm"><span className="block text-mute">Nguồn</span>
            <select className={`${inputClass} mt-1 w-auto`} name="sourceId" disabled={active || busy} value={chosen ?? ''} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.rootFolderName}</option>)}</select></label>}
          {sources.length === 1 && <p className="text-sm"><span className="block text-mute">Nguồn</span><span className="mt-1 block">{sources[0].rootFolderName}</span></p>}
          <label className="text-sm"><span className="block text-mute">Kiểu quét</span>
            <select className={`${inputClass} mt-1 w-auto`} name="mode" disabled={active || busy} value={mode} onChange={(event) => setMode(event.target.value)}>
              {Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className={primary} disabled={!ready || active || busy} onClick={start}>Quét đồng bộ</button>
        </div>
        {mode === 'INCREMENTAL' && <p data-testid="incremental-note" className="text-xs text-warn">Lưu ý: "Quét thay đổi" hiện chưa khác "Quét đầy đủ" — máy chủ vẫn quét toàn bộ thư viện. Chế độ này sẽ được bổ sung ở phase sau.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      {(job || streamError) && <div className={`${panel} space-y-4`} aria-live="polite">
        {streamError && <p role="alert" className="text-sm text-danger">{streamError}</p>}
        {job && <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-bold">{statusLabels[job.status] || job.status}</h3>
              <p className="mt-1 text-sm text-mute">{modeLabels[job.mode] || job.mode}{job.stage ? ` · ${stageLabels[job.stage] || job.stage}` : ''}</p></div>
            <div className="flex gap-2">
              {['QUEUED', 'RUNNING'].includes(job.status) && <button className={secondary} disabled={busy} onClick={cancel}>Hủy</button>}
              {RETRYABLE.has(job.status) && <button className={secondary} disabled={busy || active} onClick={retry}>Thử lại</button>}
            </div>
          </div>
          {job.status === 'FAILED' && <p className="text-sm text-danger">{job.errorMessage || job.errorCode}</p>}
          <Progress job={job} />
        </>}
      </div>}
    </>}
  </section>;
}
