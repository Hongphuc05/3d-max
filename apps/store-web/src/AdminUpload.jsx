// Upload ảnh preview cho danh mục đang mở hoặc kiểm tra toàn bộ folder 3dsmood trước khi gửi.
import { useRef, useState } from 'react';
import * as api from './api.js';
import { adminError, primary, secondary } from './AdminShared.jsx';
import { validatePreviewFolder } from './admin-models-utils.js';

const IMAGE = /\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 2;
const RESULT = { FULL: 'Đã ghép (đủ ảnh + zip)', PREVIEW_ONLY: 'Thiếu zip', EXISTS: 'Đã có ảnh — chờ xác nhận thay', COLLISION: 'Trùng tên ở danh mục khác (đã đưa vào Cần duyệt)' };

export function planItems(files, forcedCategory) {
  const items = [], skipped = [];
  for (const file of files) {
    if (!IMAGE.test(file.name)) { skipped.push(file.name); continue; }
    if (forcedCategory) items.push({ file, category: forcedCategory });
    else {
      const parts = String(file.webkitRelativePath ?? '').split('/').slice(1, -1);
      items.push({ file, category: parts.join('/') });
    }
  }
  return { items, skipped };
}

export default function AdminUpload({ contentDomain = '3dmodels', categories = [], categoriesLoading = false, selectedCategory, onChanged }) {
  const [run, setRun] = useState(null);
  const [validation, setValidation] = useState(null);
  const rows = useRef([]);
  const selectedPath = selectedCategory?.fullPath?.split(' / ').join('/') ?? '';
  const busy = Boolean(run?.busy);

  async function start(items, skipped = [], ignored = [], replace = false) {
    setValidation(null);
    rows.current = items.map((it) => ({ ...it, name: it.file.name, status: 'wait', message: '' }));
    setRun({ rows: [...rows.current], done: 0, total: items.length, busy: true, skipped, ignored });
    let next = 0, done = 0;
    const flush = (isBusy) => setRun({ rows: [...rows.current], done, total: items.length, busy: isBusy, skipped, ignored });
    async function worker() {
      while (next < rows.current.length) {
        const row = rows.current[next++];
        row.status = 'busy'; flush(true);
        try {
          const result = await api.adminUploadPreview(row.category, row.file, { replace, contentDomain });
          row.status = 'ok'; row.message = `${RESULT[result.state] || 'Đã tải lên'}${result.mismatch ? ' · lệch danh mục' : ''}`;
        } catch (error) {
          if (error.code === 'PREVIEW_EXISTS') { row.status = 'exists'; row.message = RESULT.EXISTS; }
          else if (error.code === 'PREVIEW_COLLISION') { row.status = 'collision'; row.message = RESULT.COLLISION; }
          else { row.status = 'error'; row.message = adminError(error); }
        }
        done++; flush(true);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    flush(false);
    onChanged?.();
  }

  const pickCategory = (event) => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    const { items, skipped } = planItems(files, selectedPath);
    if (!items.length) {
      setRun(null);
      setValidation({ errors: ['Không tìm thấy ảnh JPG, JPEG, PNG hoặc WEBP.'], ignored: skipped });
      return;
    }
    start(items, skipped);
  };

  const pickFolder = (event) => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    const result = validatePreviewFolder(files, categories, { contentDomain });
    if (result.errors.length) {
      setRun(null);
      setValidation(result);
      return;
    }
    start(result.items, [], result.ignored);
  };

  const replaceAll = () => {
    const again = rows.current.filter((row) => row.status === 'exists').map(({ file, category }) => ({ file, category }));
    if (again.length) start(again, [], run?.ignored ?? [], true);
  };
  const exists = run ? run.rows.filter((row) => row.status === 'exists') : [];
  const failed = run ? run.rows.filter((row) => row.status === 'error') : [];
  const percent = run?.total ? Math.round((run.done / run.total) * 100) : 0;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className={`${secondary} cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
        Tải folder preview
        <input type="file" name="uploadFolder" className="hidden" webkitdirectory="" multiple onChange={pickFolder} disabled={busy || categoriesLoading || categories.length === 0} />
      </label>
      {selectedCategory ? <label className={`${primary} cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
        Thêm ảnh preview
        <input type="file" name="uploadFiles" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={pickCategory} disabled={busy} />
      </label> : <span className="text-xs text-mute">Chọn một danh mục để thêm ảnh trực tiếp.</span>}
      {selectedCategory && <span className="text-xs text-mute">Ảnh mới sẽ vào {selectedCategory.fullPath}.</span>}
    </div>

    {categoriesLoading && <p role="status" className="text-xs text-mute">Đang tải danh mục để kiểm tra cấu trúc folder…</p>}
    {!categoriesLoading && categories.length === 0 && <p role="status" className="text-xs text-warn">Chưa có danh mục để đối chiếu folder. Hãy quét đồng bộ Drive trước.</p>}
    {validation?.errors?.length > 0 && <div role="alert" className="space-y-1 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
      <p className="font-bold">Folder không đúng cấu trúc. Chưa có ảnh nào được tải lên.</p>
      <ul className="max-h-40 list-inside list-disc space-y-1 overflow-auto">
        {validation.errors.slice(0, 20).map((error, i) => <li key={`${i}-${error}`}>{error}</li>)}
      </ul>
      {validation.errors.length > 20 && <p>Còn {validation.errors.length - 20} lỗi khác.</p>}
      {validation.ignored?.length > 0 && <p className="text-mute">Bỏ qua {validation.ignored.length} file metadata của macOS.</p>}
    </div>}

    {run && <div className="space-y-2 rounded-md border border-line bg-base p-3" aria-live="polite">
      <div className="h-2 overflow-hidden rounded bg-raised"><div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
      <p className="text-xs text-mute">{run.done}/{run.total} ảnh{run.busy ? ' — đang tải…' : ' — hoàn tất'}{run.skipped?.length ? ` · bỏ qua ${run.skipped.length} file không phải ảnh` : ''}{run.ignored?.length ? ` · bỏ qua ${run.ignored.length} file metadata` : ''}</p>
      {!run.busy && failed.length > 0 && <button className={secondary} onClick={() => start(failed.map(({ file, category }) => ({ file, category })))}>
        Thử lại {failed.length} ảnh lỗi
      </button>}
      {!run.busy && exists.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{exists.length} ảnh đã có sẵn. Thay bằng ảnh mới?</span><button className={primary} onClick={replaceAll}>Thay {exists.length} ảnh</button>
      </div>}
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {run.rows.map((row, i) => <li key={`${row.name}-${i}`} data-status={row.status} className={row.status === 'error' || row.status === 'collision' ? 'text-danger' : 'text-mute'}>
          {row.name} — {row.status === 'wait' ? 'chờ' : row.status === 'busy' ? 'đang tải…' : row.message}
        </li>)}
      </ul>
    </div>}
  </div>;
}
