// P3.2 — Quet dong bo (plan §P3.2). Nguon su that la DB: man nay chi hien job moi nhat va tien do qua SSE,
// roi tu chuyen sang polling moi `pollMs` (3 giay) neu SSE loi. Khong co tong khi dang quet -> thanh khong xac dinh (khong gia phan tram).
import { useEffect, useState } from 'react';
import * as api from './api.js';
import ContentDomainTabs from './ContentDomainTabs.jsx';
import AdminSyncHistory from './AdminSyncHistory.jsx';
import { modeLabels, statusLabels } from './syncLabels.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCELLING']);
const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
const RETRYABLE = new Set(['FAILED', 'CANCELLED', 'COMPLETED_WITH_ERRORS']);
const stageLabels = { SCANNING: 'Đang quét thư mục', COMPARING: 'Đang so sánh/ghép dữ liệu', DOWNLOADING_PREVIEWS: 'Đang tải ảnh xem trước', PUBLISHING: 'Đang cập nhật thư viện' };
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
  const counters = job.mode === 'FULL'
    ? [['scannedFolders', 'Thư mục'], ['scannedFiles', 'File Drive'], ['new', 'Model mới'], ['updated', 'Thay đổi'], ['missing', 'Đã mất'], ['errors', 'Lỗi']]
    : [['new', 'Mới ghép'], ['updated', 'Cập nhật'], ['unchanged', 'Đã khớp'], ['review', 'Cần duyệt'], ['errors', 'Lỗi']];
  return <div className="space-y-4">
    {['RUNNING', 'CANCELLING'].includes(job.status) && <div role="progressbar" aria-label="Tiến độ đồng bộ" aria-busy="true" className="h-2 overflow-hidden rounded bg-raised">
      <div className="h-full w-1/3 rounded bg-accent animate-indeterminate" /></div>}
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {counters.map(([key, label]) => <div key={key} className="rounded-md border border-line bg-base px-3 py-2"><dt className="text-xs text-mute">{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{job.counters[key]}</dd></div>)}
    </dl>
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-mute">Bắt đầu</dt><dd className="mt-1">{dateTime(job.startedAt)}</dd></div>
      <div><dt className="text-xs text-mute">Kết thúc</dt><dd className="mt-1">{dateTime(job.finishedAt)}</dd></div>
      {Number(job.bytesDownloaded) > 0 && <div><dt className="text-xs text-mute">Dữ liệu đã tải ở lượt cũ</dt><dd className="mt-1">{megabytes(job.bytesDownloaded)}</dd></div>}
    </dl>
  </div>;
}

function Metric({ label, value, detail }) {
  return <div className="rounded-lg border border-line bg-base p-4">
    <dt className="text-sm text-mute">{label}</dt>
    <dd className="mt-1 text-2xl font-bold tabular-nums">{value == null ? '—' : Number(value).toLocaleString('vi-VN')}</dd>
    <p className="mt-1 text-xs text-mute">{detail}</p>
  </div>;
}

export default function AdminSync({ pollMs = 3000 }) {
  const [domain, setDomain] = useState("3dmodels");
  return <div className="space-y-5"><ContentDomainTabs value={domain} onChange={setDomain} /><SyncDomain key={domain} contentDomain={domain} pollMs={pollMs} /></div>;
}

