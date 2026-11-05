import { useEffect, useState } from 'react';
import { chooseDownloadDirectory, getLibrarySettings } from './integrations/3dsmax/bridge.js';

export default function PluginSettings({ onClose }) {
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getLibrarySettings().then(result => { if (active) setDirectory(result.downloadDirectory); },
      () => { if (active) setError('Không đọc được cài đặt thư mục tải.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function choose() {
    setBusy(true); setError('');
    try {
      const result = await chooseDownloadDirectory();
      if (!result.cancelled) setDirectory(result.downloadDirectory);
    } catch (e) { setError(e.message || 'Không lưu được thư mục tải.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="plugin-settings-title" className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-panel p-5 shadow-xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3"><h2 id="plugin-settings-title" className="text-lg font-bold">Cài đặt</h2><button onClick={onClose} aria-label="Đóng cài đặt" className="rounded border border-line px-3 py-1">Đóng</button></div>
      <div><h3 className="mb-2 text-sm font-bold">Thư mục lưu model</h3><p className="break-all rounded border border-line bg-base p-3 font-mono text-xs">{directory || (busy ? 'Đang đọc…' : 'Chưa đọc được đường dẫn')}</p></div>
      <button disabled={busy} onClick={choose} className="rounded bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-40">{busy ? 'Đang xử lý…' : 'Chọn thư mục'}</button>
      <p className="text-xs text-mute">Thư mục mới áp dụng cho model tải sau. Model đã tải giữ nguyên vị trí để bảo toàn đường dẫn texture trong scene.</p>
      <p className="text-xs text-mute">Model được giải nén một lần. Vào Đã tải để import trực tiếp từ máy, không cần tải lại.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  </div>;
}
