// P4.2 (D26): tai file tu link Drive cong khai. fetch gia lap bang bang dinh tuyen URL -> Response; khong goi mang that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicLinkFetcher } from './public-link.js';

const ID = 'AbCdEfGhIj0123456789_-xyz';
const START = `https://drive.google.com/uc?export=download&id=${ID}`;
const CONFIRM_ACTION = 'https://drive.usercontent.google.com/download';
const bytes = Buffer.from('PK\x03\x04 fake zip payload '.repeat(50), 'binary');
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const file = (data = bytes, type = 'application/octet-stream') => new Response(data, { status: 200, headers: { 'content-type': type, 'content-length': String(data.length) } });
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } });
const form = (inputs, { action = CONFIRM_ACTION, method = 'get' } = {}) =>
  html(`<html><body><form id="download-form" action="${action}" method="${method}">${Object.entries(inputs).map(([n, v]) => `<input type="hidden" name="${n}" value="${v}">`).join('')}</form></body></html>`);

// table: URL -> Response | function; records every URL requested, in order.
function rig(table) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const entry = table[String(url)];
    if (!entry) return new Response('not found', { status: 404 });
    return typeof entry === 'function' ? entry(init) : entry;
  };
  return { calls, fetcher: createPublicLinkFetcher({ fetchImpl }) };
}
const drain = async (readable) => { const parts = []; for await (const c of readable) parts.push(c); return Buffer.concat(parts); };
const failsWith = (promise, code = 'STORAGE_DOWNLOAD_FAILED') => assert.rejects(promise, (e) => e.code === code && e.status === 502 && !/google|http/i.test(e.message), code);

test('a small file comes straight back: 200, length header, exact bytes; requests never follow redirects automatically', async () => {
  const { fetcher, calls } = rig({ [START]: file() });
  const r = await fetcher.open(ID);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(await drain(r.data), bytes);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual', 'each hop is validated by us, not followed blindly');
  assert.equal(calls[0].init.credentials, undefined);
});

test('redirects are followed hop by hop to allowed Google hosts only', async () => {
  const hop = 'https://doc-00-0o-docs.googleusercontent.com/docs/securesc/abc?e=download';
  const { fetcher, calls } = rig({ [START]: redirect(hop), [hop]: file() });
  assert.deepEqual(await drain((await fetcher.open(ID)).data), bytes);
  assert.deepEqual(calls.map((c) => c.url), [START, hop]);
});

test('large files: the HTML confirmation form (id, confirm, uuid) is followed exactly once to /download on usercontent', async () => {
  const next = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t&uuid=u-1_2`;
  const { fetcher, calls } = rig({ [START]: form({ id: ID, export: 'download', confirm: 't', uuid: 'u-1_2', evil: 'x' }), [next]: file() });
  assert.deepEqual(await drain((await fetcher.open(ID)).data), bytes);
  assert.equal(calls[1].url, next, 'only id/export/confirm/uuid are carried over; the id comes from OUR record, not from the page');
});

test('the id in the confirmation page is ignored; ours is used', async () => {
  const next = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t`;
  const { fetcher } = rig({ [START]: form({ id: 'SOMEONE_ELSES_FILE_ID', confirm: 't' }), [next]: file() });
  assert.deepEqual(await drain((await fetcher.open(ID)).data), bytes);
});

