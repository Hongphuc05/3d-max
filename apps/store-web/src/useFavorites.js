import { useCallback, useEffect, useRef, useState } from 'react';
import { createFavoriteFolder, deleteFavoriteFolder, getFavorites, isMaxHost, renameFavoriteFolder, setFavorite, setFavoriteFolder } from './integrations/3dsmax/bridge.js';

export const DEFAULT_FOLDER = 'default';
const lower = (id) => String(id).toLowerCase();

// Native reply -> state. Older replies carry only {favorites}; folders/assignments then default to empty.
function parse(reply) {
  const assignments = {};
  for (const [id, folder] of Object.entries(reply?.assignments ?? {})) assignments[lower(id)] = String(folder);
  return {
    ids: new Set((reply?.favorites ?? []).map(lower)),
    folders: (reply?.folders ?? []).map((f) => ({ id: String(f.id), name: String(f.name), contentDomain: f.contentDomain })),
    assignments,
  };
}

// The native protected index is the source of truth. Un-favoriting updates first and rolls back if saving fails;
// folder changes wait for the native reply (they can be refused: duplicate name, limits) and throw so the dialog can show why.
export function useFavorites() {
  const [state, setState] = useState(() => parse(null));
  const [error, setError] = useState('');
  const current = useRef(state);
  const apply = useCallback((next) => { current.current = next; setState(next); }, []);
  useEffect(() => {
    if (!isMaxHost()) return;
    let live = true;
    getFavorites().then((r) => { if (live) apply(parse(r)); },
      () => { if (live) setError('Không đọc được danh sách yêu thích.'); });
    return () => { live = false; };
  }, [apply]);

  const remove = useCallback((id) => {
    const key = lower(id);
    const before = current.current;
    const ids = new Set(before.ids); ids.delete(key);
    const assignments = { ...before.assignments }; delete assignments[key];
    apply({ ...before, ids, assignments }); setError('');
    setFavorite(id, false).then((r) => apply(parse(r)), () => { apply(before); setError('Không lưu được yêu thích. Thử lại.'); });
  }, [apply]);

  const change = useCallback(async (call) => { const next = parse(await call()); apply(next); setError(''); return next; }, [apply]);
  const assign = useCallback((id, folderId) => change(() => setFavoriteFolder(id, folderId)), [change]);
  const renameFolder = useCallback((folderId, name) => change(() => renameFavoriteFolder(folderId, name)), [change]);
  const deleteFolder = useCallback((folderId) => change(() => deleteFavoriteFolder(folderId)), [change]);
  /** Resolves to the id of the new folder. */
  const createFolder = useCallback(async (name, contentDomain) => {
    const next = await change(() => createFavoriteFolder(name, contentDomain));
    return next.folders.find((f) => f.contentDomain === contentDomain && f.name.toLowerCase() === name.trim().toLowerCase())?.id;
  }, [change]);

  return { ids: state.ids, folders: state.folders, assignments: state.assignments, error,
    remove, assign, createFolder, renameFolder, deleteFolder, isFavorite: (id) => state.ids.has(lower(id)) };
}
