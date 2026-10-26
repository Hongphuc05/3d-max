import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleQueue } from './worker.mjs';

const env = { BACKEND_R2_EVENT_URL: 'https://backend.example/internal/r2/events', R2_EVENT_WEBHOOK_SECRET: 'test-only-secret' };
const event = { account: 'account', action: 'PutObject', bucket: 'bucket', object: { key: '3DSMOOD/Chair/a.JPG', size: 2, eTag: 'v1' }, eventTime: '2026-10-25T00:00:00Z' };
function message(body = event, attempts = 1) {
  return { body, attempts, acknowledged: false, retried: false,
    ack() { this.acknowledged = true; }, retry(options) { this.retried = options; } };
}

test('forwards raw event and acknowledges only successful backend persistence', async () => {
  const item = message();
  await handleQueue({ messages: [item] }, env, { fetchImpl: async (url, options) => {
    assert.equal(url, env.BACKEND_R2_EVENT_URL);
    assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), event);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 204 });
  } });
  assert.equal(item.acknowledged, true);
  assert.equal(item.retried, false);
});

test('retries rejected events independently without replaying successful messages', async () => {
  const items = [message(), message(), message(), message()];
  let index = 0;
  await handleQueue({ messages: items }, env, { fetchImpl: async () => new Response(null, { status: [200, 401, 429, 503][index++] }) });
  assert.deepEqual(items.map(item => item.acknowledged), [true, false, false, false]);
  assert.deepEqual(items.slice(1).map(item => item.retried.delaySeconds), [10, 10, 10]);
});

test('network failures and malformed messages retry towards the DLQ', async () => {
  const items = [message(event, 9), message('{broken')];
  await handleQueue({ messages: items }, env, { fetchImpl: async () => { throw new Error('network failure'); } });
  assert.deepEqual(items.map(item => item.acknowledged), [false, false]);
  assert.equal(items[0].retried.delaySeconds, 300);
  assert.equal(items[1].retried.delaySeconds, 10);
});

test('string bodies are parsed without rewriting object keys', async () => {
  const item = message(JSON.stringify(event));
  await handleQueue({ messages: [item] }, env, { fetchImpl: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), event);
    return new Response(null, { status: 202 });
  } });
  assert.equal(item.acknowledged, true);
});

test('missing secret or unsafe endpoint fails before sending a request', async () => {
  for (const invalid of [{ ...env, R2_EVENT_WEBHOOK_SECRET: '' }, { ...env, BACKEND_R2_EVENT_URL: 'http://backend.example/internal/r2/events' }, { ...env, BACKEND_R2_EVENT_URL: 'https://user:pass@backend.example/internal/r2/events' }]) {
    await assert.rejects(handleQueue({ messages: [message()] }, invalid, { fetchImpl: () => assert.fail('must not send credentials') }), /R2_CONSUMER_CONFIGURATION_REQUIRED/);
  }
  await assert.rejects(worker.queue({ messages: [] }, {}), /R2_CONSUMER_CONFIGURATION_REQUIRED/);
});

test('a response cleanup failure does not replay a committed event', async () => {
  const item = message();
  await handleQueue({ messages: [item] }, env, { fetchImpl: async () => ({ ok: true, body: { cancel: async () => { throw new Error('closed'); } } }) });
  assert.equal(item.acknowledged, true);
});
