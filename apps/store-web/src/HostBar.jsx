import { useEffect, useState } from 'react';
import { health } from './api.js';
import { Logo } from './components.jsx';
import { Icon } from './icons.jsx';
import { focusMax, getHostInfo, isMaxHost, listTargets, onHostEvent, selectTarget } from './integrations/3dsmax/bridge.js';
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
  const [api, setApi] = useState(null); // null | 'ok' | 'db' | 'down'
  const [refreshing, setRefreshing] = useState(false);
  const imported = useImports().filter(j => j.status === 'done').map(j => `${j.modelId}:${j.finishedAt}`).join('|');

  useEffect(() => {
    if (apiStatus !== undefined) { setApi(apiStatus); return; } // plugin v3: trang thai den tu host, khong goi /api/health (host chan)
    health().then(() => setApi('ok'), (e) => setApi(e.status === 503 ? 'db' : 'down'));
  }, [reloadKey, apiStatus]);

  // Danh sach cua so Max (pill trai) + push host.targetsChanged. Doi target/import xong -> doc lai.
  const [targets, setTargets] = useState(null); // null | {targets,currentId,focusEnabled} | {error}
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!max) return;
    listTargets().then(setTargets, (e) => setTargets({ error: e.message }));
    return onHostEvent('host.targetsChanged', setTargets);
  }, [max, reloadKey, imported]);
  const pick = (id) => { setMenu(false); selectTarget(id).then(setTargets, () => {}); };

  // onRefresh may be async (it asks the host to check the server first): show it is working and ignore clicks meanwhile.
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  // Pill trai: Connected: <label> + dropdown chon cua so Max (native chi con la khung WebView).
  const cur = targets?.targets?.find((t) => t.id === targets.currentId);
  let status;
  if (!max) status = <span className="text-mute">Trình duyệt · chỉ xem catalog. Download &amp; import có trong plugin 3ds Max</span>;
  else if (!targets) status = <span className="text-mute">Đang kết nối 3ds Max…</span>;
  else if (targets.error) status = <span className="text-danger">Mất kết nối 3ds Max: {targets.error}</span>;
  else status = cur
    ? <span className="truncate"><span className="text-ok">Connected</span>: {cur.label} ▾</span>
    : <span className="text-warn">Not connected · Chọn 3ds Max ▾</span>;
  const square = 'grid size-7 place-items-center rounded-md bg-accent text-accent-ink hover:brightness-110 disabled:cursor-progress';

  return (
    <header className="shrink-0 border-b border-line bg-bar px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="relative min-w-0">
          {targets?.targets ? <button onClick={() => setMenu(!menu)} aria-haspopup="listbox" aria-expanded={menu} aria-label="Chọn cửa sổ 3ds Max" className="max-w-full truncate rounded-md border border-line px-2.5 py-0.5 font-mono text-[11px]">{status}</button>
            : <div className="truncate rounded-md border border-line px-2.5 py-0.5 font-mono text-[11px]">{status}</div>}
          {menu && <ul role="listbox" className="absolute left-0 top-full z-50 mt-1 min-w-full rounded-md border border-line bg-raised py-1 text-xs shadow-xl">
            {targets.targets.length === 0 && <li className="px-3 py-1.5 text-mute">Không thấy cửa sổ 3ds Max nào</li>}
            {targets.targets.map((t) => <li key={t.id}><button role="option" aria-selected={t.id === targets.currentId} onClick={() => pick(t.id)} className={'block w-full whitespace-nowrap px-3 py-1.5 text-left font-mono hover:bg-base ' + (t.id === targets.currentId ? 'text-brand' : '')}>{t.label}</button></li>)}
          </ul>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {api && <Badge ok={api === 'ok'}>{api === 'ok' ? 'ONLINE' : api === 'db' ? 'DB LỖI' : 'OFFLINE'}</Badge>}
          <button onClick={refresh} disabled={refreshing} aria-busy={refreshing} aria-label="Làm mới" title={refreshing ? 'Đang làm mới…' : 'Làm mới'} className={square}>
            <Icon name="refresh" className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          </button>
          {max && <button onClick={() => focusMax().catch(() => {})} disabled={!targets?.focusEnabled} aria-label="Focus 3ds Max" title="Focus 3ds Max" className={square + ' disabled:opacity-40'}><Icon name="home" className="size-4" /></button>}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-4">
        <div className="flex shrink-0 items-center"><Logo className="h-11" /></div>
        {nav && <nav aria-label="Điều hướng" className="flex shrink-0 items-center gap-1">{nav}</nav>}
      </div>
    </header>
  );
}