test('attribute values are HTML-decoded (&amp; in action is not part of a legal action here, but in values it must decode)', async () => {
  const next = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t`;
  const { fetcher } = rig({ [START]: html(`<form action="${CONFIRM_ACTION}" method="GET"><input name='confirm' value='t'></form>`), [next]: file() });
  assert.deepEqual(await drain((await fetcher.open(ID)).data), bytes);
});

test('confirmation pages that are not Google\'s download form are refused: wrong host/path/query/method, no confirm, bad characters, login/quota page', async () => {
  const pages = {
    'other host': form({ confirm: 't' }, { action: 'https://evil.example/download' }),
    'allowed host but not the download host': form({ confirm: 't' }, { action: 'https://drive.google.com/download' }),
    'google host, other path': form({ confirm: 't' }, { action: 'https://drive.usercontent.google.com/other' }),
    'action with query': form({ confirm: 't' }, { action: `${CONFIRM_ACTION}?x=1` }),
    'action http': form({ confirm: 't' }, { action: 'http://drive.usercontent.google.com/download' }),
    'action with port': form({ confirm: 't' }, { action: 'https://drive.usercontent.google.com:8443/download' }),
    'action with userinfo': form({ confirm: 't' }, { action: 'https://a:b@drive.usercontent.google.com/download' }),
    'relative action': form({ confirm: 't' }, { action: '/download' }),
    'post form': form({ confirm: 't' }, { method: 'post' }),
    'no confirm field': form({ id: ID }),
    'confirm with bad chars': form({ confirm: 't&x=1' }),
    'confirm too long': form({ confirm: 'a'.repeat(201) }),
    'quota page without a form': html('<html><body>Sorry, you can\'t view or download this file at this time.</body></html>'),
    'login page': html('<html><form action="https://accounts.google.com/signin"><input name="confirm" value="t"></form></html>'),
  };
  for (const [name, page] of Object.entries(pages)) {
    const { fetcher, calls } = rig({ [START]: page });
    await failsWith(fetcher.open(ID), 'STORAGE_DOWNLOAD_FAILED').catch((e) => { throw new Error(`${name}: ${e.message}`); });
    assert.equal(calls.length, 1, `${name}: nothing else may be requested`);
  }
});

test('hops to disallowed addresses are never requested: other host, http, port, userinfo, fragment, lookalike host', async () => {
  for (const to of ['https://evil.example/x', 'http://drive.google.com/uc', 'https://drive.google.com:444/uc', 'https://u:p@drive.google.com/uc', 'https://drive.google.com/uc#frag',
    'https://drive.google.com.evil.example/uc', 'https://evilgoogleusercontent.com/x', 'https://googleusercontent.com.evil.example/x', 'ftp://drive.google.com/x', 'data:text/plain,hi']) {
    const { fetcher, calls } = rig({ [START]: redirect(to), [to]: file() });
    await failsWith(fetcher.open(ID)).catch((e) => { throw new Error(`${to}: ${e.message}`); });
    assert.equal(calls.length, 1, `${to} must not be fetched`);
  }
  const { fetcher } = rig({ [START]: new Response(null, { status: 302 }) });
  await failsWith(fetcher.open(ID)); // redirect without Location
});

test('upstream errors, empty body, redirect loops and too many confirmations all fail with the one classified code', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) await failsWith(rig({ [START]: new Response('x', { status }) }).fetcher.open(ID));
  await failsWith(rig({ [START]: new Response(null, { status: 200, headers: { 'content-type': 'application/octet-stream' } }) }).fetcher.open(ID));
  await failsWith(rig({ [START]: redirect(START) }).fetcher.open(ID));
  const step = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t`;
  await failsWith(rig({ [START]: form({ confirm: 't' }), [step]: form({ confirm: 't' }) }).fetcher.open(ID));
  await failsWith(createPublicLinkFetcher({ fetchImpl: async () => { throw new TypeError('fetch failed: ECONNRESET to 10.0.0.1'); } }).open(ID));
});

test('a body that is really an HTML/error page served as a binary type is stopped before any byte is released', async () => {
  const { fetcher } = rig({ [START]: file(Buffer.from('<!DOCTYPE html><html>Sign in</html>'), 'application/octet-stream') });
  const r = await fetcher.open(ID);
  await assert.rejects(drain(r.data), (e) => e.code === 'STORAGE_DOWNLOAD_FAILED');
});

test('an HTML page larger than 256 KB is refused (bounded read), a legitimate form stays well below it', async () => {
  const huge = html('<form action="' + CONFIRM_ACTION + '"><input name="confirm" value="t"></form>' + '<!-- -->'.repeat(40_000));
  const next = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t`;
  await failsWith(rig({ [START]: huge, [next]: file() }).fetcher.open(ID));
});

test('the confirmation page may be served as application/xhtml+xml too', async () => {
  const next = `${CONFIRM_ACTION}?id=${ID}&export=download&confirm=t`;
  const page = new Response(`<form action="${CONFIRM_ACTION}"><input name="confirm" value="t"></form>`, { status: 200, headers: { 'content-type': 'application/xhtml+xml' } });
  assert.deepEqual(await drain((await rig({ [START]: page, [next]: file() }).fetcher.open(ID)).data), bytes);
});

test('invalid file ids are refused before any request', async () => {
  for (const bad of ['', 'short', 'has space ' + 'a'.repeat(12), `${ID}&confirm=1`, `${ID}/../x`, 'a'.repeat(201), undefined, null, 42]) {
    const { fetcher, calls } = rig({});
    await failsWith(fetcher.open(bad)).catch((e) => { throw new Error(`${String(bad)}: ${e.message}`); });
    assert.equal(calls.length, 0);
  }
});

test('abort signal: reaches fetch, and aborting while the body streams destroys the stream', async () => {
  const controller = new AbortController();
  let seen;
  const slow = (init) => {
    seen = init.signal;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([80, 75, 3, 4])); }, pull() { return new Promise(() => {}); } }), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  };
  const { fetcher } = rig({ [START]: slow });
  const r = await fetcher.open(ID, { signal: controller.signal });
  assert.ok(seen, 'signal passed to fetch');
  const done = drain(r.data);
  controller.abort();
  await assert.rejects(done);
  await assert.rejects(fetcher.open(ID, { signal: AbortSignal.abort() }));
});
