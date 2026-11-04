import { useEffect, useState } from 'react';
import { activateLibrary, getLibraryStatus } from './integrations/3dsmax/bridge.js';

const errors = {
  LIBRARY_INVALID: 'License không hợp lệ hoặc không dành cho máy này. Kiểm tra lại key hoặc liên hệ quản trị viên.',
  LEGACY_LICENSE_INVALID: 'Máy chủ không xác minh được license. Vui lòng liên hệ quản trị viên.',
  LEGACY_LICENSE_CONFLICT: 'License hoặc mã máy đã gắn với thiết bị khác. Vui lòng liên hệ quản trị viên.',
  LICENSE_NOT_GRANTED: 'Máy chủ chưa cấp quyền cho license này. Vui lòng liên hệ quản trị viên.',
  LICENSE_NOT_CONFIGURED: 'Bộ cài thiếu khóa xác minh license. Vui lòng liên hệ quản trị viên.',
  SERVER_UNAVAILABLE: 'Chưa kết nối được máy chủ để xác nhận license. Kiểm tra mạng rồi thử lại.',
};

export default function LibraryActivation({ max, onClose, onActivated }) {
  const [machineCode, setMachineCode] = useState(null);
  const [license, setLicense] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!max) return;
    let live = true;
    getLibraryStatus().then((s) => { if (live) setMachineCode(s?.machineCode ?? ''); }, () => { if (live) setMachineCode(''); });
    return () => { live = false; };
  }, [max]);

  async function submit(e) {
    e.preventDefault();
    if (!license.trim() || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const status = await activateLibrary(license.trim());
      if (!status?.allModels) throw Object.assign(new Error(), { code: 'LICENSE_NOT_GRANTED' });
      setLicense(''); setMessage('Đã kích hoạt toàn bộ thư viện cho máy này.'); onActivated();
    } catch (e) { setError(errors[e?.code] || 'Không thể kích hoạt license. Kiểm tra kết nối và thử lại, hoặc liên hệ quản trị viên.'); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(machineCode); setMessage('Đã sao chép mã máy.'); }
    catch { setError('Không sao chép được. Hãy chọn và sao chép mã máy thủ công.'); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="activation-title" onClick={(e) => e.stopPropagation()}
      className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-panel p-5">
      <div className="flex items-center justify-between gap-3"><h2 id="activation-title" className="text-lg font-bold">Kích hoạt thư viện</h2>
        <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-2 text-sm">Đóng</button></div>
      <p className="text-sm text-mute">Gửi mã máy cho quản trị viên để nhận license, sau đó nhập key vào đây. License hợp lệ mở quyền tải toàn bộ thư viện trên máy này.</p>
      <div><div className="text-xs text-mute">Mã máy</div><div className="mt-1 break-all select-text font-mono text-xs">{machineCode || (max ? (machineCode === null ? 'Đang đọc…' : 'Không đọc được mã máy.') : 'Chỉ có trong plugin 3ds Max')}</div>
        {machineCode && <button type="button" className="mt-2 text-xs text-accent" onClick={copyCode}>Sao chép mã máy</button>}</div>
      {max && <form onSubmit={submit} className="space-y-2"><label className="block text-sm">License
        <textarea value={license} onChange={(e) => setLicense(e.target.value)} rows={3} maxLength={2048} autoComplete="off" className="mt-1 w-full rounded-md border border-line bg-base p-2 font-mono text-xs" /></label>
        <button disabled={busy || !license.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50">{busy ? 'Đang xác minh…' : 'Kích hoạt'}</button></form>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" className="text-sm text-accent">{message}</p>}
    </section>
  </div>;
}
