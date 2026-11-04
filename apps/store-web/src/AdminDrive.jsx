// Credentials stay on the server; the browser only starts the OAuth redirect.
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

export default function AdminDrive() {
  const [version, setVersion] = useState(0);
  const resource = useAdminResource(api.adminDriveStatus, [version]);
  const [form, setForm] = useState({ rootFolderUrlOrId: '', resourceKey: '' });
  const [save, setSave] = useState({ busy: false, error: '' });
  const status = resource.data;
  const oauthMode = status?.authMode === 'oauth';
  const connected = status?.connection?.status === 'CONNECTED';
  const canAddSource = status?.configured && (!oauthMode || connected);
  const callback = new URLSearchParams(window.location.search).get('drive');

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
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Kết nối Google Drive</h2><button className={secondary} onClick={() => setVersion((value) => value + 1)}>Làm mới</button></div>
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {status && <>
      <div className={`${panel} space-y-2`}>
        <h3 className="font-bold">{oauthMode ? 'Kết nối tài khoản Google' : 'Khóa API'}</h3>
        {!status.configured
          ? <p role="alert" className="text-sm text-warn">Chưa cấu hình. Máy chủ thiếu biến: {status.missingConfig.join(', ')}. Đặt biến này trong file .env của máy chủ rồi khởi động lại.</p>
          : oauthMode ? <>
            {connected ? <p className="text-sm text-accent">Đã kết nối: {status.connection.email}</p>
              : <p className="text-sm text-warn">{status.connection ? 'Cần kết nối lại tài khoản Google.' : 'Chưa kết nối tài khoản Google.'}</p>}
            <a className={`${secondary} inline-block`} href="/api/admin/drive/oauth/start">{status.connection ? 'Kết nối lại Google Drive' : 'Kết nối Google Drive'}</a>
            <p className="text-xs text-mute">Đăng nhập bằng tài khoản được chia sẻ thư mục Drive và có quyền tải file.</p>
          </> : <p className="text-sm text-accent">Đã cấu hình khóa API Drive trên máy chủ.</p>}
        {oauthMode && callback === 'connected' && <p role="status" className="text-sm text-accent">Đã hoàn tất kết nối Google. Kiểm tra trạng thái ở trên.</p>}
        {oauthMode && callback === 'error' && <p role="alert" className="text-sm text-danger">Kết nối Google chưa hoàn tất. Hãy thử kết nối lại và kiểm tra cấu hình OAuth.</p>}
        <p className="text-xs text-mute">Thông tin xác thực chỉ nằm trên máy chủ, không nhập và không hiển thị ở đây.</p>
      </div>

      <form className={`${panel} space-y-3`} onSubmit={submit}>
        <h3 className="font-bold">Thư mục gốc</h3>
        <label className="block text-sm"><span className="text-mute">Thư mục gốc (liên kết hoặc ID)</span>
          <input className={`${inputClass} mt-1`} name="rootFolderUrlOrId" maxLength={2000} autoComplete="off" disabled={!canAddSource} value={form.rootFolderUrlOrId} onChange={(event) => setForm({ ...form, rootFolderUrlOrId: event.target.value })} /></label>
        <label className="block text-sm"><span className="text-mute">Resource key (nếu có)</span>
          <input className={`${inputClass} mt-1`} name="resourceKey" maxLength={100} autoComplete="off" disabled={!canAddSource} value={form.resourceKey} onChange={(event) => setForm({ ...form, resourceKey: event.target.value })} /></label>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error}</p>}
        <button type="submit" className={primary} disabled={!canAddSource || save.busy}>Lưu thư mục gốc</button>
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
