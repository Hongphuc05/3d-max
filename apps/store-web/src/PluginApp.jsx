// P4.4: giao dien plugin (UI-1: bo cuc 3 cot, loc cay, tim, sap xep, phan trang, tab Online / Đã tải) tren du lieu v3.
// Khong co tai khoan, khong co man license: thiet bi + quyen do may chu quyet dinh (xem usePluginCatalog / v3-catalog).
import { useEffect, useMemo, useState } from 'react';
import { Filters } from './components.jsx';
import { matchesCategory } from './catalog-view.js';
import { HostBar } from './HostBar.jsx';
import { Icon } from './icons.jsx';
import { getLibraryStatus, isMaxHost } from './integrations/3dsmax/bridge.js';
import { BuyLibrary, PluginCard, PluginDetail } from './plugin-components.jsx';
import OrderDialog from './OrderDialog.jsx';
import { Queue } from './Queue.jsx';
import { useJobs } from './queue.js';
import { owns } from './v3-catalog.js';
import { usePluginCatalog } from './usePluginCatalog.js';
import { downloadedProducts, useDownloadedLibrary } from './useDownloadedLibrary.js';
import PluginSettings from './PluginSettings.jsx';
import ImportOptionsDialog from './ImportOptionsDialog.jsx';

const PAGE = 30;
const SORTS = {
  name: ['Tên A → Z', (a, b) => a.name.localeCompare(b.name)],
  small: ['Nhẹ → nặng', (a, b) => (a.info.sizeMB ?? 0) - (b.info.sizeMB ?? 0)],
  big: ['Nặng → nhẹ', (a, b) => (b.info.sizeMB ?? 0) - (a.info.sizeMB ?? 0)],
};

function Device({ max }) {
  const [machineCode, setMachineCode] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (max) getLibraryStatus().then((s) => setMachineCode(s?.machineCode ?? null), () => setMachineCode(null)); }, [max]);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title="Thiết bị" className="flex flex-col items-center gap-1 rounded-md p-2 text-[10px] text-mute hover:bg-raised hover:text-fg">
        <Icon name="user" className="size-5" />Thiết bị
      </button>
      {open && (
        <div className="absolute bottom-0 left-12 z-50 w-72 rounded-md border border-line bg-raised p-3 text-sm shadow-xl">
          <div className="font-mono text-[10px] tracking-wider text-mute">MÃ MÁY</div>
          <div className="mt-1 break-all font-mono text-xs">{machineCode || (max ? 'Đang đọc…' : 'Chỉ có trong plugin 3ds Max')}</div>
          <p className="mt-2 font-mono text-[10px] text-mute">Quyền tải gắn với thiết bị này. Không cần tài khoản.</p>
        </div>
      )}
    </div>
  );
}

