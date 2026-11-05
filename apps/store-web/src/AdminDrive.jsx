// Kết nối Drive: key được gửi một lần qua form password, mã hóa và giữ ở máy chủ; status chỉ trả metadata đã che.
// Drive ID nội bộ không được render lại trên trang admin.
import { useState } from 'react';
import * as api from './api.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const types = { MY_DRIVE: 'Drive của tôi', SHARED_DRIVE: 'Drive chung', SHARED_WITH_ME: 'Được chia sẻ' };
const checks = { list: 'Liệt kê thư mục', download: 'Tải thử file' };
const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';

function CheckResult({ result }) {
  return <ul className="space-y-1 text-sm" aria-label="Kết quả kiểm tra">
    {result.details.map((item) => <li key={item.check} className={item.ok ? 'text-accent' : 'text-danger'}>
      {checks[item.check] || item.check}: {item.ok ? `Đạt${item.count != null ? ` (${item.count} mục)` : ''}` : `Không đạt${item.code ? ` (${item.code})` : ''}`}
    </li>)}
  </ul>;
}

function SourceRow({ source }) {
  const [state, setState] = useState({ busy: false, result: null, error: '' });
  async function test() {
    setState({ busy: true, result: null, error: '' });
    try { setState({ busy: false, result: await api.adminDriveTestAccess(source.id), error: '' }); }
    catch (error) { setState({ busy: false, result: null, error: adminError(error) }); }
  }
  return <tr>
    <td className={td}>{source.rootFolderName}</td>
    <td className={td}>{types[source.sourceType] || source.sourceType}</td>
    <td className={td}>{source.enabled ? 'Đang bật' : 'Đã tắt'}</td>
    <td className={`${td} whitespace-nowrap text-xs text-mute`}>{dateTime(source.lastSuccessfulSyncAt)}</td>
    <td className={td}>
      <button className={secondary} disabled={state.busy} onClick={test}>Kiểm tra truy cập</button>
      <div className="mt-2" aria-live="polite">
        {state.result && <CheckResult result={state.result} />}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </td>
  </tr>;
}

function DriveKeySlot({ slot, onChanged }) {
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState({ busy: false, error: '', notice: '' });

  async function save(event) {
    event.preventDefault();
    if (!apiKey.trim()) {
      setState({ busy: false, error: 'Nhập API key để lưu slot này.', notice: '' });
      return;
    }
    setState({ busy: true, error: '', notice: '' });
    try {
      await api.adminSaveDriveKey(slot.slot, { apiKey: apiKey.trim() });
      setApiKey('');
      setState({ busy: false, error: '', notice: 'Đã lưu key an toàn trên máy chủ.' });
      onChanged();
    } catch (error) { setState({ busy: false, error: adminError(error), notice: '' }); }
  }

  async function test() {
    setState({ busy: true, error: '', notice: '' });
    try {
      const result = await api.adminTestDriveKey(slot.slot);
      setState({ busy: false, error: '', notice: result.ok ? 'Kiểm tra thư mục gốc thành công.' : 'Kiểm tra chưa thành công.' });
      onChanged();
    } catch (error) { setState({ busy: false, error: adminError(error), notice: '' }); onChanged(); }
  }

  async function clear() {
    setState({ busy: true, error: '', notice: '' });
    try {
      await api.adminDeleteDriveKey(slot.slot);
      setApiKey('');
      setState({ busy: false, error: '', notice: 'Đã xóa key khỏi slot.' });
      onChanged();
    } catch (error) { setState({ busy: false, error: adminError(error), notice: '' }); }
  }

  const health = slot.status === 'HEALTHY' ? 'Hoạt động'
    : slot.status === 'RATE_LIMITED' ? 'Đang nghỉ do quota'
      : slot.status === 'FAILED' ? `Lỗi${slot.reason ? ` (${slot.reason})` : ''}`
        : slot.configured ? 'Chưa kiểm tra' : 'Chưa cấu hình';
  const healthClass = slot.status === 'HEALTHY' ? 'text-accent' : slot.status === 'FAILED' || slot.status === 'RATE_LIMITED' ? 'text-warn' : 'text-mute';
  return <form className={`${panel} space-y-3`} onSubmit={save}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-bold">Key {slot.slot}</h4>
    </div>
    <label className="block text-sm"><span className="text-mute">API key</span>
      <input className={`${inputClass} mt-1`} name={`apiKey-${slot.slot}`} type="password" autoComplete="new-password" maxLength={256} value={apiKey}
        onChange={(event) => setApiKey(event.target.value)} placeholder={slot.configured ? 'Đã lưu — nhập key mới nếu muốn thay' : 'Nhập Google Drive API key'} /></label>
    <div className="space-y-1 rounded-md border border-line px-3 py-2 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <span className={healthClass}>Trạng thái: {health}</span>
        {slot.active && <span className="rounded-full bg-accent/10 px-2 py-1 text-accent">Đang dùng</span>}
      </p>
      <p className={slot.status === 'RATE_LIMITED' ? 'text-warn' : 'text-mute'}>
        Quota còn lại: {slot.status === 'RATE_LIMITED' ? 'đã chạm giới hạn' : 'chưa có số liệu Cloud Monitoring'}
      </p>
      {slot.lastCheckedAt && <p className="text-mute">Kiểm tra gần nhất: {dateTime(slot.lastCheckedAt)}</p>}
      {slot.cooldownUntil && <p className="text-warn">Key được thử lại sau: {dateTime(slot.cooldownUntil)}</p>}
    </div>
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state.notice && <p role="status" className="text-sm text-accent">{state.notice}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={primary} disabled={state.busy}>Lưu key</button>
      <button type="button" className={secondary} disabled={!slot.configured || state.busy} onClick={test}>Kiểm tra ngay</button>
      {slot.configured && <button type="button" className={secondary} disabled={state.busy} onClick={clear}>Xóa key</button>}
    </div>
  </form>;
}

