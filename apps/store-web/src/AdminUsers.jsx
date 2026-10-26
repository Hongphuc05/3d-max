import { useEffect, useState } from 'react';
import * as api from './api.js';
import { adminError, dateTime, inputClass, panel, primary, secondary, Status, Pagination, ResourceState, useAdminResource } from './AdminShared.jsx';
import { AuditTable, OrderTable } from './AdminRecords.jsx';

function LicenseAction({ action, user, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const issuing = action === 'ISSUE', resuming = action === 'ACTIVE', permanent = action === 'REVOKED';
  const title = issuing ? 'Cấp license Lifetime' : resuming ? 'Mở khóa license' : permanent ? 'Thu hồi license vĩnh viễn' : 'Tạm khóa license';
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  const submit = async event => {
    event.preventDefault();
    if (!issuing && !resuming && !reason.trim()) { setError('Vui lòng nhập lý do.'); return; }
    setBusy(true); setError('');
    try {
      if (issuing) await api.issueAdminLicense(user.id);
      else if (resuming) await api.resumeAdminLicense(user.id);
      else await api.revokeAdminLicense(user.id, action, reason.trim());
      onSaved();
    } catch (failure) { setError(adminError(failure)); setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <form role="dialog" aria-modal="true" aria-labelledby="admin-action-title" onSubmit={submit} className={`${panel} w-full max-w-md space-y-4 shadow-xl`}>
      <h3 id="admin-action-title" className="text-lg font-bold">{title}</h3>
      <p className="break-all text-sm text-mute">Tài khoản: {user.email}</p>
      {issuing ? <p className="text-sm">Cấp quyền Lifetime cho tài khoản này mà không cần đơn thanh toán.</p> : resuming ? <p className="text-sm">Khôi phục quyền tải và import của tài khoản này trên những thiết bị đã kích hoạt.</p> : <>
        <p className={`text-sm ${permanent ? 'text-danger' : 'text-warn'}`}>{permanent ? 'License sẽ bị thu hồi vĩnh viễn. Thao tác này không thể hoàn tác.' : 'Tài khoản sẽ không thể tải hoặc import khi license bị tạm khóa.'}</p>
        <label className="block space-y-2 text-sm"><span>Lý do</span><textarea name="reason" className={inputClass} value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} rows={3} /></label>
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={onClose}>Hủy</button><button className={permanent ? 'rounded-md bg-danger px-4 py-2 text-sm font-bold text-white disabled:opacity-40' : primary} disabled={busy}>{busy ? 'Đang xử lý…' : issuing ? 'Xác nhận cấp license' : resuming ? 'Xác nhận mở khóa' : permanent ? 'Xác nhận thu hồi' : 'Xác nhận tạm khóa'}</button></div>
    </form>
  </div>;
}

function UserDetail({ userId, onClose, onChanged }) {
  const [version, setVersion] = useState(0), [action, setAction] = useState(null);
  const resource = useAdminResource(signal => api.adminUser(userId, signal), [userId, version]);
  const detail = resource.data;
  const saved = () => { setAction(null); setVersion(value => value + 1); onChanged(); };
  return <section className={`${panel} space-y-5`}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="break-all text-lg font-bold">{detail?.user.email || 'Chi tiết tài khoản'}</h3>{detail && <p className="mt-1 text-xs text-mute">Tham gia {dateTime(detail.user.createdAt)}</p>}</div><button className={secondary} onClick={onClose}>Đóng chi tiết</button></div>
    <ResourceState {...resource} retry={() => setVersion(value => value + 1)} />
    {detail && <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><div><h4 className="mb-2 text-sm font-bold">License Lifetime</h4><Status value={detail.license?.status} />{detail.license?.last4 && <p className="mt-2 font-mono text-xs text-mute">Mã kết thúc bằng {detail.license.last4}</p>}</div><div className="flex flex-wrap gap-2">
        {!detail.license && <button className={primary} onClick={() => setAction('ISSUE')}>Cấp license Lifetime</button>}
        {detail.license?.status === 'ACTIVE' && <button className={secondary} onClick={() => setAction('SUSPENDED')}>Tạm khóa license</button>}
        {detail.license?.status === 'SUSPENDED' && <button className={primary} onClick={() => setAction('ACTIVE')}>Mở khóa license</button>}
        {detail.license && detail.license.status !== 'REVOKED' && <button className={`${secondary} border-danger/40 text-danger`} onClick={() => setAction('REVOKED')}>Thu hồi vĩnh viễn</button>}
      </div></div>
      <section className="space-y-3 border-t border-line pt-4"><h4 className="text-sm font-bold">Thiết bị đã kích hoạt ({detail.devices.length}/2)</h4><p className="text-xs text-mute">Hai slot thiết bị cố định. Thông tin thiết bị chỉ dùng để tra cứu.</p>
        {detail.devices.length ? <div className="grid gap-3 sm:grid-cols-2">{detail.devices.map(device => <div key={device.id} className="space-y-1 rounded-md border border-line bg-base p-3"><p className="text-sm font-bold">Slot {device.slotNumber} · {device.deviceName}</p><p className="break-all font-mono text-[10px] text-mute">{device.deviceId}</p><p className="text-xs text-mute">{device.keyProtection === 'TPM' ? 'Khóa TPM' : 'Khóa phần mềm'}</p><p className="text-xs text-mute">Kích hoạt: {dateTime(device.activatedAt)}</p><p className="text-xs text-mute">Gần nhất: {dateTime(device.lastSeenAt)}</p></div>)}</div> : <p className="text-sm text-mute">Chưa kích hoạt thiết bị nào.</p>}
      </section>
      <section className="border-t border-line pt-4"><h4 className="text-sm font-bold">Thanh toán gần đây</h4><OrderTable items={detail.orders} /></section>
      <section className="border-t border-line pt-4"><h4 className="text-sm font-bold">Lịch sử gần đây</h4><AuditTable items={detail.audit} /></section>
      {action && <LicenseAction action={action} user={detail.user} onClose={() => setAction(null)} onSaved={saved} />}
    </>}
  </section>;
}

export default function AdminUsers() {
  const [query, setQuery] = useState(''), [draft, setDraft] = useState('');
  const [page, setPage] = useState(1), [version, setVersion] = useState(0), [selected, setSelected] = useState(null);
  const resource = useAdminResource(signal => api.adminUsers({ q: query, page }, signal), [query, page, version]);
  return <div className="space-y-5"><section className={`${panel} space-y-4`}>
    <div><h2 className="text-xl font-bold">Tài khoản & license</h2><p className="mt-1 text-sm text-mute">Tìm tài khoản để xem quyền sử dụng, thanh toán và thiết bị đã kích hoạt.</p></div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); setPage(1); }}><input className={`${inputClass} min-w-0 flex-1`} aria-label="Tìm tài khoản" placeholder="Email hoặc ID tài khoản…" maxLength={254} value={draft} onChange={event => setDraft(event.target.value)} /><button className={secondary}>Tìm kiếm</button></form>
    <ResourceState {...resource} retry={() => setVersion(value => value + 1)} />
    {resource.data && <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-mute"><th className="py-3 pr-3 font-medium">Tài khoản</th><th className="px-3 py-3 font-medium">License</th><th className="px-3 py-3 font-medium">Thiết bị</th><th className="py-3 pl-3"><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{resource.data.items.map(item => <tr key={item.id} className="border-t border-line"><td className="py-3 pr-3"><p className="break-all">{item.email}</p><p className="mt-1 font-mono text-[10px] text-mute">{item.id}</p></td><td className="px-3 py-3"><Status value={item.license?.status} /></td><td className="px-3 py-3 text-mute">{item.deviceCount}/2</td><td className="py-3 pl-3 text-right"><button className={`${secondary} whitespace-nowrap`} onClick={() => setSelected(item.id)}>Xem chi tiết</button></td></tr>)}</tbody></table></div>{!resource.data.items.length && <p className="text-sm text-mute">Không tìm thấy tài khoản phù hợp.</p>}<Pagination {...resource.data} onPage={setPage} /></>}
  </section>{selected && <UserDetail key={selected} userId={selected} onClose={() => setSelected(null)} onChanged={() => setVersion(value => value + 1)} />}</div>;
}
