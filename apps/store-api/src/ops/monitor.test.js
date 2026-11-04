// P6 (plan §P6.3, E2): giam sat. Cac kiem tra do dia/RAM duoc tiem (khong dung may that); cac truy van chay tren PostgreSQL that.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { collectProblems, decideNotification, formatReport, loadMonitorConfig } from './monitor.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, sourceId, deviceId, catId;
const NOW = new Date('2026-11-03T03:00:00Z');
const GB = 1024 ** 3;
const okDisk = async () => ({ freeBytes: 50 * GB, totalBytes: 100 * GB });
const okRss = async () => 100 * 1024 ** 2;
const base = () => ({ pool, config: loadMonitorConfig({}), dirs: [{ name: 'storage', path: '/s' }], processes: [{ name: 'store-api', pid: 1 }], diskUsage: okDisk, readRss: okRss, now: () => NOW });
const keys = (r) => r.problems.map((p) => p.key).sort();

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('monitor');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','monitorRootFolder1','root','MY_DRIVE') returning id")).rows[0].id;
  deviceId = (await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,'PC') returning id", [randomUUID(), createHash('sha256').update(randomUUID()).digest(), `MAX-${'AB'.repeat(32)}`])).rows[0].id;
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Living','living','Living') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });

test('config: defaults, overrides and refusal of nonsense numbers', () => {
  const d = loadMonitorConfig({});
  assert.deepEqual([d.minFreeDiskRatio, d.rssLimitBytes, d.driveErrorsPerHour, d.bandwidthBytesPerHour, d.awaitingOwnerMinutes, d.repeatHours], [0.2, 800 * 1024 ** 2, 20, 5 * GB, 60, 6]);
  const o = loadMonitorConfig({ MONITOR_MIN_FREE_DISK_RATIO: '0.35', MONITOR_RSS_LIMIT_MB: '512', MONITOR_DRIVE_ERRORS_PER_HOUR: '5' });
  assert.deepEqual([o.minFreeDiskRatio, o.rssLimitBytes, o.driveErrorsPerHour], [0.35, 512 * 1024 ** 2, 5]);
  for (const env of [{ MONITOR_MIN_FREE_DISK_RATIO: '2' }, { MONITOR_MIN_FREE_DISK_RATIO: '-1' }, { MONITOR_RSS_LIMIT_MB: 'abc' }, { MONITOR_DRIVE_ERRORS_PER_HOUR: '1.5' }, { MONITOR_RSS_LIMIT_MB: '0' }])
    assert.throws(() => loadMonitorConfig(env), (e) => /MONITOR_/.test(e.message), JSON.stringify(env));
});

test('a healthy system reports no problems', { skip }, async () => {
  const r = await collectProblems(base());
  assert.deepEqual(r.problems, []);
  assert.equal(typeof r.metrics.freeDiskRatio.storage, 'number');
});

test('disk below 20% free is a problem (plan E2); exactly at the limit is not; an unreadable disk is a problem too', { skip }, async () => {
  const at = await collectProblems({ ...base(), diskUsage: async () => ({ freeBytes: 20, totalBytes: 100 }) });
  assert.deepEqual(at.problems, []);
  const low = await collectProblems({ ...base(), diskUsage: async () => ({ freeBytes: 19, totalBytes: 100 }) });
  assert.deepEqual(keys(low), ['disk:storage']); assert.match(low.problems[0].text, /19%/);
  const broken = await collectProblems({ ...base(), diskUsage: async () => { throw new Error('ENOENT /secret/path'); } });
  assert.deepEqual(keys(broken), ['disk:storage']); assert.ok(!broken.problems[0].text.includes('/secret/path'), 'no raw error text in alerts');
});

test('a process using more RAM than the limit is a problem; an unreadable process is a problem', { skip }, async () => {
  const over = await collectProblems({ ...base(), readRss: async () => 900 * 1024 ** 2 });
  assert.deepEqual(keys(over), ['rss:store-api']);
  const gone = await collectProblems({ ...base(), readRss: async () => { throw new Error('no such process'); } });
  assert.deepEqual(keys(gone), ['process:store-api']);
  const none = await collectProblems({ ...base(), processes: [] });
  assert.deepEqual(none.problems, []);
});

test('failed sync jobs of the last 24 hours are reported; older ones and completed ones are not', { skip }, async () => {
  await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at,created_at) values ($1,'FULL','FAILED',$2,$2)", [sourceId, new Date(NOW - 2 * 3600e3)]);
  await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at,created_at) values ($1,'FULL','FAILED',$2,$2)", [sourceId, new Date(NOW - 30 * 3600e3)]);
  await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at,created_at) values ($1,'FULL','COMPLETED',$2,$2)", [sourceId, new Date(NOW - 1 * 3600e3)]);
  const r = await collectProblems(base());
  assert.deepEqual(keys(r), ['jobs-failed']); assert.match(r.problems[0].text, /^.*1 /);
});

