import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from './validate-catalog.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const item = () => ({ id: 'chair-01', name: 'Chair', category: 'Seating', preview: 'previews/chair.jpg', driveFileId: 'test_file_id_123', fileName: 'chair.zip', sha256: 'a'.repeat(64), entryFile: 'chair/scene.max' });
test('accepts an empty catalog and a complete model', () => {
  assert.doesNotThrow(() => validateCatalog({ version: 1, items: [] }));
  assert.doesNotThrow(() => validateCatalog({ version: 1, items: [item()] }));
});
test('rejects unsupported versions, duplicate IDs and placeholder downloads', () => {
  for (const catalog of [{ version: 2, items: [] }, { version: 1, items: [item(), { ...item(), id: 'CHAIR-01' }] }, { version: 1, items: [{ ...item(), driveFileId: '<FILE_ID>' }] }]) assert.throws(() => validateCatalog(catalog));
});
test('rejects path escapes, remote previews, missing hashes and unsupported files', () => {
  for (const change of [{ preview: '../x.png' }, { preview: 'https://example.com/x.png' }, { preview: 'previews/%2e.png' }, { fileName: '../x.zip' }, { fileName: 'x.exe' }, { sha256: '' }, { entryFile: '../x.max' }, { entryFile: 'x.ms' }, { id: 'x/y' }]) assert.throws(() => validateCatalog({ version: 1, items: [{ ...item(), ...change }] }));
});
test('rejects Windows-incompatible path segments before publication', () => {
  for (const change of [{ preview: 'previews/CON.png' }, { preview: 'previews/invalid"name.png' }, { entryFile: 'folder./scene.max' }, { fileName: 'COM1.zip' }])
    assert.throws(() => validateCatalog({ version: 1, items: [{ ...item(), ...change }] }));
});
test('publication validates preview existence and rejects placeholders', () => {
  assert.throws(() => validateCatalog({ version: 1, items: [item()] }, { previewExists: () => false }));
  assert.throws(() => validateCatalog({ version: 1, items: [{ ...item(), driveFileId: 'REPLACE_WITH_DRIVE_FILE_ID' }] }));
});
test('CLI validates the production catalog before publication', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), fileURLToPath(new URL('./public/catalog.json', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated \d+ models/);
});
test('CLI rejects previews beyond the native 2 MiB limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'library-catalog-'));
  try {
    mkdirSync(join(root, 'previews'));
    writeFileSync(join(root, 'previews', 'chair.jpg'), Buffer.alloc(2 * 1024 * 1024 + 1));
    writeFileSync(join(root, 'catalog.json'), JSON.stringify({ version: 1, items: [item()] }));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), join(root, 'catalog.json')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('CLI rejects an image extension with invalid image bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'library-catalog-'));
  try {
    mkdirSync(join(root, 'previews'));
    writeFileSync(join(root, 'previews', 'chair.jpg'), 'not an image');
    writeFileSync(join(root, 'catalog.json'), JSON.stringify({ version: 1, items: [item()] }));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), join(root, 'catalog.json')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
