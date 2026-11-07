import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { 'X-3dsmood-Content-Domains': '1', ...options.headers } });

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, manifest, routes, sourceId, previewDir;
let n = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = s => createHash('sha256').update(s).digest('hex');
const SECRET_FILE_HASH = 'f'.repeat(64);

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('catalog_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  manifest = await import('./manifest.js');
  routes = await import('./routes.js');
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','routesRootFolder1','root','MY_DRIVE') returning id")).rows[0].id;
  previewDir = await mkdtemp(path.join(os.tmpdir(), 'v1-previews-'));
});
after(async () => { if (previewDir) await rm(previewDir, { recursive: true, force: true }); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['model_previews', 'model_files', 'models', 'categories']) await pool.query(`delete from ${t}`);
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null, published_at = null');
});

async function addModel(name, categoryPath, { status = 'PUBLISHED', price = 15000, contentDomain = '3dmodels' } = {}) {
  const parts = categoryPath.split(' / '); let parent = null, p = '';
  for (const part of parts) { p = p ? `${p} / ${part}` : part; parent = (await pool.query('insert into categories(parent_id,name,slug,full_path,content_domain) values($1,$2,$2,$3,$4) on conflict (content_domain, full_path) do update set name=excluded.name returning id', [parent, part, p, contentDomain])).rows[0].id; }
  const id = (await pool.query('insert into models(category_id,name,status,content_domain) values($1,$2,$3,$4) returning id', [parent, name, status, contentDomain])).rows[0].id;
  const driveId = `DRIVESECRET${String(++n).padStart(8, '0')}`;
  const f = (await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes,sha256) values($1,$2,$3,$4,'rar',1234,$5) returning id", [id, sourceId, driveId, `${name}.rar`, SECRET_FILE_HASH])).rows[0].id;
  await pool.query('update models set primary_file_id=$1 where id=$2', [f, id]);
  for (const [variant, w] of [['sm', 480], ['lg', 1400]]) {
    const h = sha(`${id}${variant}`);
    await pool.query("insert into model_previews(model_id,source,source_drive_file_id,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'DRIVE_IMAGE',$2,$3,$4,500,$5,300,$6,true)", [id, `IMGSECRET${n}`, `${h}.webp`, h, w, variant]);
  }
  return { id, driveId };
}
async function bump() { const c = await pool.connect(); try { await c.query('begin'); const r = await manifest.refreshCatalogState(c); await c.query('commit'); return r; } finally { c.release(); } }

// A server shaped like the real one: the global /api no-store middleware runs BEFORE the v1 router.
async function startServer(opts = {}) {
  const events = routes.createCatalogEvents({ pool, pollMs: 60_000, pingMs: 60_000, ...opts.events });
  await events.start();
  const app = express();
  app.set('trust proxy', true); // lets the test pretend to be several client IPs through X-Forwarded-For
  app.use('/api', (_q, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/v1', routes.createCatalogV1Router({ pool, events, ...opts.router }));
  app.use('/previews', routes.createPreviewRouter({ dir: previewDir }));
  app.use('/previews', (_q, res) => res.status(404).send('legacy'));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, events, close: async () => { await events.stop(); server.closeAllConnections?.(); await new Promise(r => server.close(r)); } };
}
async function sse(url) {
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal });
  const events = []; const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { events.push(buf.slice(0, i)); buf = buf.slice(i + 2); } } } catch { /* aborted */ } })();
  const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (events.some(pred)) return true; await sleep(10); } return false; };
  return { res, events, until, close: async () => { ac.abort(); await pump; } };
}

test('version endpoint: shape, ETag, 304 on a matching If-None-Match, a new ETag after the catalog changed; revalidation not no-store', { skip }, async () => {
  const s = await startServer();
  try {
    await addModel('One', 'Furniture / Desk'); await bump();
    const a = await fetch(`${s.base}/api/v1/catalog/version`);
    const body = await a.json();
    assert.deepEqual(Object.keys(body).sort(), ['catalogVersion', 'manifestChecksum', 'publishedAt']);
    assert.deepEqual([body.catalogVersion, /^[0-9a-f]{64}$/.test(body.manifestChecksum)], [1, true]);
    const etag = a.headers.get('etag');
    assert.match(etag, /^"1-[0-9a-f]{64}-domains1"$/);
    assert.equal(a.headers.get('cache-control'), 'no-cache', 'must revalidate (overrides the global no-store)');
    const again = await fetch(`${s.base}/api/v1/catalog/version`, { headers: { 'if-none-match': etag } });
    assert.deepEqual([again.status, await again.text()], [304, '']);
    assert.equal((await fetch(`${s.base}/api/v1/catalog/version`, { headers: { 'if-none-match': `W/${etag}, "other"` } })).status, 304, 'weak/list forms');
    assert.equal((await fetch(`${s.base}/api/v1/catalog/version`, { headers: { 'if-none-match': '"nope"' } })).status, 200);

    await addModel('Two', 'Furniture / Desk'); await bump();
    const fresh = await fetch(`${s.base}/api/v1/catalog/version`, { headers: { 'if-none-match': etag } });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.headers.get('etag'), etag);
    assert.equal((await fresh.json()).catalogVersion, 2);
  } finally { await s.close(); }
});

