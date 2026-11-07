import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { inventory, main } from './preview-library.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'preview-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return async (relative, bytes = 'image bytes') => {
    const filename = path.join(dir, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
    return dir;
  };
}

test('Scenes supports mixed category depths and identical cross-category memberships', async t => {
  const put = await fixture(t);
  const dir = await put('Exterior/Shared.jpeg');
  await put('Interior/Other/shared.JPG');
  const out = await inventory(dir, '3dscenes');
  assert.deepEqual(out.errors, []);
  assert.equal(out.fileCount, 2);
  assert.equal(out.uniqueStems, 1);
  assert.equal(out.duplicates[0].identical, true);
  assert.deepEqual(out.items.map(x => x.category), ['Exterior', 'Interior/Other']);
});

test('rejects conflicting duplicate contents before sending any upload', async t => {
  const put = await fixture(t);
  const dir = await put('Exterior/shared.jpeg', 'first');
  await put('Interior/Other/shared.jpg', 'different');
  const out = await inventory(dir, '3dscenes');
  assert.equal(out.duplicates[0].identical, false);
  assert.match(out.errors[0], /ambiguous duplicate/);
  const models = await inventory(dir, '3dmodels');
  assert.equal(models.errors.length, 1);
});

test('rejects root images and unsupported files while ignoring OS metadata', async t => {
  const put = await fixture(t);
  const dir = await put('no-category.jpg');
  await put('Interior/source.zip');
  await put('Interior/.DS_Store');
  await put('Interior/valid.png');
  const out = await inventory(dir, '3dscenes');
  assert.equal(out.items.length, 1);
  assert.equal(out.errors.length, 2);
  assert.equal(out.ignored.length, 1);
});

test('resumes successful files only and refuses an unscoped legacy API', async t => {
  const put = await fixture(t);
  const dir = await put('Exterior/a.jpeg');
  await put('Interior/b.jpg');
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'preview-results-'));
  t.after(() => rm(reportDir, { recursive: true, force: true }));
  let legacy = true, failFirst = true;
  const posts = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify(legacy ? { items: [] } : { contentDomain: '3dscenes', items: [] })); return; }
    const name = new URL(req.url, 'http://localhost').searchParams.get('filename');
    posts.push(name);
    for await (const chunk of req) { /* drain image stream */ }
    const failed = failFirst && name === 'a.jpeg';
    res.statusCode = failed ? 500 : 201;
    res.end(JSON.stringify(failed ? { error: { code: 'INTERNAL' } } : { id: name, state: 'FULL' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const oldCookie = process.env.PREVIEW_ADMIN_COOKIE;
  process.env.PREVIEW_ADMIN_COOKIE = 'sid=local-test';
  t.after(() => { if (oldCookie === undefined) delete process.env.PREVIEW_ADMIN_COOKIE; else process.env.PREVIEW_ADMIN_COOKIE = oldCookie; });
  const args = ['--root', dir, '--domain', '3dscenes', '--report', path.join(reportDir, 'results.json'), '--upload', '--origin', `http://127.0.0.1:${server.address().port}`];
  await assert.rejects(main(args), /selected content domain/);
  assert.equal(posts.length, 0);
  legacy = false;
  await assert.rejects(main(args), /Some previews failed/);
  assert.deepEqual(posts, ['a.jpeg', 'b.jpg']);
  failFirst = false;
  await main(args);
  assert.deepEqual(posts, ['a.jpeg', 'b.jpg', 'a.jpeg']);
});
