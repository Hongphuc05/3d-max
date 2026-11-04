// D28.2 — man "Thiet bi & license": moi thiet bi giu toi da 1 license thu vien. Thu hoi, hoac chuyen sang thiet bi khac (may moi / cai lai may).
// Thao tac can bam xac nhan lan hai. Chuyen: chon thiet bi dich CHUA co license.
import { useState } from 'react';
import * as api from './api.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';
const short = (id) => String(id).slice(0, 8);

function Actions({ device, others, onDone }) {
  const [mode, setMode] = useState(null); // null | 'revoke' | 'transfer'
  const [target, setTarget] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  if (!device.hasLicense) return null;
  async function run() {
    setState({ busy: true, error: '' });
    try { await (mode === 'revoke' ? api.adminRevokeLicense(device.id) : api.adminTransferLicense(device.id, target)); onDone(); }
    catch (e) { setState({ busy: false, error: adminError(e) }); }
  }
  const cancel = () => { setMode(null); setTarget(''); setState({ busy: false, error: '' }); };
  return <div className="space-y-2">
    {!mode && <div className="flex flex-wrap gap-2"><button className={secondary} onClick={() => setMode('transfer')}>Chuyển license</button>
      <button className={secondary} onClick={() => setMode('revoke')}>Thu hồi</button></div>}
    {mode === 'transfer' && <div className="flex flex-wrap items-center gap-2">
      <select className={`${inputClass} w-auto max-w-56`} aria-label="Thiết bị nhận license" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Chọn thiết bị nhận…</option>{others.map((d) => <option key={d.id} value={d.id}>{d.name} · {short(d.id)}</option>)}</select>
      <button className={primary} disabled={!target || state.busy} onClick={run}>Chắc chắn chuyển</button><button className={secondary} onClick={cancel}>Hủy</button></div>}
    {mode === 'revoke' && <div className="flex flex-wrap items-center gap-2"><span className="text-xs">Thu hồi license của thiết bị này?</span>
      <button className={primary} disabled={state.busy} onClick={run}>Chắc chắn thu hồi</button><button className={secondary} onClick={cancel}>Hủy</button></div>}
    {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
  </div>;
}

export default function AdminDevices() {
  const [version, setVersion] = useState(0);
  const resource = useAdminResource(api.adminDevices, [version]);
  const items = resource.data?.items;
  const free = items?.filter((d) => !d.hasLicense && d.status === 'ACTIVE') ?? [];
  return <section className="space-y-5">
    <h2 className="text-xl font-bold">Thiết bị &amp; license</h2>
    <div className={`${panel} space-y-4`}>
      <p className="text-sm text-mute">Mỗi license thư viện gắn với đúng một thiết bị. Khi khách đổi hoặc cài lại máy, chuyển license sang thiết bị mới (thiết bị mới phải mở plugin một lần để xuất hiện ở đây).</p>
      <button className={secondary} onClick={() => setVersion((v) => v + 1)}>Làm mới</button>
      <ResourceState loading={resource.loading} error={resource.error} retry={() => setVersion((v) => v + 1)} />
      {items && items.length === 0 && <p className="py-4 text-sm text-mute">Chưa có thiết bị nào.</p>}
      {items && items.length > 0 && <div className="overflow-x-auto"><table className="w-full">
        <thead><tr><th className={th}>Thiết bị</th><th className={th}>Tạo lúc</th><th className={th}>Thấy lần cuối</th><th className={th}>License</th><th className={th}>Thao tác</th></tr></thead>
        <tbody>{items.map((d) => <tr key={d.id} data-device={d.id}>
          <td className={td}>{d.name}<div className="font-mono text-[10px] text-mute">{short(d.id)}{d.status === 'BLOCKED' ? ' · bị chặn' : ''}</div></td>
          <td className={`${td} whitespace-nowrap`}>{dateTime(d.createdAt)}</td>
          <td className={`${td} whitespace-nowrap`}>{dateTime(d.lastSeenAt)}</td>
          <td className={td}>{d.hasLicense ? <span className="font-bold text-accent">Có</span> : <span className="text-mute">Chưa</span>}</td>
          <td className={td}><Actions device={d} others={free.filter((o) => o.id !== d.id)} onDone={() => setVersion((v) => v + 1)} /></td>
        </tr>)}</tbody></table></div>}
    </div>
  </section>;
}