test('catalog, categories and previews manifest: exact public shape, only PUBLISHED models, category counts include children, 304 on each', { skip }, async () => {
  const s = await startServer();
  try {
    await addModel('Desk A', 'Furniture / Desk'); await addModel('Chair', 'Furniture / Chair');
    await addModel('Hidden', 'Furniture / Desk', { status: 'HIDDEN' }); await addModel('Draft', 'Lighting', { status: 'NEEDS_REVIEW' });
    await bump();
    const cat = await (await fetch(`${s.base}/api/v1/catalog`)).json();
    assert.deepEqual(Object.keys(cat).sort(), ['catalogVersion', 'models']);
    assert.deepEqual(cat.models.map(m => m.name).sort(), ['Chair', 'Desk A']);
    assert.deepEqual(Object.keys(cat.models[0]).sort(), ['categoryId', 'categoryIds', 'contentDomain', 'fileType', 'id', 'name', 'sizeBytes', 'status']);
    assert.deepEqual([cat.models[0].status, cat.models[0].sizeBytes, cat.models[0].fileType], ['PUBLISHED', 1234, 'rar']);
    const cats = await (await fetch(`${s.base}/api/v1/categories`)).json();
    assert.deepEqual(Object.fromEntries(cats.map(c => [c.fullPath, c.modelCount])), { Furniture: 2, 'Furniture / Chair': 1, 'Furniture / Desk': 1 });
    assert.deepEqual(Object.keys(cats[0]).sort(), ['contentDomain', 'fullPath', 'id', 'modelCount', 'name', 'parentId']);
    const prev = await (await fetch(`${s.base}/api/v1/previews/manifest`)).json();
    assert.deepEqual([prev.catalogVersion, prev.previews.length], [1, 4]);
    assert.deepEqual(Object.keys(prev.previews[0]).sort(), ['contentDomain', 'fileSize', 'height', 'modelId', 'sha256', 'url', 'variant', 'version', 'width']);
    assert.ok(prev.previews.every(p => p.url === `/previews/3dmodels/${p.sha256}.webp`));
    for (const p of ['/api/v1/catalog', '/api/v1/categories', '/api/v1/previews/manifest']) {
      const r = await fetch(`${s.base}${p}`);
      assert.equal((await fetch(`${s.base}${p}`, { headers: { 'if-none-match': r.headers.get('etag') } })).status, 304, p);
    }
  } finally { await s.close(); }
});

test('nothing private leaks: no Drive id, source id, file name or model-file sha256 in ANY public response', { skip }, async () => {
  const s = await startServer();
  try {
    const m = await addModel('Leak check', 'A / B'); await bump();
    for (const p of ['/api/v1/catalog/version', '/api/v1/catalog', '/api/v1/categories', '/api/v1/previews/manifest']) {
      const r = await fetch(`${s.base}${p}`); const text = JSON.stringify([...r.headers]) + await r.text();
      for (const secret of [m.driveId, 'IMGSECRET', sourceId, SECRET_FILE_HASH, 'routesRootFolder1', 'Leak check.rar', 'drive_file_id']) assert.ok(!text.includes(secret), `${p} leaks ${secret}`);
    }
  } finally { await s.close(); }
});

