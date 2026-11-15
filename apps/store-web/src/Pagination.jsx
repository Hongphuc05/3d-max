// Dai so trang: luon co 3 trang dau, 3 trang cuoi, trang hien tai +-1; '…' o cho bi cat (mot trang bi cat thi hien luon trang do).
export function pageWindow(page, pages) {
  const set = new Set([1, 2, 3, pages - 2, pages - 1, pages, page - 1, page, page + 1]);
  const out = [];
  let last = 0;
  for (const n of [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (n - last === 2) out.push(last + 1);
    else if (n - last > 2) out.push('…');
    out.push(n);
    last = n;
  }
  return out;
}

const btn = 'grid size-7 place-items-center rounded-full text-mute hover:text-fg disabled:opacity-30';

export function Pagination({ page, pages, total, onPage }) {
  const go = (n) => onPage(Math.min(pages, Math.max(1, Math.round(n) || page)));
  return (
    <nav aria-label="Phân trang" title={`${total} model`} className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-line px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-1">
        <button aria-label="Trang đầu" disabled={page === 1} onClick={() => go(1)} className={btn}>«</button>
        <button aria-label="Trang trước" disabled={page === 1} onClick={() => go(page - 1)} className={btn}>‹</button>
        {pageWindow(page, pages).map((n, i) => n === '…'
          ? <span key={`e${i}`} className="px-1 text-mute">…</span>
          : <button key={n} aria-current={n === page ? 'page' : undefined} onClick={() => go(n)}
              className={`${btn} ${n === page ? 'border border-white font-bold text-fg' : ''}`}>{n}</button>)}
        <button aria-label="Trang sau" disabled={page === pages} onClick={() => go(page + 1)} className={btn}>›</button>
        <button aria-label="Trang cuối" disabled={page === pages} onClick={() => go(pages)} className={btn}>»</button>
      </div>
      <label className="flex items-center gap-2 text-mute">
        Nhập số trang
        <select aria-label="Nhập số trang" value={page} onChange={(e) => go(Number(e.target.value))}
          className="rounded-md border border-line bg-panel px-2 py-1 text-fg outline-none focus:border-brand">
          {Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>
    </nav>
  );
}
