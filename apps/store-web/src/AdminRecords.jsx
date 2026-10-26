import { useState } from 'react';
import * as api from './api.js';
import { dateTime, inputClass, panel, secondary, Status, Pagination, ResourceState, useAdminResource } from './AdminShared.jsx';

const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';
export function OrderTable({ items, withEmail = false }) {
  if (!items.length) return <p className="py-5 text-sm text-mute">Chưa có đơn thanh toán.</p>;
  return <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Mã đơn</th>{withEmail && <th className={th}>Tài khoản</th>}<th className={th}>Số tiền</th><th className={th}>Trạng thái</th><th className={th}>Ngày tạo / thanh toán</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}><td className={`${td} font-mono text-xs`}>{item.orderCode}</td>{withEmail && <td className={`${td} break-all`}>{item.email}</td>}<td className={`${td} whitespace-nowrap`}>{api.vnd(item.amountVnd)}</td><td className={td}><Status value={item.status} />{item.fulfillmentResult === 'ALREADY_LICENSED' && <p className="mt-1 max-w-40 text-xs text-warn">Đã có license trước đơn này; cần kiểm tra thanh toán trùng.</p>}</td><td className={`${td} whitespace-nowrap text-xs text-mute`}>{dateTime(item.createdAt)}<br />{item.paidAt && dateTime(item.paidAt)}</td></tr>)}</tbody>
  </table></div>;
}
const events = { LICENSE_ISSUED: 'Đã cấp license', ADMIN_LICENSE_ISSUE: 'Admin cấp license', LICENSE_SUSPENDED: 'Tạm khóa license', LICENSE_RESUMED: 'Mở khóa license', LICENSE_REVOKED: 'Thu hồi license', ADMIN_CREDENTIALS_CHANGED: 'Đổi thông tin admin', ADMIN_ACCOUNT_UPDATED: 'Đổi thông tin admin', DEVICE_ACTIVATED: 'Kích hoạt thiết bị' };
export function AuditTable({ items }) {
  if (!items.length) return <p className="py-5 text-sm text-mute">Chưa có lịch sử thao tác.</p>;
  return <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Thời gian</th><th className={th}>Thao tác</th><th className={th}>Người thực hiện</th><th className={th}>Tài khoản liên quan / lý do</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}><td className={`${td} whitespace-nowrap text-xs text-mute`}>{dateTime(item.createdAt)}</td><td className={td}>{events[item.eventType] || item.eventType}</td><td className={`${td} break-all`}>{item.actorEmail || 'Hệ thống'}</td><td className={`${td} break-all`}>{item.targetEmail || '—'}{item.details?.reason && <p className="mt-1 text-xs text-mute">{item.details.reason}</p>}</td></tr>)}</tbody>
  </table></div>;
}

export function AdminOrders() {
  const [query, setQuery] = useState(''), [draft, setDraft] = useState('');
  const [status, setStatus] = useState(''), [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const resource = useAdminResource(signal => api.adminOrders({ q: query, status, page }, signal), [query, status, page, version]);
  return <section className={`${panel} space-y-4`}>
    <div><h2 className="text-xl font-bold">Thanh toán</h2><p className="mt-1 text-sm text-mute">Theo dõi trạng thái đơn đã được máy chủ xác minh.</p></div>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); setPage(1); }}>
      <input className={`${inputClass} min-w-40 flex-1`} aria-label="Tìm đơn thanh toán" placeholder="Email hoặc mã đơn…" maxLength={254} value={draft} onChange={event => setDraft(event.target.value)} />
      <select className={`${inputClass} w-auto`} aria-label="Trạng thái thanh toán" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Tất cả trạng thái</option>{[['PENDING', 'Chờ thanh toán'], ['PAID', 'Đã thanh toán'], ['CANCELLED', 'Đã hủy'], ['EXPIRED', 'Hết hạn'], ['FAILED', 'Thất bại']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className={secondary}>Tìm kiếm</button><button type="button" className={secondary} onClick={() => setVersion(value => value + 1)}>Làm mới</button>
    </form>
    <ResourceState {...resource} retry={() => setVersion(value => value + 1)} />
    {resource.data && <><OrderTable items={resource.data.items} withEmail /><Pagination {...resource.data} onPage={setPage} /></>}
  </section>;
}

export function AdminAudit() {
  const [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const resource = useAdminResource(signal => api.adminAudit({ page }, signal), [page, version]);
  return <section className={`${panel} space-y-4`}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Lịch sử thao tác</h2><button className={secondary} onClick={() => setVersion(value => value + 1)}>Làm mới</button></div>
    <ResourceState {...resource} retry={() => setVersion(value => value + 1)} />
    {resource.data && <><AuditTable items={resource.data.items} /><Pagination {...resource.data} onPage={setPage} /></>}
  </section>;
}