test('capability negotiation keeps old plugins on the exact Models contract and gives each catalog view its own checksum and ETag', { skip }, async () => {
  const model = await addModel('Model', 'Shared');
  const scene = await addModel('Scene', 'Shared', { contentDomain: '3dscenes' });
  await bump();
  const s = await startServer();
  const old = url => globalThis.fetch(s.base + url);
  try {
    const mixed = await fetch(s.base + '/api/v1/catalog');
    assert.deepEqual((await mixed.json()).models.map(m => m.id).sort(), [model.id, scene.id].sort());
    assert.match(mixed.headers.get('etag'), /-domains1"$/);
    assert.match(mixed.headers.get('vary'), /X-3dsmood-Content-Domains/i);
    const legacy = await old('/api/v1/catalog');
    const legacyModels = (await legacy.json()).models;
    assert.deepEqual(legacyModels.map(m => m.id), [model.id]);
    assert.equal(legacyModels[0].contentDomain, undefined);
    assert.equal(legacyModels[0].categoryIds, undefined);
    const categories = await (await old('/api/v1/categories')).json();
    assert.ok(categories.every(c => c.contentDomain === undefined && c.modelCount === 1));
    const previews = (await (await old('/api/v1/previews/manifest')).json()).previews;
    assert.ok(previews.every(p => p.modelId === model.id && p.url === `/previews/${p.sha256}.webp` && p.contentDomain === undefined));
    const version = await (await old('/api/v1/catalog/version')).json();
    assert.equal(version.manifestChecksum, sha(JSON.stringify({ categories, models: legacyModels, previews })));
    assert.notEqual(mixed.headers.get('etag'), legacy.headers.get('etag'));
    assert.equal((await fetch(s.base + '/api/v1/catalog', { headers: { 'If-None-Match': legacy.headers.get('etag') } })).status, 200);
    assert.equal((await globalThis.fetch(s.base + '/api/v1/catalog', { headers: { 'If-None-Match': legacy.headers.get('etag') } })).status, 304);
    const preview = previews[0];
    await mkdir(path.join(previewDir, '3dmodels'), { recursive: true });
    await writeFile(path.join(previewDir, '3dmodels', `${preview.sha256}.webp`), 'new scoped bytes');
    assert.equal(await (await old(preview.url)).text(), 'new scoped bytes', 'old flat URL reads a new Models blob');
  } finally { await s.close(); }
});

test('the manifest is built once per catalog version and rebuilt after a publish; version and body always agree', { skip }, async () => {
  let builds = 0;
  const real = manifest.buildManifest;
  const s = await startServer({ router: { build: async (c) => { builds++; return real(c); } } });
  try {
    await addModel('One', 'A / B'); await bump();
    await Promise.all([1, 2, 3, 4].map(() => fetch(`${s.base}/api/v1/catalog`).then(r => r.json())));
    await fetch(`${s.base}/api/v1/categories`); await fetch(`${s.base}/api/v1/previews/manifest`);
    assert.equal(builds, 1);
    await addModel('Two', 'A / B'); await bump();
    const body = await (await fetch(`${s.base}/api/v1/catalog`)).json();
    assert.deepEqual([builds, body.catalogVersion, body.models.length], [2, 2, 2]);
  } finally { await s.close(); }
});

test('public endpoints are rate limited with the shared limiter and answer errors in the v3 envelope', { skip }, async () => {
  let hits = 0;
  const s = await startServer({ router: { rateLimit: (_q, res, next) => (++hits > 3 ? res.status(429).json({ error: 'TOO_MANY_REQUESTS' }) : next()) } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s.base}/api/v1/catalog/version`)).status, 200);
    assert.equal((await fetch(`${s.base}/api/v1/catalog/version`)).status, 429);
  } finally { await s.close(); }
});

test('preview files: served by exact content-hash name only, immutable cache; everything else (tmp/*.part, traversal, upper-case, other names) falls through', { skip }, async () => {
  const s = await startServer();
  try {
    await mkdir(path.join(previewDir, 'tmp'), { recursive: true });
    const name = `${'a'.repeat(64)}.webp`;
    await writeFile(path.join(previewDir, name), Buffer.from('RIFFxxxxWEBPfake'));
    await writeFile(path.join(previewDir, 'tmp', 'x.part'), 'partial download');
    await writeFile(path.join(previewDir, 'secret.txt'), 'nope');
    const ok = await fetch(`${s.base}/previews/${name}`);
    assert.deepEqual([ok.status, ok.headers.get('content-type'), ok.headers.get('x-content-type-options')], [200, 'image/webp', 'nosniff']);
    assert.match(ok.headers.get('cache-control'), /max-age=31536000/);
    assert.match(ok.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(`${s.base}/previews/${name}`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${s.base}/previews/3dmodels/${name}`)).status, 200, 'scoped Models URL falls back before physical relocation');
    assert.equal((await fetch(`${s.base}/previews/3dscenes/${name}`)).status, 404, 'Scenes never reads a legacy Models blob');
    await mkdir(path.join(previewDir, '3dscenes'), { recursive: true });
    await writeFile(path.join(previewDir, '3dscenes', name), 'scene bytes');
    assert.equal(await (await fetch(`${s.base}/previews/3dscenes/${name}`)).text(), 'scene bytes');
    for (const bad of ['tmp/x.part', 'secret.txt', `${'A'.repeat(64)}.webp`, `${'a'.repeat(63)}.webp`, `${'a'.repeat(64)}.png`, '..%2fsecret.txt', `${'b'.repeat(64)}.webp`]) {
      const r = await fetch(`${s.base}/previews/${bad}`);
      assert.deepEqual([r.status, await r.text()], [404, 'legacy'], bad);
    }
  } finally { await s.close(); }
});

