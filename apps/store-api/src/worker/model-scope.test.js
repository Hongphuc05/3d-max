import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER, SHORTCUT } from '../drive/client.js';
import { resolveModelScope } from './model-scope.js';

const source = { root_folder_id: 'LibraryRoot0001', root_folder_name: '3DSMOOD', root_resource_key: 'root-key' };
test('model scope finds the wrapper across pagination, ignores scene branch and keeps resource key', async () => {
  const calls = [];
  const client = { async listChildren(id, options) {
    calls.push([id, options.pageToken, options.resourceKey]);
    return options.pageToken ? { files: [{ id: 'ModelsFolder001', name: '3DMODELS', mimeType: FOLDER, resourceKey: 'models-key' }] }
      : { files: [{ id: 'ScenesFolder001', name: '3DSCENES', mimeType: FOLDER }], nextPageToken: 'page2' };
  } };
  assert.deepEqual(await resolveModelScope(client, source), { id: 'ModelsFolder001', resourceKey: 'models-key' });
  assert.deepEqual(calls, [[source.root_folder_id, undefined, 'root-key'], [source.root_folder_id, 'page2', 'root-key']]);
});
test('missing or duplicate wrapper fails instead of scanning 3DSCENES', async () => {
  await assert.rejects(resolveModelScope({ listChildren: async () => ({ files: [] }) }, source), { code: 'DRIVE_MODELS_FOLDER_NOT_FOUND' });
  await assert.rejects(resolveModelScope({ listChildren: async () => ({ files: [1, 2].map(i => ({ id: `ModelsFolder00${i}`, name: '3DMODELS', mimeType: FOLDER })) }) }, source), { code: 'DRIVE_MODELS_FOLDER_AMBIGUOUS' });
});
test('direct 3DMODELS and legacy category sources use their current root without extra Drive calls', async () => {
  const client = { listChildren() { throw new Error('Unexpected Drive call'); } };
  for (const name of ['3DMODELS', 'Furniture'])
    assert.deepEqual(await resolveModelScope(client, { ...source, root_folder_name: name }), { id: source.root_folder_id, resourceKey: 'root-key' });
});
test('a model-folder shortcut resolves to its target; cyclic pagination is rejected', async () => {
  const client = { listChildren: async () => ({ files: [{ id: 'ShortcutModel01', name: '3DMODELS', mimeType: SHORTCUT,
    shortcutDetails: { targetId: 'ModelsFolder001', targetMimeType: FOLDER, targetResourceKey: 'target-key' } }] }) };
  assert.deepEqual(await resolveModelScope(client, source), { id: 'ModelsFolder001', resourceKey: 'target-key' });
  await assert.rejects(resolveModelScope({ listChildren: async () => ({ files: [], nextPageToken: 'loop' }) }, source), { code: 'DRIVE_UPSTREAM_ERROR' });
});