function SyncDomain({ pollMs, contentDomain }) {
  const status = useAdminResource(api.adminDriveStatus, []);
  const latest = useAdminResource((signal) => api.adminSyncJobs({ limit: 1, contentDomain }, signal), []);
  const [jobId, setJobId] = useState(null);
  const [sourceId, setSourceId] = useState(null);
  const [mode, setMode] = useState('FULL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const [summaryKey, setSummaryKey] = useState(0);
  const { job, error: streamError } = useJob(jobId, pollMs);
  const sources = (status.data?.sources ?? []).filter((source) => source.enabled);
  const chosen = sourceId ?? sources[0]?.id ?? null;
  const summary = useAdminResource((signal) => chosen ? api.adminDriveSummary(chosen, signal, contentDomain) : Promise.resolve(null), [chosen, summaryKey]);

  useEffect(() => {
    if (job && TERMINAL.has(job.status)) {
      setHistoryKey((key) => key + 1);
      setSummaryKey((key) => key + 1);
    }
  }, [job?.id, job?.status]); // luot vua ket thuc: tai lai lich su va cac so lieu
  useEffect(() => { if (jobId === null && latest.data?.items?.[0]) setJobId(latest.data.items[0].id); }, [latest.data, jobId]);

  const active = Boolean(job && ACTIVE.has(job.status));
  const canFull = Boolean(status.data?.configured && chosen);
  const canIncremental = Boolean(chosen && summary.data?.hasFullScan);
  const canRun = mode === 'FULL' ? canFull : canIncremental;

  async function run(action, onDone) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onDone(await action()); }
    catch (e) { setError(adminError(e)); return e; }
    finally { setBusy(false); }
    return undefined;
  }
  const start = async () => {
    const e = await run(() => api.adminStartSync({ sourceId: chosen, mode, contentDomain }), ({ jobId: id }) => setJobId(id));
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
        {!status.data.configured && <p role="alert" className="text-sm text-warn">Chưa cấu hình khóa API Drive. Quét đầy đủ đang bị khóa; nếu nguồn đã có snapshot, mày vẫn có thể ghép preview.</p>}
        {status.data.configured && sources.length === 0 && <p className="text-sm text-mute">Chưa có thư mục gốc. Hãy lưu thư mục gốc ở mục "Kết nối Drive".</p>}
        <div className="flex flex-wrap items-end gap-3">
          {sources.length > 1 && <label className="text-sm"><span className="block text-mute">Nguồn</span>
            <select className={`${inputClass} mt-1 w-auto`} name="sourceId" disabled={active || busy} value={chosen ?? ''} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.rootFolderName}</option>)}</select></label>}
          {sources.length === 1 && <p className="text-sm"><span className="block text-mute">Nguồn</span><span className="mt-1 block">{sources[0].rootFolderName}</span></p>}
          <label className="text-sm"><span className="block text-mute">Kiểu quét</span>
            <select className={`${inputClass} mt-1 w-auto`} name="mode" disabled={active || busy} value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="FULL">Quét đầy đủ</option><option value="INCREMENTAL">Quét thay đổi · ghép preview</option></select></label>
          <button className={primary} disabled={!canRun || active || busy || (mode === 'INCREMENTAL' && summary.loading)} onClick={start}>Quét đồng bộ</button>
        </div>
        <div className="rounded-md border border-line bg-base p-3 text-sm" aria-live="polite" data-testid={mode === 'INCREMENTAL' ? 'incremental-note' : 'full-note'}>
          {mode === 'FULL' ? <>
            <h3 className="font-semibold">Quét đầy đủ</h3>
            <p className="mt-1 text-mute">Đọc lại toàn bộ thư mục Drive và thư mục con, chụp danh sách file ZIP/RAR/7Z rồi ghép với preview trên VPS. Dùng lần đầu hoặc sau khi thêm, xóa hay đổi tên file nén. Ảnh trên Drive không được tải xuống.</p>
            {!canFull && chosen && <p className="mt-2 text-warn">Cần cấu hình khóa API Drive để quét nguồn này.</p>}
          </> : <>
            <h3 className="font-semibold">Quét thay đổi: ghép preview với lần quét đầy đủ gần nhất</h3>
            <p className="mt-1 text-mute">Dùng snapshot file nén đã lưu để ghép với preview hiện có trên VPS; không gọi Drive. File mới, bị xóa hoặc đổi tên trên Drive sẽ chỉ được nhận ra sau lần quét đầy đủ tiếp theo.</p>
            {!summary.loading && !summary.data?.hasFullScan && <p className="mt-2 text-warn">Chưa có lần quét đầy đủ thành công. Hãy chạy “Quét đầy đủ” trước.</p>}
          </>}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      <div className={`${panel} space-y-4`}>
        <div><h3 className="font-bold">Tình trạng thư viện</h3>
          <p className="mt-1 text-sm text-mute">VPS lưu preview và thông tin file; file model vẫn nằm trên Drive, được lấy khi khách tải. Số preview tính một ảnh mỗi model, file nén lấy từ snapshot của nguồn đang chọn.</p></div>
        <dl className="grid gap-3 md:grid-cols-3">
          <Metric label="Ảnh preview trên VPS" value={summary.data?.previewCount} detail="Ảnh preview đã lưu, tính một ảnh mỗi model" />
          <Metric label="File nén (ZIP/RAR/7Z) trong Drive" value={summary.data?.hasFullScan ? summary.data.driveArchiveCount : null}
            detail={summary.data?.hasFullScan ? `Snapshot lần full gần nhất · ${dateTime(summary.data.lastFullScanAt)}` : 'Chưa có snapshot; chạy quét đầy đủ'} />
          <Metric label="Model sẵn sàng trên gallery/plugin" value={summary.data?.readyCount}
            detail="Đã công khai, có preview và file tải không bị báo lỗi hoặc hạn chế" />
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-mute">
          <span>Chờ ghép file nén: <strong className="text-ink">{summary.data?.previewOnlyCount == null ? '—' : Number(summary.data.previewOnlyCount).toLocaleString('vi-VN')}</strong></span>
          <span>Chờ ảnh preview: <strong className="text-ink">{summary.data?.archiveOnlyCount == null ? '—' : Number(summary.data.archiveOnlyCount).toLocaleString('vi-VN')}</strong></span>
          <span>Cần duyệt: <strong className="text-ink">{summary.data?.openReviewCount == null ? '—' : Number(summary.data.openReviewCount).toLocaleString('vi-VN')}</strong></span>
        </div>
        {summary.loading && chosen && <p role="status" className="text-xs text-mute">Đang tải số liệu…</p>}
        {summary.error && <div className="flex flex-wrap items-center gap-3 text-xs text-warn"><p role="status">Chưa tải được số liệu.</p>
          <button className={secondary} onClick={() => setSummaryKey((key) => key + 1)}>Tải lại số liệu</button></div>}
        {!chosen && <p className="text-xs text-mute">Chưa chọn nguồn Drive.</p>}
        {summary.data && !summary.data.hasFullScan && <p className="text-xs text-mute">Chưa có số lượng file nén từ Drive vì chưa chạy quét đầy đủ thành công.</p>}
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
      <AdminSyncHistory contentDomain={contentDomain} refreshKey={historyKey} />
    </>}
  </section>;
}
