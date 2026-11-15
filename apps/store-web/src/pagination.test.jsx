import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, pageWindow } from './Pagination.jsx';

test('pageWindow: first 3, last 3 and current +-1; a single hidden page is shown instead of an ellipsis', () => {
  assert.deepEqual(pageWindow(1, 10), [1, 2, 3, '…', 8, 9, 10]);
  assert.deepEqual(pageWindow(5, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'page 7 is the only hidden one: shown, no ellipsis');
  assert.deepEqual(pageWindow(5, 12), [1, 2, 3, 4, 5, 6, '…', 10, 11, 12]);
  assert.deepEqual(pageWindow(10, 10), [1, 2, 3, '…', 8, 9, 10]);
  assert.deepEqual(pageWindow(1, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(7, 20), [1, 2, 3, '…', 6, 7, 8, '…', 18, 19, 20]);
});

test('Pagination: centered bar with the page dropdown showing the current page', () => {
  const html = renderToStaticMarkup(<Pagination page={3} pages={10} total={300} onPage={() => {}} />);
  assert.match(html, /justify-center/);
  assert.match(html, /<select[^>]*aria-label="Nhập số trang"/);
  assert.equal((html.match(/<option/g) || []).length, 10);
  assert.match(html, /<option value="3" selected/);
  assert.match(html, /aria-current="page"/);
});
