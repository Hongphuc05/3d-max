// P4.4: giao dien plugin (UI-1: bo cuc 3 cot, loc cay, tim, sap xep, phan trang, tab Online / Đã tải) tren du lieu v3.
// Khong co tai khoan, khong co man license: thiet bi + quyen do may chu quyet dinh (xem usePluginCatalog / v3-catalog).
import { useEffect, useMemo, useState } from 'react';
import { Filters } from './components.jsx';
import { matchesCategory } from './catalog-view.js';
import { HostBar } from './HostBar.jsx';
import { Icon } from './icons.jsx';
import { isMaxHost } from './integrations/3dsmax/bridge.js';
import { PluginCard, PluginDetail } from './plugin-components.jsx';
import LibraryActivation from './LibraryActivation.jsx';
import { Queue } from './Queue.jsx';
import { useJobs } from './queue.js';
import { owns } from './v3-catalog.js';
import { usePluginCatalog } from './usePluginCatalog.js';

const PAGE = 30;
const SORTS = {
  name: ['Tên A → Z', (a, b) => a.name.localeCompare(b.name)],
  small: ['Nhẹ → nặng', (a, b) => (a.info.sizeMB ?? 0) - (b.info.sizeMB ?? 0)],
  big: ['Nặng → nhẹ', (a, b) => (b.info.sizeMB ?? 0) - (a.info.sizeMB ?? 0)],
};

function Device({ open }) {
  return (
    <div className="relative">
      <button onClick={open} title="Thiết bị" className="flex flex-col items-center gap-1 rounded-md p-2 text-[10px] text-mute hover:bg-raised hover:text-fg">
        <Icon name="user" className="size-5" />Thiết bị
      </button>
    </div>
  );
}

