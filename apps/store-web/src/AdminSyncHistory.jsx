// P3.3 — Lich su cac luot dong bo + danh sach file loi (plan §P3.3). Nguon: GET /sync-jobs (con tro) va /sync-jobs/:id/items?status=FAILED.
// Chi hien ten file + duong dan, khong bao gio hien ID Drive hay ID nguon noi bo, ke ca khi payload lo them truong.
import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { actionLabels, modeLabels, statusLabels } from './syncLabels.js';
import { adminError, dateTime, panel, secondary } from './AdminShared.jsx';

const PAGE = 10;
const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';
const megabytes = (n) => `${(Number(n) / 1048576).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
const hasErrors = (job) => job.counters.errors > 0 || job.status === 'FAILED';
const summary = (c) => `${c.scannedFiles} file · ${c.new} mới · ${c.updated} cập nhật · ${c.unchanged} không đổi · ${c.errors} lỗi`;

function JobErrors({ job }) {
  const [state, setState] = useState({ items: null, error: '' });
  useEffect(() => {
    let stale = false;
    api.adminSyncItems(job.id).then(
      (items) => { if (!stale) setState({ items, error: '' }); },
      (error) => { if (!stale) setState({ items: null, error: adminError(error) }); });
    return () => { stale = true; };
  }, [job.id]);
  const { items, error } = state;
  return <div className="space-y-3">
    {job.errorMessage && <p className="text-sm text-danger">{job.errorMessage}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!items && !error && <p className="text-sm text-mute">Đang tải lỗi…</p>}
    {items?.length === 0 && <p className="text-sm text-mute">Không có file lỗi riêng.</p>}
    {items?.length > 0 && <div className="overflow-x-auto"><table className="w-full">
      <thead><tr><th className={th}>Tên file</th><th className={th}>Đường dẫn</th><th className={th}>Bước</th><th className={th}>Mã lỗi</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={index}>
        <td className={`${td} break-all`}>{item.driveFileName ?? 'Không rõ tên'}</td>
        <td className={`${td} break-all text-mute`}>{item.path ?? '—'}</td>
        <td className={td}>{actionLabels[item.action] || item.action}</td>
        <td className={`${td} font-mono text-xs`}>{item.errorCode}{item.errorMessage ? <span className="block text-mute">{item.errorMessage}</span> : null}</td>
      </tr>)}</tbody></table>
      {items.length >= 500 && <p className="mt-2 text-xs text-mute">Hiển thị tối đa 500 lỗi đầu tiên.</p>}</div>}
  </div>;
}

export default function AdminSyncHistory({ refreshKey = 0 }) {
  const [state, setState] = useState({ items: [], next: null, loading: true, error: '' });
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => { // trang dau: khi mo man hinh, khi refreshKey doi (mot luot vua ket thuc), khi bam Thu lai
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.adminSyncJobs({ limit: PAGE }).then(
      (page) => { if (!stale) setState({ items: page.items, next: page.nextCursor, loading: false, error: '' }); },
      (error) => { if (!stale) setState((s) => ({ ...s, loading: false, error: adminError(error) })); });
    return () => { stale = true; };
  }, [refreshKey, retryTick]);

  async function loadMore() {
    if (more || !state.next) return;
    setMore(true);
    try {
      const page = await api.adminSyncJobs({ limit: PAGE, cursor: state.next });
      if (mounted.current) setState((s) => ({ ...s, items: [...s.items, ...page.items], next: page.nextCursor, error: '' }));
    } catch (error) { if (mounted.current) setState((s) => ({ ...s, error: adminError(error) })); }
    finally { if (mounted.current) setMore(false); }
  }

  return <section className={`${panel} space-y-4`}>
    <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Lịch sử đồng bộ</h3>
      <button className={secondary} disabled={state.loading} onClick={() => setRetryTick((value) => value + 1)}>Làm mới</button></div>
    {state.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger"><p>{state.error}</p>
      {state.items.length === 0 && <button className={secondary} onClick={() => setRetryTick((value) => value + 1)}>Thử lại</button>}</div>}
    {state.loading && state.items.length === 0 && !state.error && <p role="status" className="text-sm text-mute">Đang tải lịch sử…</p>}
    {!state.loading && !state.error && state.items.length === 0 && <p className="py-3 text-sm text-mute">Chưa có lượt đồng bộ nào.</p>}
    {state.items.length > 0 && <div className="overflow-x-auto"><table className="w-full">
      <thead><tr><th className={th}>Thời gian</th><th className={th}>Kiểu</th><th className={th}>Kết quả</th><th className={th}>Số liệu</th><th className={th}>Dung lượng</th><th className={th}>Lỗi</th></tr></thead>
      <tbody>{state.items.flatMap((job) => [
        <tr key={job.id} data-job={job.id}>
          <td className={`${td} whitespace-nowrap text-xs text-mute`}>{dateTime(job.startedAt ?? job.finishedAt)}</td>
          <td className={td}>{modeLabels[job.mode] || job.mode}</td>
          <td className={td}>{statusLabels[job.status] || job.status}</td>
          <td className={`${td} text-xs`}>{summary(job.counters)}</td>
          <td className={`${td} whitespace-nowrap text-xs`}>{megabytes(job.bytesDownloaded)}</td>
          <td className={td}>{hasErrors(job) && <button className={secondary} onClick={() => setOpen(open === job.id ? null : job.id)}>{open === job.id ? 'Ẩn lỗi' : 'Xem lỗi'}</button>}</td>
        </tr>,
        open === job.id && <tr key={`${job.id}-errors`}><td className={td} colSpan={6}><JobErrors job={job} /></td></tr>,
      ])}</tbody></table></div>}
    {state.next && <button className={secondary} disabled={more} onClick={loadMore}>Xem thêm</button>}
  </section>;
}
