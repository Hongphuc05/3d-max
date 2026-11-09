// Thu muc yeu thich: bang chon thu muc khi bam tim, va thanh thu muc (chip) o tab Yeu thich.
// Moi model nam trong dung 1 thu muc; "Default" la thu muc co san (khong doi ten/xoa duoc).
import { useEffect, useRef, useState } from 'react';
import { Preview } from './components.jsx';
import { Icon } from './icons.jsx';
import { DEFAULT_FOLDER } from './useFavorites.js';

const NAME_MAX = 40;
const inputCls = 'min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1.5 text-sm outline-none focus:border-brand';
const ghostBtn = 'rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg disabled:opacity-40';
const solidBtn = 'rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-accent-ink hover:brightness-110 disabled:opacity-40';
const message = (e) => e?.message || 'Không thực hiện được. Thử lại.';

/** Name field + confirm; keeps its own busy/error state. onSubmit may throw (the message is shown). */
function NameForm({ initial = '', submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try { await onSubmit(name.trim()); } catch (e) { setError(message(e)); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input ref={field} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} aria-label="Tên thư mục"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }} placeholder="Tên thư mục" className={inputCls} />
        <button type="submit" disabled={busy || !name.trim()} className={solidBtn}>{submitLabel}</button>
        <button type="button" onClick={onCancel} className={ghostBtn}>Hủy</button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </form>
  );
}

export function FavoriteFolderDialog({ product, folders, onAssign, onCreate, onClose }) {
  const [selected, setSelected] = useState(DEFAULT_FOLDER);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const section = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    section.current?.querySelector('input[type=search]')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const needle = query.trim().toLowerCase();
  const shown = [{ id: DEFAULT_FOLDER, name: 'Default' }, ...folders].filter((f) => !needle || f.name.toLowerCase().includes(needle));

  function keyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...section.current.querySelectorAll('input, button')].filter((node) => !node.disabled);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  async function create(name) {
    const id = await onCreate(name);
    setSelected(id ?? DEFAULT_FOLDER); setQuery(''); setCreating(false);
  }
  async function confirm() {
    setBusy(true); setError('');
    try { await onAssign(product.id, selected); onClose(); } catch (e) { setError(message(e)); setBusy(false); }
  }
  // Two panes like the brand design: the model/scene being favorited on the left, the folder picker on the right.
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <section ref={section} role="dialog" aria-modal="true" aria-labelledby="fav-folder-title" onKeyDown={keyDown} onClick={(e) => e.stopPropagation()}
        style={{ background: 'linear-gradient(180deg, #0b0809 0%, #160707 55%, #4a0b0b 100%)' }}
        className="grid max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-white/10 shadow-2xl sm:grid-cols-[15rem_minmax(0,1fr)]">
        <div data-testid="favorite-preview" className="flex flex-col gap-3 p-5 sm:border-r sm:border-white/10">
          <div className="overflow-hidden rounded-xl bg-white"><Preview source={product.image || product.thumb} name={product.name} /></div>
          <div className="truncate rounded-md bg-white/10 px-3 py-2 text-sm text-white" title={product.name}>{product.name}</div>
        </div>
        <div className="flex min-h-[19rem] min-w-0 flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="fav-folder-title" className="flex items-center gap-2 text-lg font-bold text-white"><Icon name="heart" className="size-5 text-white" />Thêm vào yêu thích</h2>
            <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1 text-white/70 hover:text-white"><Icon name="close" /></button>
          </div>
          <label className="flex items-center gap-2 rounded-md bg-white/10 px-3 focus-within:ring-1 focus-within:ring-brand">
            <Icon name="search" className="size-4 text-white/70" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm thư mục…" aria-label="Tìm thư mục" className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/50" />
          </label>
          <fieldset className="min-h-[6rem] flex-1 space-y-1.5 overflow-auto">
            <legend className="sr-only">Thư mục yêu thích</legend>
            {shown.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-2 text-sm text-white hover:bg-white/5 focus-within:border-brand has-[:checked]:bg-white/10">
                <input type="radio" name="fav-folder" value={f.id} checked={selected === f.id} onChange={() => setSelected(f.id)} className="shrink-0" />
                <span className="min-w-0 truncate">{f.name}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="py-3 text-center font-mono text-xs text-white/60">Không có thư mục nào khớp.</p>}
          </fieldset>
          {creating && <NameForm submitLabel="Tạo" onSubmit={create} onCancel={() => setCreating(false)} />}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            {creating ? <span /> : <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15"><span aria-hidden="true" className="text-lg leading-none">+</span>Tạo thư mục mới</button>}
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-md border border-white/20 px-4 py-2 text-xs text-white/80 hover:text-white">Hủy</button>
              <button onClick={confirm} disabled={busy} className="rounded-md bg-accent px-5 py-2 text-xs font-bold text-white hover:brightness-125 disabled:opacity-40">Thêm</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Chip bar of the Yeu thich tab: Tat ca | Default | user folders | + ; a user folder can be renamed or deleted. */
export function FavoriteFolderBar({ folders, counts, active, onSelect, onCreate, onRename, onDelete }) {
  const [mode, setMode] = useState(null); // 'create' | 'rename' | 'delete'
  const [error, setError] = useState('');
  const folder = folders.find((f) => f.id === active);
  const chip = (id, label, count) => (
    <button key={id} onClick={() => { setMode(null); setError(''); onSelect(id); }} aria-pressed={active === id}
      className={`rounded-full px-3 py-1 font-mono text-[11px] ${active === id ? 'bg-accent text-accent-ink font-bold' : 'border border-line text-mute hover:text-fg'}`}>{label} ({count ?? 0})</button>
  );
  async function remove() {
    setError('');
    try { await onDelete(folder.id); setMode(null); } catch (e) { setError(message(e)); }
  }
  return (
    <div className="space-y-2 px-3 pb-1" data-testid="favorite-folders">
      <div className="flex flex-wrap items-center gap-1.5">
        {chip('all', 'Tất cả', counts.all)}
        {chip(DEFAULT_FOLDER, 'Default', counts[DEFAULT_FOLDER])}
        {folders.map((f) => chip(f.id, f.name, counts[f.id]))}
        <button onClick={() => { setMode('create'); setError(''); }} aria-label="Tạo thư mục mới" title="Tạo thư mục mới"
          className="rounded-full border border-dashed border-line px-3 py-1 font-mono text-[11px] text-mute hover:text-fg">+</button>
      </div>
      {mode === 'create' && <NameForm submitLabel="Tạo" onSubmit={async (name) => { const id = await onCreate(name); setMode(null); if (id) onSelect(id); }} onCancel={() => setMode(null)} />}
      {folder && mode !== 'create' && (
        mode === 'rename' ? <NameForm initial={folder.name} submitLabel="Lưu" onSubmit={async (name) => { await onRename(folder.id, name); setMode(null); }} onCancel={() => setMode(null)} />
        : mode === 'delete' ? (
          <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
            <span>Xóa thư mục “{folder.name}”? {counts[folder.id] ? `${counts[folder.id]} model trong đó sẽ bị bỏ yêu thích.` : 'Thư mục đang trống.'}</span>
            <button onClick={remove} className="rounded-md bg-danger px-3 py-1 font-bold text-white">Xóa</button>
            <button onClick={() => setMode(null)} className={ghostBtn}>Hủy</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => { setMode('rename'); setError(''); }} className={ghostBtn}>Đổi tên</button>
            <button onClick={() => { setMode('delete'); setError(''); }} className={ghostBtn}>Xóa thư mục</button>
          </div>
        )
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