export default function PluginApp() {
  const [subs, setSubs] = useState(() => new Set());
  const [text, setText] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('online');
  const [activeId, setActiveId] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activating, setActivating] = useState(false);
  const { products, tree, state, error, offline, progress, entitlements, enterLibrary } = usePluginCatalog(reloadKey);
  const jobs = useJobs();
  const max = isMaxHost();
  const ctx = useMemo(() => ({ max, entitlements, offline, onActivate: () => setActivating(true) }), [max, entitlements, offline]);

  // Chon model theo id (khong giu doi tuong cu): khi catalog tu lam moi, panel chi tiet cap nhat theo ban moi hoac dong neu model da bi go.
  const active = useMemo(() => products.find((p) => p.id === activeId) || null, [products, activeId]);
  const mine = useMemo(() => products.filter((p) => owns(entitlements, p.id)), [products, entitlements]);
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (tab === 'online' ? products : mine)
      .filter((p) => matchesCategory(p, subs) && (!needle || p.name.toLowerCase().includes(needle)))
      .sort(SORTS[sort][1]);
  }, [products, mine, tab, subs, text, sort]);

  useEffect(() => setPage(1), [tab, subs, text, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => setPage((previous) => Math.min(previous, pages)), [pages]);
  const view = rows.slice((page - 1) * PAGE, page * PAGE);
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)}
      className={`rounded-md px-4 py-1.5 font-mono text-xs font-bold ${tab === k ? 'bg-accent text-accent-ink' : 'border border-line text-mute hover:text-fg'}`}>{label}</button>
  );

  if (state === 'syncing_previews' && progress) {
    const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    return (
      <div className="flex h-screen flex-col bg-surface text-fg select-none">
        <HostBar reloadKey={reloadKey} onRefresh={() => setReloadKey((k) => k + 1)} apiStatus={max ? (offline ? 'down' : 'ok') : null} />
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-8 shadow-2xl">
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-inner">
              <Icon name="cube" className="size-9 animate-pulse" />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-fg">Đang đồng bộ ảnh thư viện</h2>
            <p className="mt-2 text-xs text-mute leading-relaxed">
              Lần đầu mở plugin: đang tải thumbnail preview về máy khách để duyệt mượt mà và lưu cache offline.
            </p>

            <div className="mt-6">
              <div className="flex justify-between font-mono text-xs mb-2">
                <span className="text-mute">Tiến độ tải ảnh</span>
                <span className="font-bold text-accent">{progress.done} / {progress.total} ({percent}%)</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="mt-7 flex justify-center gap-3">
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-lg border border-line px-4 py-2 font-mono text-xs font-semibold text-mute hover:bg-raised hover:text-fg transition-colors"
              >
                Thử lại
              </button>
              <button
                onClick={() => enterLibrary()}
                className="rounded-lg bg-accent px-4 py-2 font-mono text-xs font-bold text-accent-ink hover:opacity-90 transition-opacity"
              >
                Vào thư viện ngay
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <HostBar reloadKey={reloadKey} onRefresh={() => setReloadKey((k) => k + 1)} apiStatus={max ? (offline ? 'down' : 'ok') : null} />
      {offline && <div role="status" className="border-b border-warn/40 bg-warn/10 px-3 py-1 font-mono text-[11px] text-warn">Đang offline — hiển thị catalog đã lưu trên máy. Cần Internet để tải model.</div>}
      {max && entitlements === null && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        <span>Chưa xác minh được quyền. Kiểm tra kết nối hoặc kích hoạt lại thư viện nếu license không hợp lệ.</span>
        <button type="button" className="underline" onClick={() => setReloadKey((k) => k + 1)}>Thử xác minh lại</button>
        <button type="button" className="underline" onClick={() => setActivating(true)}>Mở kích hoạt</button>
      </div>}
      {progress && <div role="status" className="border-b border-line px-3 py-1 font-mono text-[11px] text-mute">Đang tải ảnh xem trước {progress.done}/{progress.total}…</div>}

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-3">
          <div className="flex flex-col items-center gap-1 rounded-md bg-raised p-2 text-[10px] text-accent" title="Models"><Icon name="cube" className="size-5" />Models</div>
          <div className="mt-auto"><Device open={() => setActivating(true)} /></div>
        </nav>

        <div className={`${drawer ? 'fixed inset-0 z-30 bg-black/60' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent`} onClick={() => setDrawer(false)}>
          <aside className="flex h-full w-72 flex-col border-r border-line bg-panel lg:w-64" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 flex-1 overflow-auto">
              <Filters categories={tree} subs={subs} setSubs={setSubs} renderers={new Set()} setRenderers={() => {}} rendererOptions={[]} />
            </div>
            {max && <Queue />}
          </aside>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {tabBtn('online', 'Online')}
            {tabBtn('done', `Đã tải${mine.length ? ` (${mine.length})` : ''}`)}
            <button onClick={() => setDrawer(true)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg lg:hidden">
              <Icon name="filter" className="size-3.5" />Lọc{subs.size ? ` (${subs.size})` : ''}
              {max && activeJobs > 0 && <span className="text-accent">· {activeJobs} đang tải</span>}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="mr-2 leading-tight">
              <div className="font-mono text-[10px] tracking-widest text-accent">3DS MOOD MODELS</div>
              <div className="font-mono text-xs text-mute">{state === 'ready' ? `${rows.length} model` : '…'}</div>
            </div>
            <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-accent">
              <Icon name="search" className="size-3.5 text-mute" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm model…" className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-mute" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-xs outline-none focus:border-accent">
              {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            {state === 'error' && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-4 font-mono text-xs text-danger">{error}</p>}
            {state === 'ready' && rows.length === 0 && (
              <p className="py-16 text-center font-mono text-xs text-mute">
                {tab === 'done' ? (entitlements ? 'Thiết bị này chưa sở hữu model nào.' : 'Chưa xác minh được quyền của thiết bị này.')
                  : products.length ? 'Không có model nào khớp bộ lọc.' : 'Catalog hiện đang trống.'}
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {state === 'loading'
                ? Array.from({ length: 18 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-panel" />)
                : view.map((p) => <PluginCard key={p.id} p={p} active={activeId === p.id} onOpen={(m) => setActiveId(m.id)} ctx={ctx} />)}
            </div>
          </div>

          {state === 'ready' && rows.length > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 font-mono text-xs">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">‹ Trước</button>
              <span className="text-mute">Trang {page} / {pages} · {rows.length} model</span>
              <button disabled={page === pages} onClick={() => setPage(page + 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">Sau ›</button>
            </div>
          )}
        </main>

        <PluginDetail p={active} onClose={() => setActiveId(null)} ctx={ctx} />
      </div>
      {activating && <LibraryActivation max={max} onClose={() => setActivating(false)} onActivated={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
