import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.chrome = undefined;

const { createRoot } = await import('react-dom/client');
const { Card } = await import('./components.jsx');
const container = document.getElementById('root');
let root;

async function renderCard(status) {
  root = createRoot(container);
  const product = {
    slug: 'catalog-fixture',
    name: 'Catalog fixture',
    status,
    downloadable: status === 'ready',
    thumb: null,
    subcategory: 'Furniture/Sofa',
    info: { renderers: [], sizeMB: 1 },
  };
  await act(async () => root.render(<Card p={product} active={false} onOpen={() => {}} onLogin={() => {}} />));
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.replaceChildren();
});

after(() => dom.window.close());

for (const [status, label] of [
  ['missing_preview', 'Thiếu ảnh preview'],
  ['missing_archive', 'Thiếu file archive'],
  ['conflict', 'Cần kiểm tra file trùng'],
]) {
  test(`browser catalog card shows the ${status} availability`, async () => {
    await renderCard(status);
    assert.equal(container.querySelector('[role="status"]')?.textContent, label);
    assert.equal(container.textContent.includes('Trong license Lifetime'), false);
  });
}

test('ready browser catalog card keeps the Lifetime label without an unavailable status', async () => {
  await renderCard('ready');
  assert.equal(container.querySelector('[role="status"]'), null);
  assert.match(container.textContent, /Trong license Lifetime/);
});
