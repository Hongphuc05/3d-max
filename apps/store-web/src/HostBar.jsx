import { useEffect, useState } from 'react';
import { health } from './api.js';
import { Icon } from './icons.jsx';
import { getHostInfo, getSceneInfo, isMaxHost } from './integrations/3dsmax/bridge.js';
import { useImports } from './local-imports.js';

const Badge = ({ ok, children }) => (
  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] ${ok ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}>
    <span className={`size-1.5 rounded-full ${ok ? 'bg-accent' : 'bg-danger'}`} />{children}
  </span>
);

// Thanh tren cung: trang thai ket noi 3ds Max + API. Lam moi scene khi co job import xong.
export function HostBar({ reloadKey, onRefresh, apiStatus }) {
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

  let status;
  if (!max) status = <span className="text-mute">Trình duyệt · chỉ xem catalog. Download &amp; import có trong plugin 3ds Max</span>;
  else if (!host) status = <span className="text-mute">Đang kết nối 3ds Max…</span>;
  else if (host.error) status = <span className="text-danger">Mất kết nối 3ds Max: {host.error}</span>;
  else status = (
    <span className="truncate">
      <span className="text-accent">Connected</span>
      <span className="text-mute"> · {host.info.hostVersion} · {host.scene.objects} object · {host.scene.renderer}</span>
    </span>
  );

  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 py-2 sm:gap-4 border-b border-line bg-panel px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-ink"><Icon name="cube" /></span>
        <div className="leading-tight">
          <div className="text-xl font-bold">3dsmood</div>
          <div className="font-mono text-[11px] tracking-widest text-accent">ONLINE MODEL LIBRARY</div>
        </div>
      </div>
      <div className="order-last w-full min-w-0 truncate font-mono text-xs sm:order-none sm:w-auto sm:flex-1">{host?.info?.importTarget === 'selected' ? null : status}</div>
      {api && <Badge ok={api === 'ok'}>{api === 'ok' ? 'ONLINE' : api === 'db' ? 'DB LỖI' : 'OFFLINE'}</Badge>}
      <button onClick={refresh} disabled={refreshing} aria-busy={refreshing} aria-label="Làm mới" title={refreshing ? 'Đang làm mới…' : 'Làm mới'}
        className="rounded-md border border-line p-1.5 text-mute hover:bg-raised hover:text-fg disabled:cursor-progress disabled:text-accent">
        <Icon name="refresh" className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
      </button>
    </header>
  );
}
