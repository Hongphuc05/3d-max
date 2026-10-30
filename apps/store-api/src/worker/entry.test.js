import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Entry points must refuse to start on bad configuration, say WHICH variable is wrong, and never print its value.
const root = path.resolve(import.meta.dirname, '../..');
const run = (file, env, args = []) => spawnSync(process.execPath, [path.join(root, file), ...args], {
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: 'postgres://nobody:nopass@127.0.0.1:1/none', ...env },
  encoding: 'utf8', timeout: 20_000,
});
const SECRET = 'not a valid key and a secret tail 12345';

test('worker.js: a malformed API key stops the worker (exit 1) naming only the variable', () => {
  const r = run('src/worker.js', { DRIVE_API_KEY: SECRET });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DRIVE_API_KEY/);
  assert.ok(!r.stdout.includes('secret') && !r.stderr.includes('secret') && !r.stderr.includes('12345'), 'the value must not be echoed');
});

test('worker.js: missing DATABASE_URL stops before anything else', () => {
  const r = run('src/worker.js', { DRIVE_API_KEY: 'AIzaSyEntryKey_0123456789-abcdefghijk', DATABASE_URL: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DATABASE_URL/);
});

test('drive-sync.js: bad configuration exits 1 without touching the database or echoing the key; a missing folder argument is explained', () => {
  const bad = run('scripts/drive-sync.js', { DRIVE_API_KEY: SECRET }, ['someFolderId1234567']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /DRIVE_API_KEY/);
  assert.ok(!bad.stderr.includes('12345') && !bad.stdout.includes('12345'));
  const noArg = run('scripts/drive-sync.js', { DRIVE_API_KEY: 'AIzaSyEntryKey_0123456789-abcdefghijk' });
  assert.equal(noArg.status, 1);
  assert.match(noArg.stderr, /rootFolderId|usage/i);
});
