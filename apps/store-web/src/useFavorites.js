import { useCallback, useEffect, useRef, useState } from 'react';
import { getFavorites, isMaxHost, setFavorite } from './integrations/3dsmax/bridge.js';

// The native protected index is the source of truth; the UI updates first and rolls back if saving fails.
export function useFavorites() {
  const [ids, setIds] = useState(() => new Set());
  const [error, setError] = useState('');
  const current = useRef(ids);
  const apply = useCallback((next) => { current.current = next; setIds(next); }, []);
  useEffect(() => {
    if (!isMaxHost()) return;
    let live = true;
    getFavorites().then((r) => { if (live) apply(new Set((r?.favorites ?? []).map((id) => String(id).toLowerCase()))); },
      () => { if (live) setError('Không đọc được danh sách yêu thích.'); });
    return () => { live = false; };
  }, [apply]);
  const toggle = useCallback((id) => {
    const key = String(id).toLowerCase();
    const want = !current.current.has(key);
    const next = new Set(current.current);
    if (want) next.add(key); else next.delete(key);
    apply(next); setError('');
    setFavorite(id, want).catch(() => {
      const undo = new Set(current.current);
      if (want) undo.delete(key); else undo.add(key);
      apply(undo); setError('Không lưu được yêu thích. Thử lại.');
    });
  }, [apply]);
  return { ids, error, toggle, isFavorite: (id) => ids.has(String(id).toLowerCase()) };
}
