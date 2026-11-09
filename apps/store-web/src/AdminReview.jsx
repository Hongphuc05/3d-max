// P3.4 — Can duyet (plan §P3.4). Danh sach theo loai; Chap nhan / Bo qua. Remap can xac nhan ro (xoa model moi, khong hoan tac).
// Cac loai khong co model de duyet chi co "Da xem". Ghep tay va chon anh chinh chua co (quyet dinh cua chu du an: phase sau).
// Khong hien ID nao: chi tom tat + ten file ung vien.
import { useEffect, useState } from 'react';
import * as api from './api.js';
import ContentDomainTabs from './ContentDomainTabs.jsx';
import { adminError, panel, ResourceState, secondary, primary } from './AdminShared.jsx';

const KIND_ORDER = ['REMAP_CANDIDATE', 'SUGGESTED_PAIR', 'AMBIGUOUS_PAIR', 'ORPHAN_MODEL', 'ORPHAN_IMAGE', 'PREVIEW_IN_ARCHIVE'];
const kindLabels = { REMAP_CANDIDATE: 'Có thể đổi ID', SUGGESTED_PAIR: 'Gợi ý ghép cặp', AMBIGUOUS_PAIR: 'Ghép cặp không rõ', ORPHAN_MODEL: 'File model lẻ', ORPHAN_IMAGE: 'Ảnh lẻ', PREVIEW_IN_ARCHIVE: 'Ảnh trong file nén' };
const ACCEPTABLE = new Set(['SUGGESTED_PAIR', 'REMAP_CANDIDATE']);

function Item({ item, onResolved, contentDomain }) {
  const [state, setState] = useState({ busy: false, error: '', confirm: false });
  const acceptable = ACCEPTABLE.has(item.kind), remap = item.kind === 'REMAP_CANDIDATE';

  async function send(action, doneMessage) {
    if (state.busy) return;
    setState({ busy: true, error: '', confirm: false });
    try { await api.adminReviewAction(item.id, action, contentDomain); onResolved(item.id, doneMessage); }
    catch (e) {
      if (e?.code === 'REVIEW_ALREADY_RESOLVED') onResolved(item.id, adminError(e)); // nguoi khac da xu ly: muc bien mat
      else setState({ busy: false, error: adminError(e), confirm: false });
    }
  }

  return <li data-review={item.id} className="space-y-3 border-t border-line py-4 first:border-t-0">
    <p className="text-sm">{item.summary}</p>
    {item.candidates.length > 0 && <ul className="space-y-1 text-xs text-mute">{item.candidates.map((c, i) => <li key={i} className="break-all font-mono">{c.name}</li>)}</ul>}
    {state.confirm
      ? <div className="space-y-2 rounded-md border border-warn/40 p-3 text-sm">
        <p className="text-warn">Bạn sắp gộp file mới vào model cũ (giữ nguyên ID, giá và tên) và xóa model mới trùng. Thao tác không hoàn tác.</p>
        <div className="flex gap-2"><button className={primary} disabled={state.busy} onClick={() => send('ACCEPT', 'Đã gộp vào model cũ.')}>Gộp</button>
          <button className={secondary} disabled={state.busy} onClick={() => setState((s) => ({ ...s, confirm: false }))}>Hủy</button></div>
      </div>
      : <div className="flex flex-wrap gap-2">
        {acceptable
          ? <>
            {remap
              ? <button className={primary} disabled={state.busy} onClick={() => setState((s) => ({ ...s, confirm: true, error: '' }))}>Xác nhận gộp</button>
              : <button className={primary} disabled={state.busy} onClick={() => send('ACCEPT', 'Đã chấp nhận.')}>Chấp nhận</button>}
            <button className={secondary} disabled={state.busy} onClick={() => send('DISMISS', 'Đã bỏ qua.')}>Bỏ qua</button>
          </>
          : <button className={secondary} disabled={state.busy} onClick={() => send('DISMISS', 'Đã đánh dấu đã xem.')}>Đã xem</button>}
      </div>}
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
  </li>;
}

export default function AdminReview() {
  const [domain, setDomain] = useState("3dmodels");
  return <div className="space-y-5"><ContentDomainTabs value={domain} onChange={setDomain} /><ReviewDomain key={domain} contentDomain={domain} /></div>;
}

function ReviewDomain({ contentDomain }) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ items: null, loading: true, error: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.adminReviewItems(undefined, contentDomain).then(
      (items) => { if (!stale) setState({ items, loading: false, error: '' }); },
      (error) => { if (!stale) setState({ items: null, loading: false, error: adminError(error) }); });
    return () => { stale = true; };
  }, [version]);

  const resolved = (id, doneMessage) => { setMessage(doneMessage); setState((s) => ({ ...s, items: s.items.filter((item) => item.id !== id) })); };
  const items = state.items;
  const kinds = items ? KIND_ORDER.filter((kind) => items.some((item) => item.kind === kind)) : [];
  const hasPassive = items?.some((item) => !ACCEPTABLE.has(item.kind));

  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Cần duyệt</h2>
      <button className={secondary} onClick={() => { setMessage(''); setVersion((v) => v + 1); }}>Làm mới</button></div>
    <ResourceState loading={state.loading && !items} error={state.error} retry={() => setVersion((v) => v + 1)} />
    {message && <p role="status" className="text-sm text-brand">{message}</p>}
    {items && items.length === 0 && <p className={`${panel} text-sm text-mute`}>Không có mục nào cần duyệt.</p>}
    {hasPassive && <p className="text-xs text-mute">Ghép tay và chọn ảnh chính chưa có: các mục chỉ có nút "Đã xem" sẽ được xử lý ở phase sau.</p>}
    {kinds.map((kind) => {
      const group = items.filter((item) => item.kind === kind);
      return <section key={kind} data-kind={kind} className={`${panel} space-y-1`}>
        <h3 className="font-bold">{kindLabels[kind]} ({group.length})</h3>
        <ul>{group.map((item) => <Item contentDomain={contentDomain} key={item.id} item={item} onResolved={resolved} />)}</ul>
      </section>;
    })}
  </section>;
}
