// Danh muc cong khai (trinh duyet thuong): chi xem model, khong mua/gia/license. Tai ve thu vien = MZP installer cua plugin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Filters, Logo, Preview } from './components.jsx';
import { Icon } from './icons.jsx';
import { matchesCategory } from './catalog-view.js';
import { usePluginCatalog } from './usePluginCatalog.js';
import { Pagination } from './Pagination.jsx';
import { DEFAULT_COLS, GRID_ROWS, GridZoom, gridClass, PluginCard, resizeGrid } from './plugin-components.jsx';
import { DOMAIN_GLYPH, NavButton, SORTS } from './PluginApp.jsx';

const MZP = '/download/3dsmood-library.mzp';

function DownloadButton({ className = '' }) {
  const [ready, setReady] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeDownload = useRef(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(MZP, { method: 'HEAD', signal: c.signal }).then(r => { if (!c.signal.aborted) setReady(r.status === 200); }, () => { if (!c.signal.aborted) setReady(false); });
    return () => { c.abort(); activeDownload.current?.abort(); };
  }, []);

  async function download(event) {
    event.preventDefault();
    if (activeDownload.current) return;
    const c = new AbortController();
    activeDownload.current = c;
    setBusy(true); setError('');
    try {
      const response = await fetch(MZP, { method: 'GET', cache: 'no-store', signal: c.signal });
      if (!response.ok) throw new Error('Download unavailable');
      const payload = await response.blob();
      const signature = new Uint8Array(await payload.slice(0, 4).arrayBuffer());
      if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw new Error('Invalid installer response');
      if (c.signal.aborted) return;
      // The live server can still send filename=.zip. A local Blob URL has no
      // Content-Disposition header, so save the verified response bytes as .mzp.
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url; link.download = '3dsmood-library.mzp'; link.hidden = true;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (!c.signal.aborted) setError('Không tải được bộ cài hợp lệ. Kiểm tra kết nối rồi bấm tải lại.');
    } finally {
      if (activeDownload.current === c) activeDownload.current = null;
      if (!c.signal.aborted) setBusy(false);
    }
  }

  const cls = `inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-bold ${className}`;
  return <>
    {ready === false
      ? <button type="button" disabled className={`${cls} cursor-not-allowed border border-line text-mute`}>Bản cài đặt sắp có</button>
      : <a href={MZP} download="3dsmood-library.mzp" onClick={download} aria-disabled={busy} aria-busy={busy} className={`${cls} bg-accent text-accent-ink hover:brightness-110 ${busy ? 'pointer-events-none opacity-60' : ''}`}>{busy ? 'Đang tải bộ cài…' : 'Tải xuống thư viện'}</a>}
    {error && <p role="alert" className="max-w-sm text-xs text-danger">{error}</p>}
  </>;
}

function Lightbox({ p, onClose }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={p.name} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-auto bg-white"><Preview source={p.image || p.thumb} name={p.name} /></div>
        <div className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{p.name}</div>
            <div className="truncate font-mono text-xs text-mute">{p.folderPath || p.category}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg">Đóng</button>
        </div>
      </div>
    </div>
  );
}

// Bo cuc giong plugin (header 2 hang, sidebar danh muc, thanh tim + sap xep, luoi 10 cot, 100 model/trang, cuon doc); bo cac nut chi co trong Max.
export default function PublicCatalog() {
  const [reloadKey, setReloadKey] = useState(0);
  const { products: allProducts, tree: allTree, state, error } = usePluginCatalog(reloadKey);
  const [domain, setDomain] = useState("3dmodels");
  const products = useMemo(() => allProducts.filter(p => (p.contentDomain || "3dmodels") === domain), [allProducts, domain]);
  const tree = useMemo(() => allTree.filter(c => (c.contentDomain || "3dmodels") === domain), [allTree, domain]);
  const noun = domain === "3dscenes" ? "scene" : "model";
  const [subs, setSubs] = useState(() => new Set());
  const [text, setText] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const pageSize = cols * GRID_ROWS;
  const scroller = useRef(null);
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return products.filter((p) => matchesCategory(p, subs) && (!needle || p.name.toLowerCase().includes(needle))).sort(SORTS[sort][1]);
  }, [products, subs, text, sort]);
  useEffect(() => setPage(1), [subs, text, sort, domain]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const view = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [page, cols]);
  function selectDomain(next) { setDomain(next); setSubs(new Set()); setText(''); setActive(null); }

  return (
    <div className="flex h-screen flex-col bg-base text-fg">
      <header className="shrink-0 border-b border-line bg-bar px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <Logo className="h-11" />
            <nav aria-label="Content domain" className="flex items-center gap-1">
              {[["3dmodels", "Models"], ["3dscenes", "Scenes"]].map(([d, label]) => <NavButton key={d} glyph={DOMAIN_GLYPH[d]} label={label} active={domain === d} onClick={() => selectDomain(d)} />)}
            </nav>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <DownloadButton />
            <p className="text-[11px] text-mute">Trong 3ds Max: Scripting → Run Script → chọn file .mzp.</p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className={`${drawer ? 'fixed inset-0 z-30 bg-black/60' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent`} onClick={() => setDrawer(false)}>
          <aside className="h-full w-72 overflow-auto border-r border-line bg-panel lg:w-48" onClick={(e) => e.stopPropagation()}>
            <Filters categories={tree} subs={subs} setSubs={setSubs} renderers={new Set()} setRenderers={() => {}} rendererOptions={[]} />
          </aside>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <label className="flex h-8 min-w-32 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-white">
              <Icon name="search" className="size-3.5 text-mute" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Tìm ${noun}…`} aria-label={`Tìm ${noun}`} className="w-full bg-transparent text-sm outline-none placeholder:text-mute" />
            </label>
            <span className="font-mono text-xs text-mute">{state === 'ready' ? `${rows.length} ${noun}` : ''}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sắp xếp" className="h-8 rounded-md border border-line bg-panel px-2 font-mono text-xs outline-none focus:border-white">
              {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <GridZoom cols={cols} onCols={(n) => resizeGrid(setCols, setPage, cols, n)} />
            <button type="button" onClick={() => setDrawer(true)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg lg:hidden">
              <Icon name="filter" className="size-3.5" />Danh mục{subs.size ? ` (${subs.size})` : ''}
            </button>
          </div>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
            {state === 'loading' && <p role="status" className="py-16 text-center font-mono text-xs text-mute">Đang tải danh mục…</p>}
            {state === 'error' && (
              <div role="alert" className="mx-auto mt-16 max-w-md rounded-md border border-danger/40 bg-danger/10 p-4 text-center font-mono text-xs text-danger">
                {error}
                <div><button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-3 rounded-md border border-danger/40 px-3 py-1">Thử lại</button></div>
              </div>
            )}
            {state === 'ready' && rows.length === 0 && <p className="py-16 text-center text-sm text-mute">Không có {noun} nào khớp.</p>}
            <div className={gridClass} style={{ '--cols': cols }}>
              {view.map((p) => <PluginCard key={p.id} p={p} active={active?.id === p.id} onOpen={setActive} ctx={{}} actions={false} />)}
            </div>
          </div>
          {rows.length > pageSize && <Pagination page={page} pages={pages} total={rows.length} onPage={setPage} />}
        </main>
      </div>
      {active && <Lightbox p={active} onClose={() => setActive(null)} />}
    </div>
  );
}
