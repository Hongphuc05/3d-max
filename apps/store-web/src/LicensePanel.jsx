import { useEffect, useState } from 'react';
import * as api from './api.js';
import { useAuth } from './auth.jsx';
import { useLicense } from './license.jsx';
import { licenseError } from './license-flow.js';
import Purchase from './Purchase.jsx';
import { getDeviceIdentity } from './integrations/3dsmax/bridge.js';

const button = 'rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50';
const secondary = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-50';
const warning = 'Mỗi license có tối đa 2 thiết bị cố định. Không xóa, đổi hoặc chuyển slot. Cài lại Windows, thay phần cứng hoặc mất khóa thiết bị có thể làm mất quyền dùng slot đó; không tự động cấp lại.';
function Activation() {
  const { activate, loading, session, error, refresh } = useLicense();
  const [key, setKey] = useState('');
  const [identity, setIdentity] = useState(null);
  const [identityError, setIdentityError] = useState('');
  useEffect(() => {
    let cancelled = false;
    getDeviceIdentity().then((value) => { if (!cancelled) setIdentity(value); },
      (e) => { if (!cancelled) setIdentityError(licenseError(e)); });
    return () => { cancelled = true; };
  }, []);
  const submit = async (e) => { e.preventDefault(); if (await activate(key)) setKey(''); };
  return <section className="space-y-3 rounded-lg border border-line p-4">
    <h3 className="font-bold">Kích hoạt thiết bị</h3>
    {session ? <>
      <p className="text-sm text-accent" role="status">Thiết bị đã được xác minh. Có thể Download &amp; import.</p>
      <p className="text-xs text-mute">Plugin tự xác minh lại bằng khóa Windows; không cần nhập lại license trong lần mở sau.</p>
    </> : <form className="space-y-3" onSubmit={submit}>
      <label className="block text-sm">Mã license
        <input required value={key} onChange={(e) => setKey(e.target.value)} maxLength={128} autoComplete="off" spellCheck={false}
          placeholder="3DM-…" className="mt-1 w-full rounded-md border border-line bg-base px-3 py-2 font-mono focus:border-accent" />
      </label>
      <button className={button} disabled={loading || !identity}>{loading ? 'Đang xác minh…' : 'Kích hoạt máy này'}</button>
      <button type="button" className={`${secondary} ml-2`} disabled={loading} onClick={() => refresh()}>Xác minh lại máy đã kích hoạt</button>
    </form>}
    {identity?.keyProtection === 'SOFTWARE' && <p className="text-sm text-warn">Máy này dùng Windows CNG + DPAPI qua phần mềm, mức bảo vệ thấp hơn khóa TPM.</p>}
    {identityError && <p role="alert" className="text-sm text-danger">{identityError}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}

export default function LicensePanel({ onLogin }) {
  const { user } = useAuth();
  const { license, devices, session, canImport, max, loading, error, setOpen, refresh } = useLicense();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(license.key); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  useEffect(() => { const handler = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [setOpen]);
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3" onClick={() => setOpen(false)}>
    <div role="dialog" aria-modal="true" aria-labelledby="license-title" className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-auto rounded-lg border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3"><h2 id="license-title" className="text-xl font-bold">My License</h2><button className={secondary} onClick={() => setOpen(false)}>Đóng</button></div>
      <p className="rounded-md border border-warn/30 bg-warn/5 p-3 text-sm text-warn">{warning}</p>
      {!user ? <div className="space-y-3"><p>Đăng nhập để mua hoặc xem license của bạn.</p><button className={button} onClick={onLogin}>Đăng nhập</button></div> : <>
        <p className="truncate text-sm text-mute">{user.email}</p>
        {loading && <p role="status" className="text-sm text-mute">Đang tải và xác minh license…</p>}
        {license && <section className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="font-bold">3DsMood Lifetime - {license.status === 'ACTIVE' ? 'Active' : license.status}</h3>
          {license.key && <div className="space-y-2"><code className="block break-all rounded bg-base p-3 text-sm">{license.key}</code><button className={secondary} onClick={copy}>{copied ? 'Đã sao chép' : 'Sao chép mã license'}</button>{copyError && <p className="text-sm text-warn">Không thể truy cập clipboard. Bạn có thể chọn và sao chép mã phía trên.</p>}</div>}
          <h4 className="text-sm font-bold">Thiết bị đã gắn ({devices.length}/2)</h4>
          <ul className="space-y-2">{devices.map((device) => <li key={device.id} className="rounded-md bg-base p-3 text-sm">
            <p>Slot {device.slotNumber} · {device.deviceName || 'Thiết bị Windows'}</p>
            <p className="break-all font-mono text-xs text-mute">{device.deviceId}</p>
            <p className="text-xs text-mute">{device.keyProtection === 'TPM' ? 'Khóa TPM' : 'CNG phần mềm · bảo vệ thấp hơn TPM'} · {new Date(device.activatedAt).toLocaleDateString('vi-VN')}</p>
          </li>)}</ul>
          {!devices.length && <p className="text-sm text-mute">Chưa gắn thiết bị nào.</p>}
        </section>}
        {max && canImport && session?.license.id !== license?.id && <section className="space-y-2 rounded-lg border border-line p-4">
          <h3 className="font-bold text-accent">Máy này đã được kích hoạt</h3>
          <p className="text-sm">Bạn có thể Download &amp; import bằng license đã gắn với máy này, kể cả khi đổi tài khoản.</p>
          <p className="text-xs text-mute">Key và danh sách slot chỉ hiển thị cho tài khoản sở hữu license. Đổi tài khoản không tạo thêm slot.</p>
        </section>}
        {max && (license?.status === 'ACTIVE' || canImport) && <Activation />}
        {(!max || (license?.status !== 'ACTIVE' && !canImport)) && error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!max && <p className="text-sm text-mute">Mở plugin trong 3ds Max để kích hoạt thiết bị và import model.</p>}
        <button disabled={loading} className={secondary} onClick={() => refresh()}>Làm mới license</button>
      </>}
      <Purchase key={user?.id || 'guest'} />
    </div>
  </div>;
}
