// D29 — Tải ảnh preview lên VPS. Mỗi danh mục có nút "Tải ảnh lên" (ảnh vào ĐÚNG danh mục đó); "Tải cả thư mục" ánh xạ
// <thư mục chọn>/Danh mục/Con/ảnh.jpg -> danh mục "Danh mục/Con" (tự tạo nếu thiếu). Tải tuần tự, song song 2; ảnh đã có chờ xác nhận mới thay.
import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { adminError, inputClass, secondary, primary } from './AdminShared.jsx';

const IMAGE = /\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 2;
const RESULT = { FULL: 'Đã ghép (đủ ảnh + zip)', PREVIEW_ONLY: 'Thiếu zip', EXISTS: 'Đã có ảnh — chờ xác nhận thay', COLLISION: 'Trùng tên ở danh mục khác (đã đưa vào Cần duyệt)' };

export function planItems(files, forcedCategory) {
  const items = [], skipped = [];
  for (const file of files) {
    if (!IMAGE.test(file.name)) { skipped.push(file.name); continue; }
    if (forcedCategory) { items.push({ file, category: forcedCategory }); continue; }
    const parts = (file.webkitRelativePath || '').split('/').slice(1, -1); // bỏ tên thư mục đã chọn và tên file
    items.push({ file, category: parts.join('/') });
  }
  return { items, skipped };
}

export default function AdminUpload({ onChanged }) {
  const [cats, setCats] = useState({ items: null, error: '' });
  const [run, setRun] = useState(null); // { rows: [{ name, category, status, message }], done, total, busy, pending, skipped }
  const refs = useRef({ cat: null, dir: null, forced: '' });
  const rows = useRef([]);

  const loadCats = () => api.adminCategories().then((d) => setCats({ items: d.items, error: '' }), (e) => setCats({ items: null, error: adminError(e) }));
  useEffect(() => { loadCats(); }, []);

  async function start(items, skipped, replace = false) {
    rows.current = items.map((it) => ({ ...it, name: it.file.name, status: 'wait', message: '' }));
    setRun({ rows: [...rows.current], done: 0, total: items.length, busy: true, skipped });
    let next = 0, done = 0;
    const flush = (busy) => setRun({ rows: [...rows.current], done, total: items.length, busy, skipped });
    async function worker() {
      while (next < rows.current.length) {
        const row = rows.current[next++];
        if (!row.category) { row.status = 'error'; row.message = 'Thiếu danh mục (ảnh nằm ngay trong thư mục gốc)'; }
        else {
          row.status = 'busy'; flush(true);
          try { const r = await api.adminUploadPreview(row.category, row.file, { replace }); row.status = 'ok'; row.message = RESULT[r.state] + (r.mismatch ? ' · lệch danh mục' : ''); }
          catch (e) {
            if (e.code === 'PREVIEW_EXISTS') { row.status = 'exists'; row.message = RESULT.EXISTS; }
            else if (e.code === 'PREVIEW_COLLISION') { row.status = 'collision'; row.message = RESULT.COLLISION; }
            else { row.status = 'error'; row.message = adminError(e); }
          }
        }
        done++; flush(true);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    flush(false); loadCats(); onChanged?.();
  }

  const pick = (category) => (event) => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    const { items, skipped } = planItems(files, category);
    start(items, skipped);
  };
  const pickFolder = (event) => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    const { items, skipped } = planItems(files, null);
    start(items, skipped);
  };
  const replaceAll = () => {
    const again = rows.current.filter((r) => r.status === 'exists').map(({ file, category }) => ({ file, category }));
    start(again, [], true);
  };
  const exists = run ? run.rows.filter((r) => r.status === 'exists') : [];
  const percent = run && run.total ? Math.round((run.done / run.total) * 100) : 0;

  return <div className="space-y-3 rounded-md border border-line p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="font-bold">Ảnh xem trước</h4><p className="text-xs text-mute">Chỉ model có đủ ảnh và file zip mới hiện trên thư viện. Ghép theo tên file (không phân biệt thư mục).</p></div>
      <label className={`${secondary} cursor-pointer`}>Tải cả thư mục
        <input type="file" name="uploadFolder" className="hidden" webkitdirectory="" multiple onChange={pickFolder} disabled={run?.busy} /></label>
    </div>
    {cats.error && <p role="alert" className="text-sm text-danger">{cats.error}</p>}
    {cats.items && cats.items.length === 0 && <p className="text-sm text-mute">Chưa có danh mục. Hãy chạy đồng bộ Drive hoặc dùng "Tải cả thư mục" để tạo danh mục theo cấu trúc thư mục.</p>}
    {cats.items && cats.items.length > 0 && <ul className="max-h-64 space-y-1 overflow-y-auto text-sm" aria-label="Danh mục">
      {cats.items.map((c) => <li key={c.id} data-category={c.fullPath} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-raised"
        style={{ paddingLeft: `${(c.fullPath.split(' / ').length - 1) * 16 + 8}px` }}>
        <span>{c.name} <span className="text-xs text-mute">({c.modelCount})</span></span>
        <label className={`${secondary} cursor-pointer text-xs`}>Tải ảnh lên
          <input type="file" name="uploadFiles" aria-label={`Tải ảnh lên ${c.fullPath}`} className="hidden" accept="image/jpeg,image/png,image/webp" multiple
            disabled={run?.busy} onChange={pick(c.fullPath.split(' / ').join('/'))} /></label>
      </li>)}
    </ul>}
    {run && <div className="space-y-2" aria-live="polite">
      <div className="h-2 overflow-hidden rounded bg-raised"><div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-full bg-accent" style={{ width: `${percent}%` }} /></div>
      <p className="text-xs text-mute">{run.done}/{run.total} ảnh{run.busy ? ' — đang tải…' : ' — xong'}{run.skipped?.length ? ` · bỏ qua ${run.skipped.length} file không phải ảnh` : ''}</p>
      {!run.busy && exists.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{exists.length} ảnh đã có sẵn. Thay bằng ảnh mới?</span><button className={primary} onClick={replaceAll}>Thay {exists.length} ảnh</button></div>}
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {run.rows.map((r, i) => <li key={i} data-status={r.status} className={r.status === 'error' || r.status === 'collision' ? 'text-danger' : 'text-mute'}>
          {r.name} — {r.status === 'wait' ? 'chờ' : r.status === 'busy' ? 'đang tải…' : r.message}</li>)}</ul>
    </div>}
  </div>;
}
