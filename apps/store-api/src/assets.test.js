// Chay tren Postgres that (database store_test). Xem apps/README.md de dung Postgres.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://store:store@localhost:5432/store_test';

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

const { pool, migrate } = await import('./db.js');
const { authRouter } = await import('./auth.js');
const { assetRouter } = await import('./assets.js');
const { load } = await import('./catalog.js');
const { errorHandler, originGuard } = await import('./security.js');

const dir = mkdtempSync(path.join(tmpdir(), 'assets-'));
mkdirSync(path.join(dir, 'Furniture'));
writeFileSync(path.join(dir, 'Furniture', 'sofa.rar'), 'NOI-DUNG-GOI');
writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ products: [{
  id: 'abc123abc123', slug: 'sofa-abc123abc123', name: 'Sofa', category: 'Furniture', subcategory: 'Sofa', price: 15000,
  asset: { file: 'Furniture/sofa.rar', size: 12, max: [], hasFbx: true, hasObj: false, hasTextures: false, renderers: [] },
}] }));

let server, base, sid;
before(async () => {
  await migrate();
  await pool.query('truncate users cascade');
  const app = express();
  app.use(express.json({ limit: '10kb' }), originGuard);
  app.use('/api/auth', authRouter);
  app.use('/api', assetRouter(load(path.join(dir, 'catalog.json')), dir));
  app.use(errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'tai@example.com', password: 'mat-khau-dai-du' }),
  });
  sid = /^sid=([^;]*)/.exec(r.headers.getSetCookie().find((c) => c.startsWith('sid=')))[1];
});
after(async () => { server.close(); await pool.end(); });

const authed = (p, init = {}) => fetch(base + p, { ...init, headers: { ...init.headers, cookie: `sid=${sid}` } });
const ticketOf = () => authed('/api/products/sofa-abc123abc123/import-ticket', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});

test('download: can dang nhap, tra dung file voi ten theo slug', async () => {
  assert.equal((await fetch(base + '/api/products/sofa-abc123abc123/download')).status, 401);
  const r = await authed('/api/products/sofa-abc123abc123/download');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /sofa-abc123abc123\.rar/);
  assert.equal(await r.text(), 'NOI-DUNG-GOI');
  assert.equal((await authed('/api/products/khong-co/download')).status, 404);
});

test('import ticket: can dang nhap, dung 1 lan, khop regex cua host', async () => {
  assert.equal((await fetch(base + '/api/products/sofa-abc123abc123/import-ticket', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status, 401);
  const { assetId, ticket } = await (await ticketOf()).json();
  assert.equal(assetId, 'abc123abc123');
  assert.match(ticket, /^[A-Za-z0-9_-]{16,128}$/);
  const first = await fetch(base + '/api/downloads/stream/' + ticket);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), 'NOI-DUNG-GOI');
  assert.equal((await fetch(base + '/api/downloads/stream/' + ticket)).status, 404);
});

test('ticket het han thi bi tu choi', async () => {
  const { ticket } = await (await ticketOf()).json();
  await pool.query("update import_tickets set expires_at = now() - interval '1 second'");
  assert.equal((await fetch(base + '/api/downloads/stream/' + ticket)).status, 404);
});
