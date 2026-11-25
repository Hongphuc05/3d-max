import { useState } from 'react';

// Dai so trang: luon co trang dau, cuoi, trang hien tai +-1; '…' o cho bi cat.
export function pageWindow(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1]);
  const out = [];
  let last = 0;
  for (const n of [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (n - last > 1) out.push('…');
    out.push(n);
    last = n;
  }
  return out;
}

const btn = 'grid size-7 place-items-center rounded-full text-mute hover:text-fg disabled:opacity-30';

export function Pagination({ page, pages, total, onPage }) {
  const [jump, setJump] = useState('');
  const go = (n) => onPage(Math.min(pages, Math.max(1, Math.round(n) || page)));
  return (
    <nav aria-label="Phân trang" title={`${total} model`} className="flex min-h-12 flex-wrap items-center gap-1 border-t border-line px-3 py-1.5 font-mono text-xs">
      <button aria-label="Trang đầu" disabled={page === 1} onClick={() => go(1)} className={btn}>«</button>
      <button aria-label="Trang trước" disabled={page === 1} onClick={() => go(page - 1)} className={btn}>‹</button>
      {pageWindow(page, pages).map((n, i) => n === '…'
        ? <span key={`e${i}`} className="px-1 text-mute">…</span>
        : <button key={n} aria-current={n === page ? 'page' : undefined} onClick={() => go(n)}
            className={`${btn} ${n === page ? 'bg-accent font-bold text-accent-ink' : ''}`}>{n}</button>)}
      <button aria-label="Trang sau" disabled={page === pages} onClick={() => go(page + 1)} className={btn}>›</button>
      <button aria-label="Trang cuối" disabled={page === pages} onClick={() => go(pages)} className={btn}>»</button>
      <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (jump) { go(Number(jump)); setJump(''); } }}>
        <input type="number" min="1" max={pages} value={jump} onChange={(e) => setJump(e.target.value)} placeholder="Nhập số trang"
          aria-label="Nhập số trang" className="w-36 rounded-md border border-line bg-panel px-2 py-1 outline-none focus:border-brand" />
      </form>
    </nav>
  );
}