export default function PluginApp({ orderPollMs }) {
  const [subs, setSubs] = useState(() => new Set());
  const [text, setText] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('online');
  const [activeId, setActiveId] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [buying, setBuying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { products, tree, state, error, offline, progress, entitlements } = usePluginCatalog(reloadKey);
  const jobs = useJobs();
  const max = isMaxHost();
  const completed = jobs.filter(j => j.status === 'done').length;
  const downloads = useDownloadedLibrary(reloadKey, completed);
  const downloadedIds = useMemo(() => new Set(downloads.models.map(m => m.modelId)), [downloads.models]);
  const ctx = useMemo(() => ({ max, entitlements, offline, local: tab === 'done', downloadedIds,
    onBuy: () => setBuying(true), onDownloaded: () => setTab('done') }), [max, entitlements, offline, tab, downloadedIds]);

  // Chon model theo id (khong giu doi tuong cu): khi catalog tu lam moi, panel chi tiet cap nhat theo ban moi hoac dong neu model da bi go.
  const licensed = owns(entitlements);
  const mine = useMemo(() => downloadedProducts(downloads.models, products), [downloads.models, products]);
  const active = useMemo(() => (tab === 'done' ? mine : products).find(p => p.id === activeId) || null, [products, mine, tab, activeId]);
  const listReady = tab === 'done' || state === 'ready';
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

  return (
    <div className="flex h-screen flex-col">
      <HostBar reloadKey={reloadKey} onRefresh={() => setReloadKey((k) => k + 1)} apiStatus={max ? (offline ? 'down' : 'ok') : null} />
      {offline && <div role="status" className="border-b border-warn/40 bg-warn/10 px-3 py-1 font-mono text-[11px] text-warn">Đang offline — hiển thị catalog đã lưu trên máy. Cần Internet để tải model.</div>}
      {max && entitlements && !licensed && !offline && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          <span>Thiết bị này chưa có license thư viện — các model đang bị khóa.</span><BuyLibrary ctx={ctx} className="!w-auto px-4" />
        </div>
      )}
      {progress && (
        <div role="status" className="border-b border-line px-3 py-1 font-mono text-[11px] text-mute">
          Đang tải ảnh xem trước {progress.done}/{progress.total}…
          <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="mt-1 h-1 overflow-hidden rounded bg-raised">
            <div className="h-full bg-accent" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-3">
          <div className="flex flex-col items-center gap-1 rounded-md bg-raised p-2 text-[10px] text-accent" title="Models"><Icon name="cube" className="size-5" />Models</div>
          {max && <button onClick={() => setSettingsOpen(true)} title="Cài đặt" className="flex flex-col items-center gap-1 rounded-md p-2 text-[10px] text-mute hover:bg-raised hover:text-fg"><Icon name="settings" className="size-5" />Cài đặt</button>}
          <div className="mt-auto"><Device max={max} /></div>
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
              <div className="font-mono text-xs text-mute">{listReady ? `${rows.length} model` : '…'}</div>
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
            {tab === 'done' && downloads.error && <p role="alert" className="py-3 text-sm text-danger">{downloads.error}</p>}
            {tab !== 'done' && state === 'error' && (
              <div role="alert" className="mx-auto mt-16 max-w-md rounded-md border border-danger/40 bg-danger/10 p-4 text-center font-mono text-xs text-danger">
                <p>{error}</p>
                <button onClick={() => setReloadKey((k) => k + 1)} className="mt-3 rounded-md bg-accent px-4 py-1.5 font-bold text-accent-ink">Thử lại</button>
              </div>
            )}
            {listReady && rows.length === 0 && (
              <p className="py-16 text-center font-mono text-xs text-mute">
                {tab === 'done' ? (mine.length ? 'Không có model đã tải nào khớp bộ lọc.' : 'Chưa có model đã tải. Bấm Download ở tab Online.')
                  : products.length ? 'Không có model nào khớp bộ lọc.' : 'Catalog hiện đang trống.'}
              </p>
            )}
            {tab !== 'done' && state === 'loading' && max && <p role="status" className="py-2 text-center font-mono text-xs text-mute">Lần đầu mở: đang tải catalog từ máy chủ (cần Internet)…</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {!listReady && state === 'loading'
                ? Array.from({ length: 18 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-panel" />)
                : view.map((p) => <PluginCard key={p.id} p={p} active={activeId === p.id} onOpen={(m) => setActiveId(m.id)} ctx={ctx} />)}
            </div>
          </div>

          {listReady && rows.length > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 font-mono text-xs">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">‹ Trước</button>
              <span className="text-mute">Trang {page} / {pages} · {rows.length} model</span>
              <button disabled={page === pages} onClick={() => setPage(page + 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">Sau ›</button>
            </div>
          )}
        </main>

        <PluginDetail p={active} onClose={() => setActiveId(null)} ctx={ctx} />
      </div>
      {/* Thanh toan xong (chu xac nhan) -> tai lai catalog + quyen: nut chuyen sang Download khong can bam Lam moi. */}
      {buying && <OrderDialog pollMs={orderPollMs} onClose={() => setBuying(false)} onConfirmed={() => setReloadKey((k) => k + 1)} />}
      {settingsOpen && <PluginSettings onClose={() => setSettingsOpen(false)} />}
      <ImportOptionsDialog />
    </div>
  );
}
