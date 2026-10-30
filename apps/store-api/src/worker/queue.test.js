import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, q;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_queue');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
});
after(async () => { if (dispose) await dispose(pool); });

const newSource = async () => (await pool.query(
  "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'root','MY_DRIVE') returning id",
  [`root${randomBytes(8).toString('hex')}`])).rows[0].id;
const job = id => pool.query('select * from drive_sync_jobs where id=$1', [id]).then(r => r.rows[0]);
const expireLease = id => pool.query("update drive_sync_jobs set lease_expires_at = now() - interval '1 second' where id=$1", [id]);
const clear = () => pool.query('delete from drive_sync_jobs');

test('enqueueJob: creates a QUEUED job; a second active job for the same source is SYNC_ALREADY_RUNNING (409)', { skip }, async () => {
  await clear();
  const s = await newSource(), other = await newSource();
  const j = await q.enqueueJob(pool, { sourceId: s, mode: 'FULL' });
  assert.equal((await job(j.id)).status, 'QUEUED');
  await assert.rejects(q.enqueueJob(pool, { sourceId: s, mode: 'INCREMENTAL' }), e => e.code === 'SYNC_ALREADY_RUNNING' && e.status === 409);
  await q.enqueueJob(pool, { sourceId: other, mode: 'FULL' }); // independent source
  await assert.rejects(q.enqueueJob(pool, { sourceId: s, mode: 'SOMETIMES' }), e => e.code === 'INVALID_PARAMS');
});

test('claimJob: oldest QUEUED first, sets lease/owner/attempt/started_at, null when nothing to do', { skip }, async () => {
  await clear();
  assert.equal(await q.claimJob(pool, 'w1'), null);
  const a = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const b = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const got = await q.claimJob(pool, 'w1', { leaseMs: 60_000 });
  assert.equal(got.id, a.id, 'FIFO');
  assert.deepEqual([got.status, got.lease_owner, got.attempt, got.stage], ['RUNNING', 'w1', 1, 'SCANNING']);
  assert.ok(got.started_at && got.heartbeat_at);
  const ms = new Date(got.lease_expires_at) - Date.now();
  assert.ok(ms > 50_000 && ms <= 60_500, `lease ~60s, got ${ms}`);
  assert.equal((await q.claimJob(pool, 'w2')).id, b.id);
  assert.equal(await q.claimJob(pool, 'w3'), null, 'RUNNING jobs with a live lease are not claimable');
});

test('claimJob: concurrent workers never share a job (1 job / 8 claimers, 3 jobs / 8 claimers)', { skip }, async () => {
  await clear();
  await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  let winners = (await Promise.all(Array.from({ length: 8 }, (_, i) => q.claimJob(pool, `w${i}`)))).filter(Boolean);
  assert.equal(winners.length, 1);

  await clear();
  for (let i = 0; i < 3; i++) await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  winners = (await Promise.all(Array.from({ length: 8 }, (_, i) => q.claimJob(pool, `w${i}`)))).filter(Boolean);
  assert.equal(winners.length, 3);
  assert.equal(new Set(winners.map(w => w.id)).size, 3, 'distinct jobs');
  assert.equal(new Set(winners.map(w => w.lease_owner)).size, 3, 'distinct owners');
});

test('crash recovery: an expired lease is taken over, checkpoint and started_at survive, attempt grows; the old worker is fenced out', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  const first = await q.claimJob(pool, 'dead');
  assert.equal(await q.saveProgress(pool, j.id, 'dead', { checkpoint: { stage: 'SCANNING', folderQueue: ['a', 'b'] }, counters: { scannedFiles: 42 } }), true);
  assert.equal(await q.claimJob(pool, 'taker'), null, 'lease still alive');

  await expireLease(j.id);
  const second = await q.claimJob(pool, 'taker');
  assert.equal(second.id, j.id);
  assert.deepEqual([second.lease_owner, second.attempt, second.scanned_files], ['taker', 2, 42]);
  assert.deepEqual(second.checkpoint, { stage: 'SCANNING', folderQueue: ['a', 'b'] });
  assert.equal(new Date(second.started_at).getTime(), new Date(first.started_at).getTime());

  // the dead worker wakes up: nothing it does may touch the job any more
  assert.equal(await q.heartbeat(pool, j.id, 'dead'), null);
  assert.equal(await q.saveProgress(pool, j.id, 'dead', { checkpoint: { stage: 'OLD' }, counters: { scannedFiles: 1 } }), false);
  assert.equal(await q.finishJob(pool, j.id, 'dead', { status: 'COMPLETED' }), false);
  assert.equal(await q.releaseJob(pool, j.id, 'dead'), false);
  const now = await job(j.id);
  assert.deepEqual([now.status, now.lease_owner, now.scanned_files, now.checkpoint.stage], ['RUNNING', 'taker', 42, 'SCANNING']);
});

test('heartbeat: extends the lease of the owner and reports a cancel request', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  await q.claimJob(pool, 'w1', { leaseMs: 1000 });
  const before = new Date((await job(j.id)).lease_expires_at);
  const hb = await q.heartbeat(pool, j.id, 'w1', { leaseMs: 60_000 });
  assert.deepEqual(hb, { cancelRequested: false });
  assert.ok(new Date((await job(j.id)).lease_expires_at) - before > 50_000);
  assert.equal(await q.heartbeat(pool, j.id, 'someone-else'), null);
  assert.equal(await q.cancelJob(pool, j.id), 'CANCELLING');
  assert.deepEqual(await q.heartbeat(pool, j.id, 'w1'), { cancelRequested: true });
});

