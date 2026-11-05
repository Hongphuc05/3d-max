import { useEffect, useRef, useState } from 'react';
import { cancelImport, confirmImport, useImports } from './local-imports.js';
function Choices({ pending }) {
  const [selected, setSelected] = useState('');
  const section = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    section.current?.querySelector('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const cancel = () => cancelImport(pending.modelId);
  function keyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.key !== 'Tab') return;
    const focusable = [...section.current.querySelectorAll('input, button')].filter(node => !node.disabled);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={cancel}>
    <section ref={section} role="dialog" aria-modal="true" aria-labelledby="import-options-title" aria-describedby="import-options-help" onKeyDown={keyDown} onClick={event => event.stopPropagation()} className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 rounded-lg border border-line bg-panel p-5 shadow-xl">
      <h2 id="import-options-title" className="text-lg font-bold">Chọn file để import</h2>
      <p id="import-options-help" className="text-sm text-mute">Gói model có nhiều file. Chọn đúng phiên bản và renderer cần dùng; chỉ file được chọn sẽ được import.</p>
      <fieldset className="min-h-0 space-y-2 overflow-auto">
        <legend className="sr-only">File model đã lưu trên máy</legend>
        {pending.options.map(option => <label key={option.optionId} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 focus-within:border-accent">
          <input type="radio" name="import-option" value={option.optionId} checked={selected === option.optionId} onChange={() => setSelected(option.optionId)} className="mt-1 shrink-0" />
          <span className="min-w-0">
            <span className="block break-words text-sm font-bold">{option.label}</span>
            <span className="block break-all font-mono text-xs text-mute">{option.relativePath}</span>
            <span className="mt-1 block text-xs text-mute">{[option.format?.toUpperCase(), option.renderer, option.maxVersion ? 'Tên file ghi Max ' + option.maxVersion : null, pending.defaultOptionId === option.optionId ? 'File mặc định của gói' : null].filter(Boolean).join(' · ')}</span>
          </span>
        </label>)}
      </fieldset>
      <div className="flex justify-end gap-3">
        <button onClick={cancel} className="rounded border border-line px-4 py-2 text-sm">Hủy</button>
        <button disabled={!selected} onClick={() => confirmImport(pending.modelId, selected)} className="rounded bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-40">Import file đã chọn</button>
      </div>
    </section>
  </div>;
}
export default function ImportOptionsDialog() {
  const pending = useImports().find(item => item.status === 'choosing');
  return pending ? <Choices key={pending.modelId} pending={pending} /> : null;
}
