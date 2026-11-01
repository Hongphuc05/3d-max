// Admin API luot dong bo tren PostgreSQL that. Dung requireAdmin that, auth gia.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, server, base, adminId, userId, sourceId, q;

const j = (path, { method = 'GET', body, user = 'admin' } = {}) => fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('sync_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('../worker/queue.js');
  for (const k of ['adminId', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else userId = id;
  }
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','syncRoutesRoot01','root','MY_DRIVE') returning id")).rows[0].id;
  const { createSyncJobsRouter } = await import('./sync-routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  const { v3ErrorHandler, requestId } = await import('./errors.js');
  const app = express();
  app.use('/api/admin/drive', requestId, (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
  }, requireAdmin, createSyncJobsRouter({ pool, pollMs: 40, maxStreams: 2 }), v3ErrorHandler);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/admin/drive`;
});
after(async () => { if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } if (dispose) await dispose(pool); });
beforeEach(async () => { if (configured) await pool.query('delete from drive_sync_jobs'); });

test('guards: anonymous 401, ordinary user 403, and nothing is queued', { skip }, async () => {
  for (const user of [null, 'user']) {
    const r = await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' }, user });
    assert.equal(r.status, user ? 403 : 401);
  }
  assert.equal((await pool.query('select count(*)::int n from drive_sync_jobs')).rows[0].n, 0);
  assert.equal((await j('/sync-jobs', { user: 'user' })).status, 403);
});

test('POST queues a job (202), a second one is 409, bad input is 400 and queues nothing', { skip }, async () => {
  const ok = await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } });
  assert.equal(ok.status, 202);
  const { jobId } = await ok.json();
  const row = (await pool.query('select status, requested_by from drive_sync_jobs where id=$1', [jobId])).rows[0];
  assert.equal(row.status, 'QUEUED'); assert.equal(row.requested_by, adminId);

  const dup = await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } });
  assert.equal(dup.status, 409); assert.equal((await dup.json()).error.code, 'SYNC_ALREADY_RUNNING');

  await pool.query('delete from drive_sync_jobs');
  for (const body of [{}, { sourceId, mode: 'WRONG' }, { sourceId: 'not-a-uuid', mode: 'FULL' }, { sourceId: randomUUID(), mode: 'FULL' }, { sourceId, mode: 'FULL', extra: 1 }, []]) {
    assert.equal((await j('/sync-jobs', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  await pool.query('update drive_sources set enabled=false where id=$1', [sourceId]);
  assert.equal((await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).status, 400, 'disabled source');
  await pool.query('update drive_sources set enabled=true where id=$1', [sourceId]);
  assert.equal((await pool.query('select count(*)::int n from drive_sync_jobs')).rows[0].n, 0);
});

test('job view exposes counters only: no checkpoint, lease owner, requester or Drive IDs', { skip }, async () => {
  const { jobId } = await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json();
  await pool.query("update drive_sync_jobs set checkpoint='{\"secret\":\"CHECKPOINT-SECRET\"}', lease_owner='worker-x', scanned_files=7, bytes_downloaded=123 where id=$1", [jobId]);
  const text = await (await j(`/sync-jobs/${jobId}`)).text();
  assert.ok(!/CHECKPOINT-SECRET|worker-x|syncRoutesRoot01|checkpoint|lease|requestedBy|requested_by/i.test(text), text);
  const job = JSON.parse(text);
  assert.equal(job.counters.scannedFiles, 7); assert.equal(job.bytesDownloaded, 123); assert.equal(job.status, 'QUEUED');
  assert.equal((await j(`/sync-jobs/${randomUUID()}`)).status, 422);
  assert.equal((await j('/sync-jobs/not-a-uuid')).status, 422);
});

test('history pages newest first with a stable cursor; bad cursor is 400', { skip }, async () => {
  for (let i = 0; i < 5; i++) {
    await pool.query("insert into drive_sync_jobs(source_id,mode,status,created_at,finished_at) values($1,'FULL','COMPLETED', now() - ($2 * interval '1 minute'), now())", [sourceId, i]);
  }
  const seen = []; let cursor = null;
  for (let page = 0; page < 5; page++) {
    const r = await (await j(`/sync-jobs?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json();
    seen.push(...r.items.map((x) => x.id)); cursor = r.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen.length, 5); assert.equal(new Set(seen).size, 5, 'no duplicates or gaps');
  const all = (await pool.query('select id from drive_sync_jobs order by created_at desc, id desc')).rows.map((r) => r.id);
  assert.deepEqual(seen, all);
  assert.equal((await j('/sync-jobs?cursor=junk')).status, 400);
  assert.equal((await (await j('/sync-jobs?limit=9999')).json()).items.length, 5);
});

