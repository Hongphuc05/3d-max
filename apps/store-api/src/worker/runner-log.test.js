import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from './runner.js';

// No database needed: the pool is a stub whose every query fails, like a down or misconfigured Postgres.
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function logsFor(error) {
  const logged = mock.method(console, 'error', () => {});
  const ac = new AbortController();
  try {
    const done = runWorker({ pool: { query: async () => { throw error; } }, signal: ac.signal, handler: async () => ({}), pollMs: 10 }); // no onError: the default logger
    for (let i = 0; i < 100 && !logged.mock.callCount(); i++) await sleep(10);
    ac.abort(); await done;
    return logged.mock.calls.map(c => c.arguments.join(' ')).join('\n');
  } finally { logged.mock.restore(); }
}

test('default error log shows the error CODE (ops can tell "connection refused" from "missing table") but never the message', async () => {
  const refused = await logsFor(Object.assign(new Error('password=hunter2 refused'), { code: 'ECONNREFUSED' }));
  assert.match(refused, /ECONNREFUSED/);
  const missingTable = await logsFor(Object.assign(new Error('relation "drive_sync_jobs" does not exist'), { name: 'error', code: '42P01' }));
  assert.match(missingTable, /42P01/);
  for (const text of [refused, missingTable]) assert.ok(!/hunter2|password|drive_sync_jobs/.test(text), 'the message may carry secrets or SQL');
});

test('an error without a code still logs its name (and nothing else)', async () => {
  const text = await logsFor(new TypeError('secret detail'));
  assert.match(text, /TypeError/);
  assert.ok(!text.includes('secret'));
});
