import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('admin shows license controls and no catalog refresh controls', () => {
  assert.match(page, /id="login-form"/);
  assert.match(page, /id="license-form"/);
  assert.doesNotMatch(page, /id="scan-button"|id="refresh-status"|GOOGLE DRIVE → GITHUB PAGES/);
  assert.doesNotMatch(app, /catalog-scan|catalog-status|refreshRuns/);
});

test('catalog API routes and publishing workflow are absent', async () => {
  for (const path of ['../api/catalog-scan.js', '../api/catalog-status.js', '../../../.github/workflows/weekly-drive-catalog.yml']) {
    await assert.rejects(access(new URL(path, import.meta.url)), { code: 'ENOENT' });
  }
});