test('errors: failed files show name + path, never the Drive ID', { skip }, async () => {
  const { jobId } = await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json();
  await pool.query("insert into drive_inventory(source_id,drive_file_id,path,filename,mime_type) values($1,'DRIVEIDSECRET01','Living/Sofa/a.jpg','a.jpg','image/jpeg')", [sourceId]);
  await pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status,error_code) values($1,'DRIVEIDSECRET01','PREVIEW','FAILED','PREVIEW_INVALID'), ($1,'GONEFROMINV0001','PREVIEW','FAILED','PREVIEW_TOO_LARGE'), ($1,'OKFILE000000001','PREVIEW','DONE',null)", [jobId]);
  const text = await (await j(`/sync-jobs/${jobId}/items?status=FAILED`)).text();
  assert.ok(!/DRIVEIDSECRET01|GONEFROMINV0001/.test(text), 'Drive ID leaked');
  const items = JSON.parse(text);
  assert.ok(Array.isArray(items), 'plan 2.2: a plain array');
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => Object.keys(i).sort().join() === 'action,driveFileName,errorCode,errorMessage,path,status'), 'exact plan fields');
  assert.ok(items.some((i) => i.driveFileName === 'a.jpg' && i.path === 'Living/Sofa/a.jpg' && i.errorCode === 'PREVIEW_INVALID' && i.status === 'FAILED'));
  assert.ok(items.some((i) => i.driveFileName === null && i.errorCode === 'PREVIEW_TOO_LARGE'), 'unknown file still listed, without a name');
  assert.equal((await (await j(`/sync-jobs/${jobId}/items`)).json()).length, 2, 'FAILED is the default');
  assert.equal((await (await j(`/sync-jobs/${jobId}/items?status=DONE`)).json()).length, 1);
  assert.equal((await j(`/sync-jobs/${jobId}/items?status=WRONG`)).status, 400);
  assert.equal((await j(`/sync-jobs/${jobId}/items`, { user: 'user' })).status, 403);
});

test('cancel: QUEUED becomes CANCELLED, RUNNING becomes CANCELLING, finished job is 409', { skip }, async () => {
  const a = (await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json()).jobId;
  const r = await j(`/sync-jobs/${a}/cancel`, { method: 'POST' });
  assert.equal(r.status, 202); assert.equal(await r.text(), '');
  assert.equal((await pool.query('select status from drive_sync_jobs where id=$1', [a])).rows[0].status, 'CANCELLED');
  const again = await j(`/sync-jobs/${a}/cancel`, { method: 'POST' });
  assert.equal(again.status, 409); assert.equal((await again.json()).error.code, 'JOB_NOT_CANCELLABLE');

  const b = (await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json()).jobId;
  await q.claimJob(pool, 'w1');
  const r2 = await j(`/sync-jobs/${b}/cancel`, { method: 'POST' });
  assert.equal(r2.status, 202);
  assert.equal((await pool.query('select status from drive_sync_jobs where id=$1', [b])).rows[0].status, 'CANCELLING');
  assert.equal((await j(`/sync-jobs/${randomUUID()}/cancel`, { method: 'POST' })).status, 422);
  assert.equal((await j(`/sync-jobs/${b}/cancel`, { method: 'POST', user: 'user' })).status, 403);
});

