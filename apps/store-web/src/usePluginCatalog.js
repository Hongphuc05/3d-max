// P4.4: catalog cho plugin 3ds Max. Du lieu den tu ban sao cuc bo ma host giu (host tra loi /api/v1/* tu cache, ca khi mat mang);
// host bao `library.updated` khi co ban moi nen luoi tu lam moi ma khong mat bo loc / trang / model dang chon (state o PluginApp).
import { useEffect, useState } from 'react';
import { isMaxHost, onHostEvent } from './integrations/3dsmax/bridge.js';
import { buildCatalog } from './v3-catalog.js';

async function getJson(path, signal) {
  const r = await fetch(path, { signal, headers: { accept: 'application/json' } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error?.code || `HTTP ${r.status}`), { status: r.status, code: data?.error?.code });
  return data;
}
export const loadCatalog = async (signal) => {
  const [catalog, categories, manifest] = await Promise.all([
    getJson('/api/v1/catalog', signal), getJson('/api/v1/categories', signal), getJson('/api/v1/previews/manifest', signal)]);
  return buildCatalog({ catalog, categories, manifest });
};
export const loadEntitlements = (signal) => getJson('/api/v1/me/entitlements', signal);

const MESSAGES = {
  SERVER_UNAVAILABLE: 'Chưa tải được catalog và chưa có bản lưu trên máy này. Kiểm tra Internet rồi bấm Làm mới.',
};

/** @returns {{products, tree, state:'loading'|'ready'|'error', error:string, offline:boolean, progress:null|{done,total}, entitlements:undefined|null|object}} */
export function usePluginCatalog(reloadKey = 0) {
  const [data, setData] = useState({ products: [], tree: [] });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [progress, setProgress] = useState(null);
  const [entitlements, setEntitlements] = useState(undefined);
  const [tick, setTick] = useState(0);
  const max = isMaxHost();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadCatalog(signal).then((next) => { if (signal.aborted) return; setData(next); setState('ready'); setError(''); },
      (e) => {
        if (signal.aborted) return;
        // Da co du lieu thi giu nguyen (khong xoa luoi vi mot lan loi); chua co thi bao loi.
        setState((previous) => (previous === 'ready' ? previous : 'error'));
        setError(MESSAGES[e.code] || 'Không tải được catalog. Bấm Làm mới để thử lại.');
      });
    if (max) loadEntitlements(signal).then((value) => { if (!signal.aborted) setEntitlements(value); }, () => { if (!signal.aborted) setEntitlements(null); });
    else setEntitlements(null);
    return () => controller.abort();
  }, [reloadKey, tick, max]);

  useEffect(() => {
    const offs = [
      onHostEvent('library.updated', () => setTick((n) => n + 1)),
      onHostEvent('library.offline', (d) => setOffline(Boolean(d?.offline))),
      onHostEvent('library.previewProgress', (d) => setProgress(d && d.done < d.total ? { done: d.done, total: d.total } : null)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return { ...data, state, error, offline, progress, entitlements };
}