test('Drive errors per hour: failed items of recent jobs plus failed downloads, above the threshold only', { skip }, async () => {
  const jobId = (await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at,created_at) values ($1,'FULL','COMPLETED_WITH_ERRORS',$2,$2) returning id", [sourceId, new Date(NOW - 20 * 60e3)])).rows[0].id;
  for (let i = 0; i < 12; i++) await pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status,error_code) values ($1,$2,'PREVIEW','FAILED','DRIVE_RATE_LIMITED')", [jobId, `file-${i}`]);
  assert.deepEqual(keys(await collectProblems(base())).includes('drive-errors'), false, '12 < 20');
  const modelId = (await pool.query("insert into models(category_id,name,status,published_at) values ($1,'M','PUBLISHED',now()) returning id", [catId])).rows[0].id;
  const sessionId = (await pool.query("insert into model_download_sessions(token_hash,model_id,device_id,expires_at) values ($1,$2,$3,now()+interval '4 minutes') returning id", [createHash('sha256').update(randomUUID()).digest(), modelId, deviceId])).rows[0].id;
  for (let i = 0; i < 9; i++) await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,error_code,created_at) values ($1,$2,$3,'FAILED','DRIVE_UNAVAILABLE',$4)", [sessionId, modelId, deviceId, new Date(NOW - 10 * 60e3)]);
  const r = await collectProblems(base());
  assert.ok(keys(r).includes('drive-errors')); assert.match(r.problems.find((p) => p.key === 'drive-errors').text, /21/);
  assert.deepEqual(keys(await collectProblems({ ...base(), config: loadMonitorConfig({ MONITOR_DRIVE_ERRORS_PER_HOUR: '21' }) })).includes('drive-errors'), false, 'exactly at the threshold is fine');
  await pool.query('delete from model_download_logs'); await pool.query('delete from drive_sync_job_items');
});

test('bandwidth sent in the last hour above the threshold is a problem; older traffic does not count', { skip }, async () => {
  const modelId = (await pool.query('select id from models limit 1')).rows[0].id;
  const sessionId = (await pool.query('select id from model_download_sessions limit 1')).rows[0].id;
  await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,bytes_sent,created_at) values ($1,$2,$3,'COMPLETED',$4,$5)", [sessionId, modelId, deviceId, 4 * GB, new Date(NOW - 3 * 3600e3)]);
  await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,bytes_sent,created_at) values ($1,$2,$3,'COMPLETED',$4,$5)", [sessionId, modelId, deviceId, 4 * GB, new Date(NOW - 20 * 60e3)]);
  assert.equal(keys(await collectProblems(base())).includes('bandwidth'), false, '4 GiB in the hour < 5 GiB');
  await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,bytes_sent,created_at) values ($1,$2,$3,'COMPLETED',$4,$5)", [sessionId, modelId, deviceId, 2 * GB, new Date(NOW - 5 * 60e3)]);
  const r = await collectProblems(base());
  assert.ok(keys(r).includes('bandwidth')); assert.match(r.problems.find((p) => p.key === 'bandwidth').text, /6[,.]0/);
  await pool.query('delete from model_download_logs');
});

test('orders waiting for the owner for more than an hour are reported (plan P6.3); fresh, expired and decided ones are not', { skip }, async () => {
  const mk = (status, claimedAgoMin, expiresInMin) => pool.query(
    "insert into purchase_orders(code,device_id,amount_vnd,status,claimed_paid_at,expires_at,bank_snapshot) values ($1,$2,15000,$3,$4,$5,'{}')",
    [`3DM${randomUUID().slice(0, 6).toUpperCase()}`, deviceId, status, new Date(NOW - claimedAgoMin * 60e3), new Date(NOW.getTime() + expiresInMin * 60e3)]);
  await mk('AWAITING_OWNER', 30, 600);   // fresh
  await mk('AWAITING_OWNER', 200, -10);  // already expired (the sweeper will mark it)
  await mk('CONFIRMED', 300, 600);       // decided
  assert.equal(keys(await collectProblems(base())).includes('orders-waiting'), false);
  await mk('AWAITING_OWNER', 61, 600);
  await mk('AWAITING_OWNER', 125, 600);
  const r = await collectProblems(base());
  assert.ok(keys(r).includes('orders-waiting')); assert.match(r.problems.find((p) => p.key === 'orders-waiting').text, /2 /);
});

test('an unreachable database is a single clear problem and the other checks still run', async () => {
  const dead = { query: async () => { throw new Error('connect ECONNREFUSED postgres://user:pass@host/db'); } };
  const r = await collectProblems({ ...base(), pool: dead, diskUsage: async () => ({ freeBytes: 1, totalBytes: 100 }) });
  assert.deepEqual(keys(r), ['db', 'disk:storage']);
  assert.ok(!JSON.stringify(r).includes('pass@host'), 'no connection string in the report');
});