test('retry: a finished job can be retried (202 {jobId}, same source+mode); an active one is 409', { skip }, async () => {
  const old = (await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at) values($1,'INCREMENTAL','FAILED',now()) returning id", [sourceId])).rows[0].id;
  const r = await j(`/sync-jobs/${old}/retry`, { method: 'POST' });
  assert.equal(r.status, 202);
  const { jobId } = await r.json();
  assert.notEqual(jobId, old);
  const row = (await pool.query('select source_id, mode, status, requested_by from drive_sync_jobs where id=$1', [jobId])).rows[0];
  assert.equal(row.source_id, sourceId); assert.equal(row.mode, 'INCREMENTAL'); assert.equal(row.status, 'QUEUED'); assert.equal(row.requested_by, adminId);

  const dup = await j(`/sync-jobs/${old}/retry`, { method: 'POST' });
  assert.equal(dup.status, 409); assert.equal((await dup.json()).error.code, 'SYNC_ALREADY_RUNNING');
  assert.equal((await j(`/sync-jobs/${randomUUID()}/retry`, { method: 'POST' })).status, 422);
  assert.equal((await j(`/sync-jobs/${old}/retry`, { method: 'POST', user: 'user' })).status, 403);
  assert.equal((await pool.query('select count(*)::int n from drive_sync_jobs')).rows[0].n, 2, 'a refused retry queues nothing');
  await pool.query('delete from drive_sync_jobs where id <> $1', [old]);
  await pool.query('update drive_sources set enabled=false where id=$1', [sourceId]);
  assert.equal((await j(`/sync-jobs/${old}/retry`, { method: 'POST' })).status, 400, 'disabled source cannot be retried');
  await pool.query('update drive_sources set enabled=true where id=$1', [sourceId]);
  assert.equal((await pool.query('select count(*)::int n from drive_sync_jobs')).rows[0].n, 1, 'nothing queued for a disabled source');
});

test('Job shape is exactly plan 2.2 (counters new/updated/.../errors, heartbeatAt), nothing extra', { skip }, async () => {
  const { jobId } = await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json();
  const job = await (await j(`/sync-jobs/${jobId}`)).json();
  assert.deepEqual(Object.keys(job).sort(), ['bytesDownloaded', 'counters', 'errorCode', 'errorMessage', 'finishedAt', 'heartbeatAt', 'id', 'mode', 'sourceId', 'stage', 'startedAt', 'status']);
  assert.deepEqual(Object.keys(job.counters).sort(), ['errors', 'missing', 'new', 'review', 'scannedFiles', 'scannedFolders', 'skipped', 'unchanged', 'updated']);
  const list = await (await j('/sync-jobs')).json();
  assert.deepEqual(Object.keys(list.items[0]).sort(), Object.keys(job).sort(), 'JobSummary has the same shape');
});

test('SSE: sends progress when it changes, then done and closes; the stream cap is enforced', { skip }, async () => {
  const id = (await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json()).jobId;
  const res = await j(`/sync-jobs/${id}/events`);
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader(); let text = '';
  const pump = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) return; text += Buffer.from(value).toString(); } })();
  await new Promise((r) => setTimeout(r, 150));
  await pool.query("update drive_sync_jobs set status='RUNNING', stage='SCANNING', scanned_files=5 where id=$1", [id]);
  await new Promise((r) => setTimeout(r, 200));
  await pool.query("update drive_sync_jobs set status='COMPLETED', finished_at=now() where id=$1", [id]);
  await pump;
  assert.match(text, /event: progress/); assert.match(text, /"scannedFiles":5/); assert.match(text, /event: done/);
  assert.ok(text.lastIndexOf('event: done') > text.indexOf('event: progress'), 'done comes last');
  assert.ok(!/CHECKPOINT|lease/i.test(text));

  const live = (await (await j('/sync-jobs', { method: 'POST', body: { sourceId, mode: 'FULL' } })).json()).jobId;
  const open = [];
  for (let i = 0; i < 2; i++) open.push(await j(`/sync-jobs/${live}/events`));
  assert.equal((await j(`/sync-jobs/${live}/events`)).status, 503, 'third stream refused');
  for (const r of open) await r.body.cancel();
  await new Promise((r) => setTimeout(r, 100));
  const again = await j(`/sync-jobs/${live}/events`);
  assert.equal(again.status, 200, 'slot freed after clients leave');
  await again.body.cancel();
});