test('saveProgress: only whitelisted counters, non-negative integers; stage is validated; unknown keys never reach SQL', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  await q.claimJob(pool, 'w1');
  assert.equal(await q.saveProgress(pool, j.id, 'w1', {
    stage: 'DOWNLOADING_PREVIEWS', bytesDownloaded: 5_000_000_000,
    counters: { scannedFolders: 3, scannedFiles: 9, newCount: 1, updatedCount: 2, unchangedCount: 3, missingCount: 4, reviewCount: 5, skippedCount: 6, errorCount: 7 },
  }), true);
  const r = await job(j.id);
  assert.deepEqual([r.stage, Number(r.bytes_downloaded), r.scanned_folders, r.scanned_files, r.new_count, r.updated_count, r.unchanged_count, r.missing_count, r.review_count, r.skipped_count, r.error_count],
    ['DOWNLOADING_PREVIEWS', 5_000_000_000, 3, 9, 1, 2, 3, 4, 5, 6, 7]);
  await assert.rejects(q.saveProgress(pool, j.id, 'w1', { counters: { 'status = \'COMPLETED\', scanned_files': 1 } }), /counter/i);
  await assert.rejects(q.saveProgress(pool, j.id, 'w1', { counters: { scannedFiles: -1 } }), /counter/i);
  await assert.rejects(q.saveProgress(pool, j.id, 'w1', { counters: { scannedFiles: 1.5 } }), /counter/i);
  await assert.rejects(q.saveProgress(pool, j.id, 'w1', { stage: 'DANCING' }), /stage/i);
  assert.equal((await job(j.id)).status, 'RUNNING');
});

test('finishJob: terminal status + finished_at, lease cleared, the source slot is free again; bad status / error code rejected', { skip }, async () => {
  await clear();
  const s = await newSource();
  const j = await q.enqueueJob(pool, { sourceId: s, mode: 'FULL' });
  await q.claimJob(pool, 'w1');
  await assert.rejects(q.finishJob(pool, j.id, 'w1', { status: 'RUNNING' }), /status/i);
  await assert.rejects(q.finishJob(pool, j.id, 'w1', { status: 'FAILED', errorCode: 'free text with a secret' }), /error code/i);
  assert.equal(await q.finishJob(pool, j.id, 'w1', { status: 'FAILED', errorCode: 'DISK_SPACE_LOW', errorMessage: 'Disk full' }), true);
  const r = await job(j.id);
  assert.deepEqual([r.status, r.error_code, r.error_message, r.lease_owner, r.lease_expires_at, r.stage], ['FAILED', 'DISK_SPACE_LOW', 'Disk full', null, null, null]);
  assert.ok(r.finished_at);
  assert.equal(await q.finishJob(pool, j.id, 'w1', { status: 'COMPLETED' }), false, 'already finished');
  await q.enqueueJob(pool, { sourceId: s, mode: 'FULL' }); // slot is free
});

test('releaseJob: graceful shutdown returns the job to QUEUED with its checkpoint, without burning an attempt', { skip }, async () => {
  await clear();
  const j = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  await q.claimJob(pool, 'w1');
  await q.saveProgress(pool, j.id, 'w1', { checkpoint: { stage: 'SCANNING', pageToken: 'p2' } });
  assert.equal(await q.releaseJob(pool, j.id, 'w1'), true);
  const r = await job(j.id);
  assert.deepEqual([r.status, r.lease_owner, r.attempt, r.checkpoint.pageToken], ['QUEUED', null, 0, 'p2']);
  const again = await q.claimJob(pool, 'w2');
  assert.deepEqual([again.id, again.attempt, again.checkpoint.pageToken], [j.id, 1, 'p2']);
});

test('cancelJob: QUEUED -> CANCELLED at once; RUNNING -> CANCELLING; finished -> false; a CANCELLING job whose worker died ends CANCELLED', { skip }, async () => {
  await clear();
  const queued = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  assert.equal(await q.cancelJob(pool, queued.id), 'CANCELLED');
  assert.ok((await job(queued.id)).finished_at);
  assert.equal(await q.cancelJob(pool, queued.id), false, 'already cancelled');

  const running = await q.enqueueJob(pool, { sourceId: await newSource(), mode: 'FULL' });
  await q.claimJob(pool, 'w1');
  assert.equal(await q.cancelJob(pool, running.id), 'CANCELLING');
  assert.equal((await job(running.id)).cancel_requested, true);
  assert.equal(await q.cancelJob(pool, running.id), 'CANCELLING', 'idempotent');
  assert.equal(await q.claimJob(pool, 'w2'), null, 'a CANCELLING job is never handed to another worker while alive');

  await expireLease(running.id); // worker died while cancelling
  assert.equal(await q.claimJob(pool, 'w2'), null);
  assert.equal((await job(running.id)).status, 'CANCELLED');
  assert.equal(await q.cancelJob(pool, randomUuidLike()), false, 'unknown job');
});
const randomUuidLike = () => '00000000-0000-4000-8000-000000000000';

test('poison job: after MAX_ATTEMPTS expired leases it is FAILED (JOB_ATTEMPTS_EXCEEDED), not retried forever', { skip }, async () => {
  await clear();
  const s = await newSource();
  const j = await q.enqueueJob(pool, { sourceId: s, mode: 'FULL' });
  for (let i = 1; i <= q.MAX_ATTEMPTS; i++) {
    const got = await q.claimJob(pool, `w${i}`);
    assert.equal(got.id, j.id, `attempt ${i}`);
    await expireLease(j.id);
  }
  assert.equal(await q.claimJob(pool, 'next'), null);
  const r = await job(j.id);
  assert.deepEqual([r.status, r.error_code, r.attempt], ['FAILED', 'JOB_ATTEMPTS_EXCEEDED', q.MAX_ATTEMPTS]);
  assert.ok(r.finished_at);
  await q.enqueueJob(pool, { sourceId: s, mode: 'FULL' }); // slot freed, admin can retry
});
