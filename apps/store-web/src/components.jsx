import { useEffect, useState } from 'react';
import { categoryKey, categoryKeys } from './catalog-view.js';
import { Icon } from './icons.jsx';

export const rendererLabel = (r) => ({ vray: 'V-Ray', corona: 'Corona' }[r] || r);
export const subKey = (c, s) => `${c}/${s}`;

// Checkbox 3 trang thai (indeterminate dat qua ref vi khong co thuoc tinh HTML).
const Check = ({ checked, partial, onChange }) => (
  <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 shrink-0 cursor-pointer"
    ref={(el) => el && (el.indeterminate = partial)} />
);

const toggle = (set, keys, on) => {
  const next = new Set(set);
  keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
  return next;
};

function FolderFilter({ folder, parent, ancestors = [], subs, setSubs, open, setOpen }) {
  const key = categoryKey(folder, parent);
  const keys = categoryKeys(folder, parent);
  const selected = keys.filter(value => subs.has(value)).length;
  const children = folder.children || [];
  const expanded = open.has(key);
  // Removing a child also removes broad ancestor selections; sibling selections
  // remain, so an ancestor filter cannot silently select that child again.
  const select = on => setSubs(toggle(subs, on ? keys : [...keys, ...ancestors], on));
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-raised">
        <Check checked={selected === keys.length} partial={selected > 0 && selected < keys.length}
          onChange={() => select(selected < keys.length)} />
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={children.length ? expanded : undefined}
          onClick={() => children.length ? setOpen(toggle(open, [key], !expanded)) : select(!subs.has(key))}>
          <Icon name="cube" className="size-4 shrink-0 text-mute" />
          <span className="flex-1 truncate" title={folder.path || folder.name}>{folder.name}</span>
          <span className="font-mono text-[10px] text-mute">{folder.count}</span>
          {children.length > 0 && <Icon name="chevron" className={`size-3.5 text-mute transition ${expanded ? 'rotate-90' : ''}`} />}
        </button>
      </div>
      {expanded && children.length > 0 && <ul className="mb-1 ml-3 border-l border-line pl-1">
        {children.map(child => <FolderFilter key={categoryKey(child, key)} folder={child} parent={key} ancestors={[...ancestors, key]}
          subs={subs} setSubs={setSubs} open={open} setOpen={setOpen} />)}
      </ul>}
    </li>
  );
}

export function Filters({ categories, subs, setSubs, renderers, setRenderers, rendererOptions = [] }) {
  const [open, setOpen] = useState(() => new Set());
  const active = subs.size + renderers.size;
  const head = 'mb-1.5 mt-4 font-mono text-[10px] tracking-widest text-mute';
  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <Icon name="filter" className="size-3.5 text-accent" />
        <span className="text-sm font-bold">Bộ lọc</span>
        {active > 0 && <span className="rounded border border-accent/40 px-1.5 font-mono text-[10px] text-accent">{active}</span>}
        {active > 0 && (
          <button onClick={() => { setSubs(new Set()); setRenderers(new Set()); }} className="ml-auto font-mono text-[11px] text-mute hover:text-fg">
            Xóa lọc
          </button>
        )}
      </div>

      <div className={head}>DANH MỤC</div>
      <ul className="space-y-px">
        {categories.map(folder => <FolderFilter key={categoryKey(folder)} folder={folder}
          subs={subs} setSubs={setSubs} open={open} setOpen={setOpen} />)}
      </ul>

      {rendererOptions.length > 0 && <div className={head}>RENDERER</div>}
      {rendererOptions.map(k => (
        <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-raised">
          <Check checked={renderers.has(k)} onChange={() => setRenderers(toggle(renderers, [k], !renderers.has(k)))} />
          {rendererLabel(k)}
        </label>
      ))}
    </div>
  );
}

// Nut Download trong 3ds Max: Download = tai goi ve may roi import vao scene (1 lan bam).
// Tren trinh duyet khong co Download (O7) -> component nay khong render.
export function Preview({ source, name, lazy = false }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [source]);
  if (!source || failed) return <div className="grid aspect-square w-full place-items-center bg-raised font-mono text-xs text-mute">Chưa có ảnh preview</div>;
  return <img src={source} alt={name} loading={lazy ? 'lazy' : undefined}
    onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
    className={`aspect-square size-full object-contain transition duration-300 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`} />;
}