export default function AdminDrive() {
  const [version, setVersion] = useState(0);
  const resource = useAdminResource(api.adminDriveStatus, [version]);
  const keyResource = useAdminResource(api.adminDriveKeys, [version]);
  const [form, setForm] = useState({ rootFolderUrlOrId: '', resourceKey: '' });
  const [save, setSave] = useState({ busy: false, error: '' });
  const status = resource.data;
  const keySlots = keyResource.data?.slots ?? [];
  const slotPlaceholders = Array.from({ length: 5 }, (_, index) => keySlots[index] ?? ({ slot: index + 1, configured: false, active: false, status: 'EMPTY' }));
  const refresh = () => setVersion((value) => value + 1);

  async function submit(event) {
    event.preventDefault();
    if (save.busy) return;
    const rootFolderUrlOrId = form.rootFolderUrlOrId.trim(), resourceKey = form.resourceKey.trim();
    if (!rootFolderUrlOrId) return setSave({ busy: false, error: 'Hãy nhập liên kết hoặc ID thư mục gốc.' });
    setSave({ busy: true, error: '' });
    try {
      await api.adminDriveAddSource({ rootFolderUrlOrId, ...(resourceKey ? { resourceKey } : {}) });
      setForm({ rootFolderUrlOrId: '', resourceKey: '' });
      setSave({ busy: false, error: '' });
      setVersion((value) => value + 1);
    } catch (error) { setSave({ busy: false, error: adminError(error) }); }
  }

  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Kết nối Google Drive</h2><button className={secondary} onClick={refresh}>Làm mới</button></div>
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {status && <>
      <div className={`${panel} space-y-2`}>
        <h3 className="font-bold">Tối đa 5 API key</h3>
        {status.configured
          ? <p className="text-sm text-accent">Đã cấu hình khóa API Drive trên máy chủ.</p>
          : <p role="alert" className="text-sm text-warn">Chưa cấu hình. Hãy thêm ít nhất một API key ở slot bên dưới.</p>}
        {keyResource.data?.legacyFallback && <p className="text-xs text-mute">Hiện hệ thống đang dùng key tương thích cũ từ cấu hình máy chủ. Lưu key vào một slot để quản lý và xoay key trên giao diện.</p>}
        <p className="text-sm text-mute">Worker kiểm tra key đang dùng mỗi {keyResource.data?.automaticCheckMinutes ?? 10} phút. Khi Google giới hạn request, hệ thống tạm nghỉ key đó rồi chuyển sang key khác. Quota chính xác cần cấu hình quyền Cloud Monitoring phía máy chủ; các key cùng project có thể dùng chung quota.</p>
        <p className="text-xs text-mute">Key được mã hóa trong database; giá trị đã lưu không bao giờ được gửi lại về trình duyệt.</p>
        <ResourceState {...keyResource} retry={refresh} />
      </div>

      {slotPlaceholders.map((slot) => <DriveKeySlot key={slot.slot} slot={slot} onChanged={refresh} />)}

      <form className={`${panel} space-y-3`} onSubmit={submit}>
        <h3 className="font-bold">Thư mục gốc</h3>
        <label className="block text-sm"><span className="text-mute">Thư mục gốc (liên kết hoặc ID)</span>
          <input className={`${inputClass} mt-1`} name="rootFolderUrlOrId" maxLength={2000} autoComplete="off" disabled={!status.configured} value={form.rootFolderUrlOrId} onChange={(event) => setForm({ ...form, rootFolderUrlOrId: event.target.value })} /></label>
        <label className="block text-sm"><span className="text-mute">Resource key (nếu có)</span>
          <input className={`${inputClass} mt-1`} name="resourceKey" maxLength={100} autoComplete="off" disabled={!status.configured} value={form.resourceKey} onChange={(event) => setForm({ ...form, resourceKey: event.target.value })} /></label>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error}</p>}
        <button type="submit" className={primary} disabled={!status.configured || save.busy}>Lưu thư mục gốc</button>
      </form>

      <div className={`${panel} space-y-3`}>
        <h3 className="font-bold">Nguồn đã lưu</h3>
        {status.sources.length === 0
          ? <p className="py-3 text-sm text-mute">Chưa có thư mục gốc nào.</p>
          : <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Thư mục</th><th className={th}>Loại</th><th className={th}>Trạng thái</th><th className={th}>Đồng bộ thành công gần nhất</th><th className={th}>Kiểm tra</th></tr></thead>
            <tbody>{status.sources.map((source) => <SourceRow key={source.id} source={source} />)}</tbody></table></div>}
      </div>
    </>}
  </section>;
}
