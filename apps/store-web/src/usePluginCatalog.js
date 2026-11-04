// P4.4: catalog cho plugin 3ds Max. Du lieu den tu ban sao cuc bo ma host giu (host tra loi /api/v1/* tu cache, ca khi mat mang);
// host bao `library.updated` khi co ban moi nen luoi tu lam moi ma khong mat bo loc / trang / model dang chon (state o PluginApp).
import { useEffect, useState, useCallback, useRef } from 'react';
import { isMaxHost, onHostEvent, getLibraryStatus } from './integrations/3dsmax/bridge.js';
import { buildCatalog } from './v3-catalog.js';

async function getJson(path, signal) {
  const r = await fetch(path, { signal, headers: { accept: 'application/json' } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error?.code || `HTTP ${r.status}`), { status: r.status, code: data?.error?.code });
  return data;
}

export const loadCatalog = async (signal) => {
  const [catalog, categories, manifest] = await Promise.all([
    getJson('/api/v1/catalog', signal),
    getJson('/api/v1/categories', signal),
    getJson('/api/v1/previews/manifest', signal)
  ]);
  return buildCatalog({ catalog, categories, manifest });
};

export const loadEntitlements = (signal) => getJson('/api/v1/me/entitlements', signal);

const MESSAGES = {
  SERVER_UNAVAILABLE: 'Chưa tải được catalog và chưa có bản lưu trên máy này. Kiểm tra Internet rồi bấm Làm mới.',
};

/** @returns {{products, tree, state:'loading'|'syncing_previews'|'ready'|'error', error:string, offline:boolean, progress:null|{done,total}, entitlements:undefined|null|object, enterLibrary:Function}} */
export function usePluginCatalog(reloadKey = 0) {
  const [data, setData] = useState({ products: [], tree: [] });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [progress, setProgress] = useState(null);
  const [entitlements, setEntitlements] = useState(undefined);
  const [tick, setTick] = useState(0);
  const wasOffline = useRef(false);
  const max = isMaxHost();

  const enterLibrary = useCallback(() => {
    setState('ready');
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const { signal } = controller;

    async function run() {
      try {
        setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
        const next = await loadCatalog(signal);
        if (!active || signal.aborted) return;
        setData(next);

        if (max) {
          try {
            const status = await getLibraryStatus();
            if (active && !signal.aborted) {
              if (status && status.previewTotal > 0 && !status.previewsSynced) {
                setProgress({ done: status.previewDone || 0, total: status.previewTotal });
                setState('syncing_previews');
              } else {
                setState('ready');
                setError('');
              }
            }
          } catch {
            if (active && !signal.aborted) {
              setState('ready');
              setError('');
            }
          }
        } else {
          setState('ready');
          setError('');
        }
      } catch (e) {
        if (!active || signal.aborted) return;
        setState((previous) => (previous === 'ready' ? previous : 'error'));
        setError(MESSAGES[e.code] || 'Không tải được catalog. Bấm Làm mới để thử lại.');
      }
    }

    run();

    if (max) {
      loadEntitlements(signal).then(
        (value) => { if (active && !signal.aborted) setEntitlements(value); },
        () => { if (active && !signal.aborted) setEntitlements(null); }
      );
    } else {
      setEntitlements(null);
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, tick, max]);

  useEffect(() => {
    const offs = [
      onHostEvent('library.updated', () => setTick((n) => n + 1)),
      onHostEvent('library.offline', (d) => {
        const next = Boolean(d?.offline);
        if (wasOffline.current && !next) setTick((n) => n + 1);
        wasOffline.current = next;
        setOffline(next);
      }),
      onHostEvent('library.previewProgress', (d) => {
        if (!d) return;
        const done = d.done ?? 0;
        const total = d.total ?? 0;
        const synced = Boolean(d.previewsSynced || (total > 0 && done >= total));
        if (!synced && total > 0) {
          setProgress({ done, total });
          setState((prev) => (prev === 'ready' ? prev : 'syncing_previews'));
        } else {
          setProgress(null);
          setState('ready');
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return { ...data, state, error, offline, progress, entitlements, enterLibrary };
}
