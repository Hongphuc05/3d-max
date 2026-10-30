import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, q, runWorker;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_runner');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  ({ runWorker } = await import('./runner.js'));
});
after(async () => { if (dispose) await dispose(pool); });

const newSource = async () => (await pool.query(
  "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'root','MY_DRIVE') returning id",
  [`root${randomBytes(8).toString('hex')}`])).rows[0].id;
const job = id => pool.query('select * from drive_sync_jobs where id=$1', [id]).then(r => r.rows[0]);
const clear = () => pool.query('delete from drive_sync_jobs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(10); } return false; };
const FAST = { pollMs: 15, leaseMs: 400, heartbeatMs: 25 };
const quiet = () => {};

test('runs the handler for a queued job and finishes it with the returned status; an idle worker stops promptly on abort', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  const seen = [];
  const done = runWorker({ pool, workerId: 'r1', signal: ac.signal, onError: quiet, ...FAST, handler: async (jb, ctx) => {
    seen.push([jb.id, jb.lease_owner]);
    await ctx.saveProgress({ counters: { scannedFiles: 7 } });
    return { status: 'COMPLETED_WITH_ERRORS' };
  } });
  assert.ok(await until(async () => (await job(j.id)).status === 'COMPLETED_WITH_ERRORS'));
  assert.deepEqual(seen, [[j.id, 'r1']]);
  assert.equal((await job(j.id)).scanned_files, 7);
  const t = Date.now(); ac.abort(); await done;
  assert.ok(Date.now() - t < 500, 'idle loop must not sleep through the abort');
});

test('a throwing handler FAILS the job with a generic code; the error text (maybe a secret) is never stored', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  const logged = [];
  const done = runWorker({ pool, workerId: 'r1', signal: ac.signal, onError: e => logged.push(e), ...FAST, handler: async () => { throw new Error('Bearer ya29.SECRET-TOKEN failed'); } });
  assert.ok(await until(async () => (await job(j.id)).status === 'FAILED'));
  ac.abort(); await done;
  const r = await job(j.id);
  assert.equal(r.error_code, 'JOB_HANDLER_ERROR');
  assert.ok(!JSON.stringify(r).includes('SECRET-TOKEN'), 'job row must not contain the error text');
  assert.equal(logged.length, 1);
});

test('crash recovery end to end: a job abandoned by a dead worker is resumed from its checkpoint by the next worker', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  await q.claimJob(pool, 'dead', { leaseMs: 50 });
  await q.saveProgress(pool, j.id, 'dead', { checkpoint: { stage: 'SCANNING', folderQueue: ['x'] }, counters: { scannedFiles: 10 } });
  await sleep(80); // lease of the dead worker expires
  const ac = new AbortController();
  let resumed;
  const done = runWorker({ pool, workerId: 'alive', signal: ac.signal, onError: quiet, ...FAST, handler: async jb => { resumed = jb; return { status: 'COMPLETED' }; } });
  assert.ok(await until(async () => (await job(j.id)).status === 'COMPLETED'));
  ac.abort(); await done;
  assert.deepEqual([resumed.checkpoint.folderQueue, resumed.attempt, resumed.scanned_files], [['x'], 2, 10]);
});

test('lost lease: the handler is aborted and the runner writes NOTHING (the new owner keeps the job)', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  let aborted = false;
  const done = runWorker({ pool, workerId: 'slow', signal: ac.signal, onError: quiet, pollMs: 15, leaseMs: 300, heartbeatMs: 25, handler: async (jb, ctx) => {
    // steal the job: expire the lease between two heartbeats, another worker takes it
    await pool.query("update drive_sync_jobs set lease_expires_at = now() - interval '1 second' where id=$1", [jb.id]);
    assert.ok(await q.claimJob(pool, 'thief'));
    await new Promise(r => ctx.signal.addEventListener('abort', r, { once: true }));
    aborted = true;
    return { status: 'COMPLETED' }; // must be ignored
  } });
  assert.ok(await until(() => aborted));
  await sleep(50);
  const r = await job(j.id);
  assert.deepEqual([r.status, r.lease_owner], ['RUNNING', 'thief']);
  ac.abort(); await done;
});

test('shutdown (SIGTERM): the handler is told to stop, saves its checkpoint, and the job goes back to QUEUED untouched by attempts', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  let started;
  const running = new Promise(r => { started = r; });
  const done = runWorker({ pool, workerId: 'r1', signal: ac.signal, onError: quiet, ...FAST, handler: async (jb, ctx) => {
    started();
    await new Promise(r => ctx.signal.addEventListener('abort', r, { once: true }));
    assert.equal(ctx.shuttingDown, true);
    await ctx.saveProgress({ checkpoint: { stage: 'SCANNING', pageToken: 'next' } });
    return { interrupted: true };
  } });
  await running; ac.abort(); await done;
  const r = await job(j.id);
  assert.deepEqual([r.status, r.lease_owner, r.attempt, r.checkpoint.pageToken], ['QUEUED', null, 0, 'next']);
});

test('cancel: the heartbeat surfaces the request, the handler stops at a safe point, the job ends CANCELLED', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  const done = runWorker({ pool, workerId: 'r1', signal: ac.signal, onError: quiet, ...FAST, handler: async (jb, ctx) => {
    while (!ctx.cancelled) await sleep(10);
    return { status: 'CANCELLED' };
  } });
  assert.ok(await until(async () => (await job(j.id)).status === 'RUNNING'));
  assert.equal(await q.cancelJob(pool, j.id), 'CANCELLING');
  assert.ok(await until(async () => (await job(j.id)).status === 'CANCELLED'));
  ac.abort(); await done;
  assert.ok((await job(j.id)).finished_at);
});

test('cancel wins even if the handler returns COMPLETED after the request', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const ac = new AbortController();
  const done = runWorker({ pool, workerId: 'r1', signal: ac.signal, onError: quiet, ...FAST, handler: async (jb, ctx) => {
    while (!ctx.cancelled) await sleep(10);
    return { status: 'COMPLETED' };
  } });
  assert.ok(await until(async () => (await job(j.id)).status === 'RUNNING'));
  await q.cancelJob(pool, j.id);
  assert.ok(await until(async () => (await job(j.id)).status === 'CANCELLED'));
  ac.abort(); await done;
});