test('notification policy: new problem set -> notify; same set -> quiet until the repeat interval; recovery -> one message; healthy and quiet -> nothing', () => {
  const t0 = NOW.getTime(), H = 3600e3;
  const p = (...k) => k.map((key) => ({ key, text: key }));
  assert.deepEqual(decideNotification(null, [], t0), { notify: null, state: { keys: [], at: t0 } });
  const first = decideNotification(null, p('db'), t0);
  assert.equal(first.notify, 'PROBLEM'); assert.deepEqual(first.state, { keys: ['db'], at: t0 });
  assert.equal(decideNotification(first.state, p('db'), t0 + 5 * 60e3, 6).notify, null);
  assert.equal(decideNotification(first.state, p('db'), t0 + 6 * H, 6).notify, 'PROBLEM', 'repeat after the interval');
  assert.deepEqual(decideNotification(first.state, p('db'), t0 + 5 * 60e3, 6).state, first.state, 'quiet runs keep the original timestamp');
  assert.equal(decideNotification(first.state, p('db', 'rss:store-api'), t0 + 60e3, 6).notify, 'PROBLEM', 'a new problem is news');
  assert.equal(decideNotification(first.state, p(), t0 + 60e3, 6).notify, 'RECOVERED');
  assert.equal(decideNotification({ keys: ['db'], at: t0 }, p('rss:a'), t0 + 60e3, 6).notify, 'PROBLEM', 'different set');
  assert.equal(decideNotification({ keys: 'garbage', at: 'x' }, p('db'), t0, 6).notify, 'PROBLEM', 'a corrupt state file never silences alerts');
});

test('the report is plain text, lists each problem, and is bounded', () => {
  const text = formatReport('PROBLEM', Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, text: 'x'.repeat(80) })), NOW);
  assert.ok(text.length <= 4000); assert.match(text, /^⚠️/);
  assert.match(formatReport('RECOVERED', [], NOW), /^✅/);
  assert.match(formatReport('PROBLEM', [{ key: 'a', text: 'disk thấp' }], NOW), /disk thấp/);
});

test('boundaries are exclusive: exactly the RAM limit or exactly the bandwidth threshold is fine', { skip }, async () => {
  const limit = loadMonitorConfig({}).rssLimitBytes;
  assert.equal(keys(await collectProblems({ ...base(), readRss: async () => limit })).includes('rss:store-api'), false);
  assert.equal(keys(await collectProblems({ ...base(), readRss: async () => limit + 1 })).includes('rss:store-api'), true);
  const modelId = (await pool.query('select id from models limit 1')).rows[0].id;
  const sessionId = (await pool.query('select id from model_download_sessions limit 1')).rows[0].id;
  await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,bytes_sent,created_at) values ($1,$2,$3,'COMPLETED',$4,$5)", [sessionId, modelId, deviceId, 5 * GB, new Date(NOW - 60e3)]);
  assert.equal(keys(await collectProblems(base())).includes('bandwidth'), false, 'exactly 5 GiB');
  await pool.query('update model_download_logs set bytes_sent = bytes_sent + 1');
  assert.equal(keys(await collectProblems(base())).includes('bandwidth'), true, '5 GiB + 1 byte');
  await pool.query('delete from model_download_logs');
});

test('failed items of OLD jobs do not count as errors in the last hour', { skip }, async () => {
  const jobId = (await pool.query("insert into drive_sync_jobs(source_id,mode,status,finished_at,created_at) values ($1,'FULL','COMPLETED_WITH_ERRORS',$2,$2) returning id", [sourceId, new Date(NOW - 5 * 3600e3)])).rows[0].id;
  for (let i = 0; i < 30; i++) await pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status,error_code) values ($1,$2,'PREVIEW','FAILED','DRIVE_RATE_LIMITED')", [jobId, `old-${i}`]);
  assert.equal(keys(await collectProblems(base())).includes('drive-errors'), false);
  await pool.query('delete from drive_sync_job_items');
});

test('an empty MONITOR_* variable means "use the default"; a corrupt state file never reports a recovery', () => {
  assert.equal(loadMonitorConfig({ MONITOR_RSS_LIMIT_MB: '' }).rssLimitBytes, 800 * 1024 ** 2);
  for (const bad of [{ keys: 'garbage', at: 1 }, { keys: [1], at: 1 }, { keys: ['a'], at: 'x' }, 'text', 5, {}])
    assert.equal(decideNotification(bad, [], 1e12).notify, null, JSON.stringify(bad));
});

test('control characters in problem text cannot forge lines in the alert', () => {
  const text = formatReport('PROBLEM', [{ key: 'a', text: 'dong 1\n• gia mao\u0000\r\nx' }], NOW);
  assert.equal(text.split('\n').length, 2, 'header + exactly one bullet');
  assert.ok(!text.includes('\u0000'), 'NUL is stripped, not passed to Telegram');
});