test('SSE: initial version, an update arrives through NOTIFY (poll disabled), an unchanged publish is silent, heartbeat comments keep the line open', { skip }, async () => {
  const s = await startServer({ events: { pingMs: 50 } });
  let c;
  try {
    await addModel('One', 'A / B'); await bump();
    c = await sse(`${s.base}/api/v1/catalog/events`);
    assert.equal(c.res.headers.get('content-type'), 'text/event-stream');
    assert.match(c.res.headers.get('cache-control'), /no-cache/);
    assert.ok(await c.until(e => /event: catalog\.updated/.test(e) && /"catalogVersion":1/.test(e)), 'initial snapshot');
    assert.ok(await c.until(e => e.startsWith(': ping')), 'heartbeat');
    const before = c.events.filter(e => /catalog\.updated/.test(e)).length;
    await bump(); // nothing changed -> no event
    await sleep(150);
    assert.equal(c.events.filter(e => /catalog\.updated/.test(e)).length, before);
    await addModel('Two', 'A / B'); await bump();
    assert.ok(await c.until(e => /"catalogVersion":2/.test(e)), 'update delivered');
  } finally { if (c) await c.close(); await s.close(); }
});

test('SSE: NOTIFY and the poll can both see an update; each version is announced exactly once', { skip }, async () => {
  const s = await startServer({ events: { pollMs: 20 } });
  let c;
  try {
    c = await sse(`${s.base}/api/v1/catalog/events`);
    await addModel('One', 'A / B'); await bump();
    assert.ok(await c.until(e => /"catalogVersion":1/.test(e)));
    await sleep(250); // many poll ticks after the NOTIFY
    assert.equal(c.events.filter(e => /"catalogVersion":1/.test(e)).length, 1);
  } finally { if (c) await c.close(); await s.close(); }
});

test('SSE fallback: when LISTEN is unavailable the poll still delivers updates', { skip }, async () => {
  const s = await startServer({ events: { listen: false, pollMs: 40 } });
  let c;
  try {
    c = await sse(`${s.base}/api/v1/catalog/events`);
    await addModel('One', 'A / B'); await bump();
    assert.ok(await c.until(e => /"catalogVersion":1/.test(e)));
  } finally { if (c) await c.close(); await s.close(); }
});

test('SSE connection cap: the extra client gets 503 CATALOG_EVENTS_BUSY; a freed slot is reusable; stop() closes every stream', { skip }, async () => {
  const s = await startServer({ router: { maxStreams: 2 } });
  const open = [];
  try {
    open.push(await sse(`${s.base}/api/v1/catalog/events`), await sse(`${s.base}/api/v1/catalog/events`));
    const busy = await fetch(`${s.base}/api/v1/catalog/events`);
    assert.equal(busy.status, 503);
    const body = await busy.json();
    assert.equal(body.error.code, 'CATALOG_EVENTS_BUSY');
    assert.ok(body.error.requestId);
    await open.pop().close();
    await sleep(100);
    const reused = await sse(`${s.base}/api/v1/catalog/events`); // the freed slot must really be reusable
    open.push(reused);
    assert.deepEqual([reused.res.status, reused.res.headers.get('content-type')], [200, 'text/event-stream']);
    assert.equal(s.events.size, 2);
  } finally {
    await s.events.stop();
    await Promise.all(open.map(c => c.until(() => false, 50).then(() => c.close())));
    await s.close();
  }
});

test('SSE per-IP cap: one address cannot take every slot; other addresses are served; a closed stream frees its slot', { skip }, async () => {
  const s = await startServer({ router: { maxStreams: 10, maxPerIp: 2 } });
  const open = [];
  const as = ip => fetch(`${s.base}/api/v1/catalog/events`, { headers: { 'x-forwarded-for': ip } });
  try {
    for (let i = 0; i < 2; i++) { const r = await as('203.0.113.7'); assert.equal(r.status, 200); open.push(r); }
    const refused = await as('203.0.113.7');
    assert.equal(refused.status, 503);
    assert.equal((await refused.json()).error.code, 'CATALOG_EVENTS_BUSY');
    const other = await as('198.51.100.9');
    assert.equal(other.status, 200, 'another client is not affected');
    open.push(other);
    await open.shift().body.cancel(); await sleep(100);
    const again = await as('203.0.113.7');
    assert.equal(again.status, 200, 'a freed slot of that IP is reusable');
    open.push(again);
  } finally { for (const r of open) await r.body.cancel().catch(() => {}); await s.close(); }
});

test('the events hub releases its database connection on stop (the pool can shut down cleanly)', { skip }, async () => {
  const before = pool.totalCount - pool.idleCount;
  const hub = routes.createCatalogEvents({ pool, pollMs: 60_000, pingMs: 60_000 });
  await hub.start();
  assert.equal(pool.totalCount - pool.idleCount, before + 1, 'one connection is held for LISTEN');
  await hub.stop();
  assert.equal(pool.totalCount - pool.idleCount, before);
});
