// P3.7 — Bang model (plan §2.7): tim, loc, phan trang; sua ten / gia / an-hien. Chi gui truong da doi. Khong hien ID nao ngoai mot dinh danh DOM.
// Dong duoc cap nhat tai cho sau khi luu (khong tai lai ca danh sach). Chi mot dong o che do sua tai mot thoi diem.
import { useEffect, useState } from 'react';
import * as api from './api.js';
import { adminError, inputClass, panel, Pagination, primary, ResourceState, secondary } from './AdminShared.jsx';

const PAGE = 20;
const PRICE_MAX = 100_000_000;
const statusLabels = { PUBLISHED: 'Đang bán', HIDDEN: 'Đã ẩn', NEEDS_REVIEW: 'Cần duyệt', DRAFT: 'Nháp' };
const EDITABLE = ['PUBLISHED', 'HIDDEN'];
const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';

function Row({ model, editing, onEdit, onSaved, onCancel }) {
  const [state, setState] = useState({ name: model.name, price: String(model.priceVnd), status: model.status, busy: false, error: '' });
  const set = (patch) => setState((s) => ({ ...s, ...patch, error: '' }));
  useEffect(() => { if (editing) setState({ name: model.name, price: String(model.priceVnd), status: model.status, busy: false, error: '' }); }, [editing]); // mo lai = bat dau tu gia tri da luu

  async function save() {
    if (state.busy) return;
    const name = state.name.trim();
    if (!name) return setState((s) => ({ ...s, error: 'Tên không được để trống.' }));
    if (name.length > 300) return setState((s) => ({ ...s, error: 'Tên tối đa 300 ký tự.' }));
    const raw = state.price.trim(), price = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(price) || price > PRICE_MAX) return setState((s) => ({ ...s, error: 'Giá phải là số nguyên từ 0 đến 100.000.000.' }));
    const body = {};
    if (name !== model.name) body.name = name;
    if (price !== model.priceVnd) body.priceVnd = price;
    if (state.status !== model.status && EDITABLE.includes(state.status)) body.status = state.status;
    if (!Object.keys(body).length) return onCancel();
    setState((s) => ({ ...s, busy: true, error: '' }));
    try { onSaved(await api.adminPatchModel(model.id, body)); }
    catch (e) { setState((s) => ({ ...s, busy: false, error: adminError(e) })); }
  }

  return <tr data-model={model.id}>
    <td className={`${td} min-w-48`}>{editing
      ? <input className={inputClass} name="editName" maxLength={300} value={state.name} onChange={(event) => set({ name: event.target.value })} />
      : model.name}</td>
    <td className={`${td} text-mute`}>{model.categoryPath}</td>
    <td className={`${td} whitespace-nowrap`}>{editing
      ? <input className={`${inputClass} w-32`} name="editPrice" inputMode="numeric" value={state.price} onChange={(event) => set({ price: event.target.value })} />
      : api.vnd(model.priceVnd)}</td>
    <td className={td}>{editing
      ? <select className={`${inputClass} w-auto`} name="editStatus" value={state.status} onChange={(event) => set({ status: event.target.value })}>
        {!EDITABLE.includes(model.status) && <option value={model.status} disabled>{statusLabels[model.status] || model.status}</option>}
        {EDITABLE.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select>
      : statusLabels[model.status] || model.status}</td>
    <td className={`${td} text-xs text-mute`}>{[model.nameOverridden && 'Tên đã sửa', model.priceOverridden && 'Giá đã sửa'].filter(Boolean).join(' · ')}</td>
    <td className={td}>
      {editing
        ? <div className="flex flex-wrap gap-2"><button className={primary} disabled={state.busy} onClick={save}>Lưu</button><button className={secondary} disabled={state.busy} onClick={onCancel}>Hủy</button></div>
        : <button className={secondary} onClick={onEdit}>Sửa</button>}
      {editing && state.error && <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p>}
    </td>
  </tr>;
}

export default function AdminModels() {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const [draft, setDraft] = useState({ q: '', status: '' });
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.adminModels({ q: query, status, page, limit: PAGE }).then(
      (data) => { if (!stale) setState({ data, loading: false, error: '' }); },
      (error) => { if (!stale) setState({ data: null, loading: false, error: adminError(error) }); });
    return () => { stale = true; };
  }, [query, status, page, version]);

  const search = (event) => { event.preventDefault(); setQuery(draft.q.trim()); setStatus(draft.status); setPage(1); setEditingId(null); };
  const replace = (updated) => { setState((s) => ({ ...s, data: { ...s.data, items: s.data.items.map((item) => (item.id === updated.id ? updated : item)) } })); setEditingId(null); };
  const data = state.data;

  return <section className={`${panel} space-y-4`}>
    <div><h3 className="font-bold">Model</h3><p className="mt-1 text-sm text-mute">Sửa tên, giá, hoặc ẩn model. Tên và giá đã sửa tay sẽ không bị lần đồng bộ Drive sau ghi đè.</p></div>
    <form role="search" className="flex flex-wrap gap-2" onSubmit={search}>
      <input className={`${inputClass} min-w-40 flex-1`} name="q" aria-label="Tìm model" placeholder="Tên model…" maxLength={100} value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
      <select className={`${inputClass} w-auto`} name="statusFilter" aria-label="Lọc theo trạng thái" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
        <option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className={secondary}>Tìm kiếm</button>
      <button type="button" className={secondary} onClick={() => setVersion((value) => value + 1)}>Làm mới</button>
    </form>
    <ResourceState loading={state.loading && !data} error={state.error} retry={() => setVersion((value) => value + 1)} />
    {data && data.items.length === 0 && <p className="py-4 text-sm text-mute">Không có model nào.</p>}
    {data && data.items.length > 0 && <div className="overflow-x-auto"><table className="w-full">
      <thead><tr><th className={th}>Tên</th><th className={th}>Danh mục</th><th className={th}>Giá</th><th className={th}>Trạng thái</th><th className={th}>Đã sửa tay</th><th className={th}>Thao tác</th></tr></thead>
      <tbody>{data.items.map((model) => <Row key={model.id} model={model} editing={editingId === model.id}
        onEdit={() => setEditingId(model.id)} onSaved={replace} onCancel={() => setEditingId(null)} />)}</tbody></table></div>}
    {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={(next) => { setPage(next); setEditingId(null); }} />}
  </section>;
}
