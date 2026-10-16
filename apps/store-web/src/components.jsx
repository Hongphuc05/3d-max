import { useEffect, useState } from 'react';
import { downloadUrl, importTicket, vnd } from './api.js';
import { useAuth } from './auth.jsx';
import { importAsset, isMaxHost } from './integrations/3dsmax/bridge.js';

const ICONS = {
  Architecture: 'home', Bathroom: 'bathroom', Childroom: 'children-park', Decoration: 'decoration',
  Furniture: 'Furniture', Kitchen: 'Kitchen', Lighting: 'Lighting', Material: 'Material',
  'Other models': 'othermodel', Plants: 'plant', Technology: 'tech',
};

export function Sidebar({ categories, sel, onSelect }) {
  const [open, setOpen] = useState(sel.category);
  const total = categories.reduce((a, c) => a + c.count, 0);
  const row = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100';
  return (
    <nav className="space-y-0.5">
      <button className={`${row} ${!sel.category ? 'bg-neutral-100 font-bold' : ''}`} onClick={() => onSelect({})}>
        <span className="flex-1">Tất cả</span><span className="text-xs text-neutral-400">{total}</span>
      </button>
      {categories.map((c) => (
        <div key={c.name}>
          <button
            className={`${row} ${sel.category === c.name && !sel.sub ? 'bg-neutral-100 font-bold' : ''}`}
            onClick={() => { setOpen(open === c.name ? null : c.name); onSelect({ category: c.name }); }}
          >
            {ICONS[c.name] && <img src={`/categories/${ICONS[c.name]}.svg`} alt="" className="size-5 opacity-70" />}
            <span className="flex-1">{c.name}</span><span className="text-xs text-neutral-400">{c.count}</span>
          </button>
          {open === c.name && c.children.map((s) => (
            <button
              key={s.name}
              className={`${row} pl-10 text-neutral-600 ${sel.sub === s.name && sel.category === c.name ? 'bg-neutral-100 font-bold text-neutral-900' : ''}`}
              onClick={() => onSelect({ category: c.name, sub: s.name })}
            >
              <span className="flex-1">{s.name}</span><span className="text-xs text-neutral-400">{s.count}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Card({ p, onOpen }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => onOpen(p)} className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:shadow-md">
      <div className="aspect-[4/3] overflow-hidden bg-neutral-100">
        <img
          src={p.thumb} alt={p.name} loading="lazy" onLoad={() => setOk(true)} onError={() => setOk(true)}
          className={`size-full object-cover transition duration-300 group-hover:scale-105 ${ok ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
      <div className="p-2.5">
        <div className="truncate text-sm font-bold" title={p.name}>{p.name}</div>
        <div className="mt-0.5 flex items-center justify-between text-xs text-neutral-500">
          <span className="truncate">{p.subcategory}</span><span className="font-bold text-brand">{vnd(p.price)}</span>
        </div>
      </div>
    </button>
  );
}

const chip = 'rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700';

export function ProductModal({ p, onClose, onLogin }) {
  const { user } = useAuth();
  const [msg, setMsg] = useState(null); // { ok, text }
  const [importing, setImporting] = useState(false);

  // shortcut: chua co license (A4) nen dang nhap la duoc tai/import.
  const doImport = async () => {
    if (!user) return onLogin();
    setImporting(true);
    setMsg({ ok: true, text: 'Đang tải và import vào 3ds Max…' });
    try {
      const { assetId, ticket } = await importTicket(p.slug);
      const r = await importAsset(assetId, ticket);
      setMsg({ ok: true, text: `Đã import ${r.imported} object (${r.file}).` });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const { info } = p;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="grid max-h-full w-full max-w-5xl overflow-auto rounded-t-2xl bg-white md:grid-cols-[1.6fr_1fr] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <img src={p.image} alt={p.name} className="max-h-[70vh] w-full bg-neutral-100 object-contain md:max-h-[85vh]" />
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500">{p.category} › {p.subcategory}</div>
              <h2 className="text-xl font-bold">{p.name}</h2>
            </div>
            <button onClick={onClose} aria-label="Đóng" className="rounded-lg px-2 py-1 text-xl leading-none hover:bg-neutral-100">×</button>
          </div>
          <div className="text-2xl font-bold text-brand">{vnd(p.price)}</div>
          <div className="flex flex-wrap gap-1.5">
            {info.formats.map((f) => <span key={f} className={chip}>.{f}</span>)}
            {info.renderers.map((r) => <span key={r} className={chip}>{r === 'vray' ? 'V-Ray' : 'Corona'}</span>)}
            {info.hasTextures && <span className={chip}>Có texture</span>}
            <span className={chip}>{info.sizeMB} MB</span>
          </div>
          <div className="mt-auto flex flex-col gap-2">
            {isMaxHost() && (
              <button onClick={doImport} disabled={importing} className="w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60">
                {importing ? 'Đang import…' : 'Import vào 3ds Max'}
              </button>
            )}
            {user
              ? <a href={downloadUrl(p.slug)} className="w-full rounded-xl border border-neutral-300 py-3 text-center font-bold hover:bg-neutral-100">Download</a>
              : <button onClick={onLogin} className="w-full rounded-xl border border-neutral-300 py-3 font-bold hover:bg-neutral-100">Đăng nhập để Download</button>}
            {msg && <p className={`text-sm ${msg.ok ? 'text-neutral-600' : 'text-red-600'}`}>{msg.text}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
