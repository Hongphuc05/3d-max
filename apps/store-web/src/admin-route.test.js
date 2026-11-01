import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminPath } from './admin-route.js';

test('only /admin and its sub-paths are the admin route', () => {
  for (const ok of ['/admin', '/admin/', '/admin/drive']) assert.equal(isAdminPath(ok), true, ok);
  for (const no of ['/', '/administrator', '/admin-x', '/x/admin', '/Admin', '', undefined, null]) assert.equal(isAdminPath(no), false, String(no));
});
