// Quan tri model theo bo cuc gallery: cay danh muc, luoi preview, upload gan danh muc dang xem.
import { useEffect, useMemo, useState } from 'react';
import * as api from './api.js';
import AdminUpload from './AdminUpload.jsx';
import { adminError, inputClass, Pagination, primary, ResourceState, secondary } from './AdminShared.jsx';
import { Icon } from './icons.jsx';
import { buildAdminCategoryTree } from './admin-models-utils.js';

const PAGE = 30;
const statusLabels = { PUBLISHED: 'Đang bán', HIDDEN: 'Đã ẩn', NEEDS_REVIEW: 'Cần duyệt', DRAFT: 'Nháp' };
const EDITABLE = ['PUBLISHED', 'HIDDEN'];
const stateLabels = { FULL: 'Đủ ảnh + zip', PREVIEW_ONLY: 'Thiếu zip', ARCHIVE_ONLY: 'Thiếu ảnh' };

function CategoryNode({ node, selectedId, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  return <li>
    <div className={`flex items-center gap-1 rounded-md pr-2 ${selectedId === node.id ? 'bg-accent/10 text-accent' : 'text-mute hover:bg-raised hover:text-fg'}`} style={{ paddingLeft: `${depth * 14 + 4}px` }}>
      {hasChildren ? <button type="button" aria-label={`${open ? 'Thu gọn' : 'Mở'} ${node.name}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="grid size-7 shrink-0 place-items-center">
        <Icon name="chevron" className={`size-3.5 transition ${open ? 'rotate-90' : ''}`} />
      </button> : <span className="size-7 shrink-0" />}
      <button type="button" aria-current={selectedId === node.id ? 'page' : undefined} onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm">
        <Icon name="cube" className="size-4 shrink-0 opacity-70" />
        <span className="flex-1 truncate" title={node.fullPath}>{node.name}</span>
        <span className="font-mono text-[10px] opacity-70">{node.count}</span>
      </button>
    </div>
    {open && hasChildren && <ul className="space-y-px">{node.children.map((child) => <CategoryNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />)}</ul>}
  </li>;
}

function ModelCard({ model, editing, onEdit, onCancel, onSaved, onDeleted }) {
  const [name, setName] = useState(model.name);
  const [status, setStatus] = useState(model.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!editing) { setName(model.name); setStatus(model.status); setError(''); }
  }, [model.name, model.status, editing]);

  async function save() {
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 300) { setError('Tên model cần từ 1 đến 300 ký tự.'); return; }
    const body = {};
    if (cleanName !== model.name) body.name = cleanName;
    if (status !== model.status && EDITABLE.includes(status)) body.status = status;
    if (!Object.keys(body).length) { onCancel(); return; }
    setBusy(true); setError('');
    try { onSaved(await api.adminPatchModel(model.id, body)); onCancel(); }
    catch (e) { setError(adminError(e)); }
    finally { setBusy(false); }
  }

  async function deletePreview() {
    setBusy(true); setError('');
    try { await api.adminDeletePreview(model.id); onDeleted(); }
    catch (e) { setError(adminError(e)); setConfirmDelete(false); }
    finally { setBusy(false); }
  }

  const stateLabel = model.categoryMismatch ? 'Lệch danh mục' : (stateLabels[model.state] || model.state);
  return <article data-model={model.id} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel transition hover:border-mute/60">
    <div className="relative aspect-square w-full overflow-hidden bg-white">
      {model.thumbUrl
        ? <img src={model.thumbUrl} alt={model.name} loading="lazy" className="size-full object-contain transition duration-300 group-hover:scale-[1.03]" />
        : <div className="grid size-full place-items-center bg-raised text-center font-mono text-xs text-mute">Chưa có ảnh preview</div>}
      <span data-state={model.state} className={`absolute left-2 top-2 rounded border px-2 py-1 text-[10px] shadow-sm ${model.state === 'FULL' ? 'border-accent/40 bg-base/90 text-accent' : 'border-line bg-base/90 text-mute'}`}>{stateLabel}</span>
    </div>
    <div className="flex min-h-32 flex-1 flex-col gap-2 p-3">
      {editing ? <input className={inputClass} name="editName" maxLength={300} value={name} onChange={(event) => setName(event.target.value)} aria-label={`Tên model ${model.name}`} />
        : <h3 className="min-h-10 line-clamp-2 text-sm font-bold" title={model.name}>{model.name}</h3>}
      <div className="flex items-center justify-between gap-2 text-[11px] text-mute">
        <span className="truncate" title={model.categoryPath}>{model.categoryPath}</span>
        <span className="shrink-0">{statusLabels[model.status] || model.status}</span>
      </div>
      {model.nameOverridden && <span className="text-[10px] text-mute">Tên đã sửa tay</span>}
      {editing && <select className={`${inputClass} py-1.5`} name="editStatus" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Trạng thái model">
        {!EDITABLE.includes(model.status) && <option value={model.status} disabled>{statusLabels[model.status] || model.status}</option>}
        {EDITABLE.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
      </select>}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {editing ? <><button className={primary} disabled={busy} onClick={save}>Lưu</button><button className={secondary} disabled={busy} onClick={onCancel}>Hủy</button></>
          : <><button className={secondary} disabled={busy} onClick={onEdit}>Sửa</button>
            {model.state !== 'ARCHIVE_ONLY' && (confirmDelete
              ? <><button className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger disabled:opacity-40" disabled={busy} onClick={deletePreview}>Xóa ảnh</button><button className={secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>Hủy</button></>
              : <button className={secondary} disabled={busy} onClick={() => setConfirmDelete(true)}>Xóa preview</button>)}</>}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  </article>;
}

export default function AdminModels() {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [stateFilter, setStateFilter] = useState('');
  const [draft, setDraft] = useState({ q: '', status: '', state: '' });
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const [categoryState, setCategoryState] = useState({ items: null, loading: true, error: '' });
  const [modelState, setModelState] = useState({ data: null, loading: true, error: '' });

  useEffect(() => {
    let stale = false;
    setCategoryState((current) => ({ ...current, loading: true, error: '' }));
    api.adminCategories().then((result) => { if (!stale) setCategoryState({ items: result.items, loading: false, error: '' }); },
      (error) => { if (!stale) setCategoryState({ items: null, loading: false, error: adminError(error) }); });
    return () => { stale = true; };
  }, [version]);

  useEffect(() => {
    let stale = false;
    setModelState((current) => ({ ...current, loading: true, error: '' }));
    api.adminModels({ q: query, status, state: stateFilter, categoryId: selectedCategoryId, page, limit: PAGE }).then(
      (data) => { if (!stale) setModelState({ data, loading: false, error: '' }); },
      (error) => { if (!stale) setModelState({ data: null, loading: false, error: adminError(error) }); });
    return () => { stale = true; };
  }, [query, status, stateFilter, selectedCategoryId, page, version]);

  const categoryTree = useMemo(() => buildAdminCategoryTree(categoryState.items || []), [categoryState.items]);
  const categoryById = useMemo(() => new Map((categoryState.items || []).map((item) => [item.id, item])), [categoryState.items]);
  const selectedCategory = categoryById.get(selectedCategoryId) || null;
  const totalCategoryModels = categoryTree.reduce((sum, item) => sum + item.count, 0);
  const data = modelState.data;

  function search(event) {
    event.preventDefault();
    setQuery(draft.q.trim()); setStatus(draft.status); setStateFilter(draft.state); setPage(1);
  }
  function selectCategory(id) { setSelectedCategoryId(id); setPage(1); }
  function replace(updated) {
    setModelState((current) => ({ ...current, data: { ...current.data, items: current.data.items.map((item) => item.id === updated.id ? updated : item) } }));
  }

  return <div className="grid min-h-[70vh] min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-line bg-base lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
    <aside className="min-h-0 border-b border-line bg-panel lg:border-b-0 lg:border-r" aria-label="Danh mục model">
      <div className="border-b border-line p-4">
        <p className="font-mono text-[10px] tracking-[0.16em] text-accent">BỘ LỌC</p>
        <h2 className="mt-1 font-bold">Danh mục</h2>
      </div>
      <nav className="max-h-[38vh] overflow-auto p-2 lg:max-h-[calc(100vh-260px)]">
        <button type="button" aria-current={!selectedCategoryId ? 'page' : undefined} onClick={() => selectCategory('')}
          className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${!selectedCategoryId ? 'bg-accent/10 font-bold text-accent' : 'text-mute hover:bg-raised hover:text-fg'}`}>
          <Icon name="cube" className="size-4" /><span className="flex-1">Tất cả danh mục</span><span className="font-mono text-[10px]">{totalCategoryModels}</span>
        </button>
        {categoryTree.length > 0 && <ul className="space-y-px">{categoryTree.map((node) => <CategoryNode key={node.id} node={node} selectedId={selectedCategoryId} onSelect={selectCategory} />)}</ul>}
        {categoryState.loading && <p role="status" className="px-3 py-4 text-xs text-mute">Đang tải danh mục…</p>}
        {categoryState.error && <p role="alert" className="px-3 py-4 text-xs text-danger">{categoryState.error}</p>}
      </nav>
    </aside>

    <section className="min-w-0 p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-48 flex-1">
          <p className="font-mono text-[10px] tracking-[0.16em] text-accent">3DS MOOD / ADMIN</p>
          <h2 className="mt-1 text-xl font-bold">{selectedCategory?.name || 'Tất cả model'}</h2>
          <p className="mt-1 text-xs text-mute">{selectedCategory?.fullPath || 'Chọn một category để lọc model và thêm preview vào đúng danh mục.'}</p>
        </div>
        <div className="w-full xl:w-auto xl:min-w-80">
          <AdminUpload categories={categoryState.items || []} categoriesLoading={categoryState.loading} selectedCategory={selectedCategory} onChanged={() => setVersion((value) => value + 1)} />
        </div>
      </header>

      <form role="search" className="mb-4 flex flex-wrap items-center gap-2" onSubmit={search}>
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-accent">
          <Icon name="search" className="size-3.5 text-mute" />
          <input className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-mute" name="q" aria-label="Tìm model" placeholder="Tìm model…" maxLength={100} value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
        </label>
        <select className={`${inputClass} w-auto`} name="statusFilter" aria-label="Lọc theo trạng thái" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
          <option value="">Tất cả trạng thái</option>{Object.entries({ PUBLISHED: 'Đang bán', HIDDEN: 'Đã ẩn', NEEDS_REVIEW: 'Cần duyệt', DRAFT: 'Nháp' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className={`${inputClass} w-auto`} name="stateFilter" aria-label="Lọc theo trạng thái ảnh" value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })}>
          <option value="">Mọi trạng thái ảnh</option>{Object.entries({ FULL: 'Đủ ảnh + zip', PREVIEW_ONLY: 'Thiếu zip', ARCHIVE_ONLY: 'Thiếu ảnh', MISMATCH: 'Lệch danh mục' }).map(([value, label]) => <option key={value} value={value}>{label}{data?.counts ? ` (${data.counts[value] || 0})` : ''}</option>)}
        </select>
        <button className={secondary}>Tìm kiếm</button>
        <button type="button" className={secondary} onClick={() => setVersion((value) => value + 1)}>Làm mới</button>
        <span className="ml-auto font-mono text-xs text-mute">{data ? `${data.total} model` : ''}</span>
      </form>

      <ResourceState loading={modelState.loading && !data} error={modelState.error} retry={() => setVersion((value) => value + 1)} />
      {data && data.items.length === 0 && <p className="py-16 text-center text-sm text-mute">Không có model nào trong danh mục này.</p>}
      {data && data.items.length > 0 && <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {data.items.map((model) => <ModelCard key={model.id} model={model} editing={editingId === model.id}
          onEdit={() => setEditingId(model.id)} onCancel={() => setEditingId(null)} onSaved={replace} onDeleted={() => setVersion((value) => value + 1)} />)}
      </div>}
      {data && data.total > PAGE && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
    </section>
  </div>;
}
