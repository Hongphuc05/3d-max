import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadWorkerConfig } from './config.js';

const KEY = 'AIzaSyConfigKey_0123456789-abcdefghijk';
const ok = { DRIVE_API_KEY: KEY, STORAGE_DIR: path.resolve('/tmp/storage-x') };

test('defaults: preview dir under STORAGE_DIR/previews-v3, 2 GiB free-disk floor, 15000 VND default price', () => {
  const c = loadWorkerConfig(ok);
  assert.deepEqual(c.errors, []);
  assert.deepEqual([c.previewDir, c.minFreeDiskBytes, c.defaultPriceVnd, c.apiKey], [path.join(ok.STORAGE_DIR, 'previews-v3'), 2 * 1024 ** 3, 15000, KEY]);
});

test('explicit values are honoured (PREVIEW_DIR wins over STORAGE_DIR)', () => {
  const c = loadWorkerConfig({ ...ok, PREVIEW_DIR: '/data/p', MIN_FREE_DISK_BYTES: '5000', DEFAULT_MODEL_PRICE_VND: '20000' });
  assert.deepEqual([c.errors, c.previewDir, c.minFreeDiskBytes, c.defaultPriceVnd], [[], path.resolve('/data/p'), 5000, 20000]);
});

test('invalid configuration is reported by VARIABLE NAME only; no value (above all the API key) is ever echoed', () => {
  const bad = loadWorkerConfig({ DRIVE_API_KEY: 'bad key with spaces and a secret-ish tail', MIN_FREE_DISK_BYTES: '-1', DEFAULT_MODEL_PRICE_VND: '1.5' });
  assert.deepEqual(bad.errors.sort(), ['DEFAULT_MODEL_PRICE_VND', 'DRIVE_API_KEY', 'MIN_FREE_DISK_BYTES']);
  assert.ok(!JSON.stringify(bad).includes('secret-ish'));
  assert.equal(bad.apiKey, undefined, 'a malformed key is not carried around');
  assert.deepEqual(loadWorkerConfig({}).errors, ['DRIVE_API_KEY']);
  for (const price of ['', 'abc', '-5', '1e3']) assert.ok(loadWorkerConfig({ ...ok, DEFAULT_MODEL_PRICE_VND: price || 'x' }).errors.includes('DEFAULT_MODEL_PRICE_VND'), price);
});

test('PREVIEW_DELAY_MS and PREVIEW_CONCURRENCY: slow defaults, bad values rejected by name', () => {
  const d = loadWorkerConfig(ok);
  assert.equal(d.previewDelayMs, 1500); assert.equal(d.previewConcurrency, 1);
  assert.equal(loadWorkerConfig({ ...ok, PREVIEW_DELAY_MS: '0', PREVIEW_CONCURRENCY: '2' }).previewDelayMs, 0);
  assert.deepEqual(loadWorkerConfig({ ...ok, PREVIEW_DELAY_MS: 'x', PREVIEW_CONCURRENCY: '0' }).errors.sort(), ['PREVIEW_CONCURRENCY', 'PREVIEW_DELAY_MS']);
});
