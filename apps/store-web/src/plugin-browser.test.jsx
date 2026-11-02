// P4.4: ngoai 3ds Max (trinh duyet thuong) khong co thiet bi: khong duoc goi /me/entitlements, quyen = null, nut chi de xem.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { usePluginCatalog } = await import('./usePluginCatalog.js');
const json = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
const requests = [];
const original = globalThis.fetch;
globalThis.fetch = async (url) => {
  requests.push(String(url));
  if (String(url) === '/api/v1/catalog') return json({ catalogVersion: 1, models: [] });
  if (String(url) === '/api/v1/categories') return json([]);
  return json({ catalogVersion: 1, previews: [] });
};
after(() => { globalThis.fetch = original; dom.window.close(); });
let snap, key = 0;
function Probe({ k }) { snap = usePluginCatalog(k); return null; }
const flush = () => new Promise((r) => setTimeout(r, 15));

test('in a plain browser the device rights are never requested and are null; changing reloadKey fetches the catalog again', async () => {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<Probe k={key} />); await flush(); });
  await act(flush);
  assert.equal(snap.state, 'ready'); assert.equal(snap.entitlements, null);
  assert.ok(!requests.some((r) => r.includes('entitlements')), 'no /me/entitlements outside 3ds Max');
  const before = requests.filter((r) => r === '/api/v1/catalog').length;
  await act(async () => { root.render(<Probe k={1} />); await flush(); });
  await act(flush);
  assert.equal(requests.filter((r) => r === '/api/v1/catalog').length, before + 1, 'the refresh button (reloadKey) reloads the catalog');
  await act(() => root.unmount());
});
