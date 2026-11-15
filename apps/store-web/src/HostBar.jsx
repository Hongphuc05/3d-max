import { useEffect, useState } from 'react';
import { health } from './api.js';
import { Logo } from './components.jsx';
import { Icon } from './icons.jsx';
import { getHostInfo, getSceneInfo, isMaxHost } from './integrations/3dsmax/bridge.js';
import { useImports } from './local-imports.js';

const Badge = ({ ok, children }) => (
  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] ${ok ? 'border-ok/40 text-ok' : 'border-danger/40 text-danger'}`}>
    <span className={`size-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-danger'}`} />{children}
  </span>
);

// Thanh tren cung: trang thai ket noi 3ds Max + API. Lam moi scene khi co job import xong.
// nav: dieu huong chinh (Models/Scenes/Cai dat/Thiet bi) nam ngang canh logo, nhu thiet ke thuong hieu.
export function HostBar({ reloadKey, onRefresh, apiStatus, nav = null }) {
  const max = isMaxHost();
  const [host, setHost] = useState(null);
  const [api, setApi] = useState(null); // null | 'ok' | 'db' | 'down'
  const [refreshing, setRefreshing] = useState(false);
  const imported = useImports().filter(j => j.status === 'done').map(j => `${j.modelId}:${j.finishedAt}`).join('|');

  useEffect(() => {
    if (apiStatus !== undefined) { setApi(apiStatus); return; } // plugin v3: trang thai den tu host, khong goi /api/health (host chan)
    health().then(() => setApi('ok'), (e) => setApi(e.status === 503 ? 'db' : 'down'));
  }, [reloadKey, apiStatus]);

  useEffect(() => {
    if (!max) return;
    Promise.all([getHostInfo(), getSceneInfo()])
      .then(([info, scene]) => setHost({ info, scene }), (e) => setHost({ error: e.message }));
  }, [max, reloadKey, imported]);

  // onRefresh may be async (it asks the host to check the server first): show it is working and ignore clicks meanwhile.
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  // Pill trai: trang thai ket noi + ten scene + phien ban Max. (Chon cua so Max / focus Max nam o thanh native WinForms, khong co trong web.)
  let status;
  if (!max) status = <span className="text-mute">Trình duyệt · chỉ xem catalog. Download &amp; import có trong plugin 3ds Max</span>;
  else if (!host) status = <span className="text-mute">Đang kết nối 3ds Max…</span>;
  else if (host.error) status = <span className="text-danger">Mất kết nối 3ds Max: {host.error}</span>;
  else status = (
    <span className="truncate">
      <span className="text-ok">Connected</span>: {host.scene.name || 'Untitled'}
      <span className="text-mute"> | {host.info.hostVersion}</span>
    </span>
  );
  const square = 'grid size-7 place-items-center rounded-md bg-accent text-accent-ink hover:brightness-110 disabled:cursor-progress';

  return (
    <header className="shrink-0 border-b border-line bg-bar px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate rounded-md border border-line px-2.5 py-0.5 font-mono text-[11px]">{status}</div>
        <div className="flex shrink-0 items-center gap-2">
          {api && <Badge ok={api === 'ok'}>{api === 'ok' ? 'ONLINE' : api === 'db' ? 'DB LỖI' : 'OFFLINE'}</Badge>}
          <button onClick={refresh} disabled={refreshing} aria-busy={refreshing} aria-label="Làm mới" title={refreshing ? 'Đang làm mới…' : 'Làm mới'} className={square}>
            <Icon name="refresh" className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-4">
        <div className="flex shrink-0 items-center"><Logo className="h-11" /></div>
        {nav && <nav aria-label="Điều hướng" className="flex shrink-0 items-center gap-1">{nav}</nav>}
      </div>
    </header>
  );
}
