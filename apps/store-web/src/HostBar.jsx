import { useEffect, useState } from 'react';
import { health } from './api.js';
import { Icon } from './icons.jsx';
import { getHostInfo, getSceneInfo, isMaxHost } from './integrations/3dsmax/bridge.js';
import { useJobs } from './queue.js';

const Badge = ({ ok, children }) => (
  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] ${ok ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}>
    <span className={`size-1.5 rounded-full ${ok ? 'bg-accent' : 'bg-danger'}`} />{children}
  </span>
);

// Thanh tren cung: trang thai ket noi 3ds Max + API. Lam moi scene khi co job import xong.
export function HostBar({ reloadKey, onRefresh }) {
  const max = isMaxHost();
  const [host, setHost] = useState(null);
  const [api, setApi] = useState(null); // null | 'ok' | 'db' | 'down'
  const done = useJobs().filter((j) => j.status === 'done').length;

  useEffect(() => {
    health().then(() => setApi('ok'), (e) => setApi(e.status === 503 ? 'db' : 'down'));
  }, [reloadKey]);

  useEffect(() => {
    if (!max) return;
    Promise.all([getHostInfo(), getSceneInfo()])
      .then(([info, scene]) => setHost({ info, scene }), (e) => setHost({ error: e.message }));
  }, [max, reloadKey, done]);

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
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink"><Icon name="cube" /></span>
        <div className="leading-tight">
          <div className="text-sm font-bold">3DS Mood</div>
          <div className="font-mono text-[10px] tracking-widest text-accent">MODEL LIBRARY</div>
        </div>
      </div>
      <div className="min-w-0 flex-1 truncate font-mono text-xs">{status}</div>
      {api && <Badge ok={api === 'ok'}>{api === 'ok' ? 'ONLINE' : api === 'db' ? 'DB LỖI' : 'OFFLINE'}</Badge>}
      <button onClick={onRefresh} title="Làm mới" className="rounded-md border border-line p-1.5 text-mute hover:bg-raised hover:text-fg">
        <Icon name="refresh" />
      </button>
    </header>
  );
}
