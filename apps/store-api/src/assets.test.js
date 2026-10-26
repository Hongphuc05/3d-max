import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { isolatedTestDatabase } from './test-database.js';

const cleanupDatabase = await isolatedTestDatabase('assets_http');
process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { pool, migrate } = await import('./db.js');
const { authRouter } = await import('./auth.js');
const { assetRouter } = await import('./assets.js');
const { licenseRouter, deviceRouter, adminLicenseRouter } = await import('./licensing/routes.js');
const { issueLifetimeLicense, publicLicense, revokeLicense } = await import('./licensing/service.js');
const { load } = await import('./catalog.js');
const { errorHandler, originGuard } = await import('./security.js');
const dbTest = (name, fn) => test(name, { skip: !cleanupDatabase }, fn);
const sha = value => createHash('sha256').update(value).digest();
const slug = 'sofa-abc123abc123';
const dir = mkdtempSync(path.join(tmpdir(), 'licensed-assets-'));
mkdirSync(path.join(dir, 'Furniture'));
writeFileSync(path.join(dir, 'Furniture', 'sofa.rar'), 'NOI-DUNG-GOI');
writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ products: [{
  id: 'abc123abc123', slug, name: 'Sofa', category: 'Furniture', subcategory: 'Sofa', price: 15000,
  asset: { file: 'Furniture/sofa.rar', size: 12, max: [], hasFbx: true, hasObj: false, hasTextures: false, renderers: [] },
}] }));

let server, base;
let storageFetches = 0;
let catalogModel = { id: 'abc123abc123', slug, archiveId: 'private-storage-key', archiveExtension: '.rar', canDownload: true };
before(async () => {
  if (!cleanupDatabase) return;
  await migrate();
  const app = express();
  app.use(express.json({ limit: '10kb' }), originGuard);
  app.use('/api/auth', authRouter);
  app.use('/api/licenses', licenseRouter);
  app.use('/api/devices', deviceRouter);
  app.use('/api/admin/licenses', adminLicenseRouter);
  app.use('/api', assetRouter(load(path.join(dir, 'catalog.json')), dir));
  app.use('/r2-api', assetRouter(null, null, {
    repository: { find: async id => [slug, 'abc123abc123'].includes(id) ? catalogModel : null },
    sendArchive: async (_req, res) => { storageFetches++; res.send('R2-STREAM'); },
  }));
  app.use(errorHandler);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (cleanupDatabase) await cleanupDatabase(pool); else await pool.end();
});

function client() {
  const cookies = new Map();
  const call = async (method, endpoint, body) => {
    const response = await fetch(base + endpoint, { method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) cookies.set(name, value); else cookies.delete(name);
    }
    return response;
  };
  return { call, cookies };
}
async function account() {
  const c = client();
  const response = await c.call('POST', '/api/auth/register', { email: `${randomUUID()}@test.invalid`, password: 'password-fixture-only' });
  assert.equal(response.status, 201);
  return { ...c, user: (await response.json()).user };
}
function machine() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, identity: { deviceId: randomUUID(), publicKey: publicKey.export({ format: 'jwk' }),
    keyProtection: 'SOFTWARE', deviceName: 'HTTP test machine' } };
}
async function activate(c, pc = machine(), purpose = 'ACTIVATE') {
  const challengeResponse = await c.call('POST', '/api/devices/challenge', { ...pc.identity, purpose });
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  const signature = sign('RSA-SHA256', Buffer.from(challenge.message), pc.privateKey).toString('base64');
  const response = await c.call('POST', purpose === 'ACTIVATE' ? '/api/licenses/activate' : '/api/devices/verify', {
    challengeId: challenge.challengeId, signature, ...(purpose === 'ACTIVATE' ? { licenseKey: c.key } : {}),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.match(response.headers.getSetCookie().join(';'), /HttpOnly/);
  assert.ok(!(await response.clone().text()).includes('token'));
  return { pc, result: await response.json() };
}
async function licensed(activateNow = true) {
  const c = await account();
  const license = await issueLifetimeLicense(c.user.id);
  const owner = { ...c, license, key: publicLicense(license, { includeKey: true }).key };
  return activateNow ? { ...owner, ...await activate(owner) } : owner;
}
const ticketResponse = c => c.call('POST', `/api/products/${slug}/import-ticket`, {});
async function ticket(c) {
  const response = await ticketResponse(c);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.assetId, 'abc123abc123');
  assert.match(data.ticket, /^[A-Za-z0-9_-]{43}$/);
  return data.ticket;
}
const stream = value => fetch(`${base}/api/downloads/stream/${value}`);

dbTest('R2 transport authorizes before fetching and redeems one ticket once', async () => {
  const anon = client(), unlicensed = await account(), owner = await licensed();
  const route = `/r2-api/products/${slug}`;
  for (const [c, status] of [[anon,401],[unlicensed,403]]) {
    assert.equal((await c.call('GET', route+'/download')).status,status);
    assert.equal((await c.call('POST', route+'/import-ticket',{})).status,status);
  }
  assert.equal(storageFetches,0);
  const bad=client();bad.cookies.set('sid','invalid.jwt.signature');
  assert.equal((await bad.call('GET',route+'/download')).status,401);
  const issued=await owner.call('POST',route+'/import-ticket',{});
  assert.equal(issued.status,200);
  const value=(await issued.json()).ticket;
  const results=await Promise.all([1,2].map(()=>fetch(`${base}/r2-api/downloads/stream/${value}`)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);
  assert.equal(storageFetches,1);
  const deleted=(await (await owner.call('POST',route+'/import-ticket',{})).json()).ticket;
  catalogModel=null;
  assert.equal((await fetch(`${base}/r2-api/downloads/stream/${deleted}`)).status,404);
  assert.equal(storageFetches,1);
  catalogModel={id:'abc123abc123',slug,canDownload:false};
  assert.equal((await owner.call('POST',route+'/import-ticket',{})).status,403);
  assert.equal((await owner.call('GET',route+'/download')).status,403);
  assert.equal(storageFetches,1);
});

dbTest('download and tickets require login plus licensed device proof', async () => {
  const anon = client(), unlicensed = await account(), owner = await licensed(false);
  for (const [c, status] of [[anon, 401], [unlicensed, 403], [owner, 403]]) {
    assert.equal((await c.call('GET', `/api/products/${slug}/download`)).status, status);
    assert.equal((await ticketResponse(c)).status, status);
  }
  await activate(owner);
  const response = await owner.call('GET', `/api/products/${slug}/download`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /sofa-abc123abc123\.rar/);
  assert.equal(await response.text(), 'NOI-DUNG-GOI');
  assert.equal((await owner.call('GET', '/api/products/missing/download')).status, 404);
});

dbTest('ticket works once; concurrent redemption returns one package only', async () => {
  const c = await licensed(), value = await ticket(c);
  const results = await Promise.all([stream(value), stream(value)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 404]);
  assert.equal(await results.find(r => r.status === 200).text(), 'NOI-DUNG-GOI');
  assert.equal((await stream(value)).status, 404);
  assert.equal((await stream('not-a-real-ticket')).status, 404);
});

dbTest('expired ticket, device session and auth session deny redemption', async () => {
  for (const expire of ['ticket', 'device', 'auth']) {
    const c = await licensed(), value = await ticket(c);
    if (expire === 'ticket') await pool.query("update import_tickets set expires_at=now()-interval '1 second' where id=$1", [sha(value)]);
    if (expire === 'device') await pool.query("update device_sessions set expires_at=now()-interval '1 second' where user_id=$1", [c.user.id]);
    if (expire === 'auth') await pool.query("update sessions set expires_at=now()-interval '1 second' where user_id=$1", [c.user.id]);
    assert.equal((await stream(value)).status, 404);
    if (expire !== 'ticket') assert.notEqual((await ticketResponse(c)).status, 200);
  }
});

dbTest('license revoke after ticket issuance blocks stream and fresh downloads', async () => {
  const c = await licensed(), value = await ticket(c);
  await revokeLicense(c.user.id, c.user.id);
  assert.equal((await stream(value)).status, 404);
  assert.equal((await ticketResponse(c)).status, 403);
  assert.equal((await c.call('GET', `/api/products/${slug}/download`)).status, 403);
});

dbTest('logout invalidates outstanding ticket and device session cookie', async () => {
  const c = await licensed(), value = await ticket(c);
  assert.equal((await c.call('POST', '/api/auth/logout', {})).status, 200);
  assert.equal(c.cookies.has('dsid'), false);
  assert.equal((await stream(value)).status, 404);
  assert.equal((await ticketResponse(c)).status, 401);
});

dbTest('device cookie cannot be borrowed by another account or another auth session', async () => {
  const c = await licensed(), other = await account();
  other.cookies.set('dsid', c.cookies.get('dsid'));
  assert.equal((await ticketResponse(other)).status, 403);
  const relogin = client();
  await relogin.call('POST', '/api/auth/login', { email: c.user.email, password: 'password-fixture-only' });
  relogin.cookies.set('dsid', c.cookies.get('dsid'));
  assert.equal((await ticketResponse(relogin)).status, 403);
  await activate({ ...relogin, key: c.key }, c.pc, 'VERIFY');
  assert.equal((await ticketResponse(relogin)).status, 200);
  assert.equal((await pool.query('select count(*) from license_devices where license_id=$1', [c.license.id])).rows[0].count, '1');
});

dbTest('activated machine does not grant downloads or imports to an account without its own license', async () => {
  const owner = await licensed(), guest = await account(), unrelated = await account();
  guest.cookies.set('dsid', owner.cookies.get('dsid'));
  assert.equal((await ticketResponse(guest)).status, 403, 'a copied cookie is not a machine proof');
  const verified = await activate(guest, owner.pc, 'VERIFY');
  assert.equal(verified.result.license.id, owner.license.id);
  assert.equal(verified.result.license.key, undefined);
  assert.equal(verified.result.license.last4, undefined);
  const deviceSession = await (await guest.call('GET', '/api/devices/session')).json();
  assert.equal(deviceSession.license.id, owner.license.id);
  assert.equal(deviceSession.license.key, undefined);
  assert.equal(deviceSession.license.last4, undefined);
  assert.equal((await (await guest.call('GET', '/api/licenses/me')).json()).license, null);
  assert.deepEqual((await (await guest.call('GET', '/api/licenses/devices')).json()).devices, []);
  assert.equal((await (await owner.call('GET', '/api/licenses/me')).json()).license.key, owner.key);
  const beforeDeniedRequest = storageFetches;
  assert.equal((await guest.call('GET', `/api/products/${slug}/download`)).status, 403);
  assert.equal((await ticketResponse(guest)).status, 403);
  assert.equal(storageFetches, beforeDeniedRequest, 'an account without its own license must not read an archive');

  // A ticket issued before the ownership gate was deployed must also fail closed.
  const oldTicket = randomBytes(32).toString('base64url');
  const legacyDeviceSession = (await pool.query('select auth_session_id,license_id,device_id from device_sessions where user_id=$1', [guest.user.id])).rows[0];
  await pool.query(`insert into import_tickets (id,user_id,product_id,expires_at,auth_session_id,license_id,device_id)
    values ($1,$2,$3,now()+interval '5 minutes',$4,$5,$6)`,
  [sha(oldTicket), guest.user.id, 'abc123abc123', legacyDeviceSession.auth_session_id, legacyDeviceSession.license_id, legacyDeviceSession.device_id]);
  assert.equal((await stream(oldTicket)).status, 404);
  assert.equal(storageFetches, beforeDeniedRequest);
  assert.equal((await pool.query('select count(*) from license_devices where license_id=$1', [owner.license.id])).rows[0].count, '1');
  assert.equal((await pool.query('select count(*) from licenses where user_id=$1', [guest.user.id])).rows[0].count, '0');
  unrelated.cookies.set('dsid', guest.cookies.get('dsid'));
  assert.equal((await ticketResponse(unrelated)).status, 403);
  await guest.call('POST', '/api/auth/logout', {});
  assert.equal((await stream(oldTicket)).status, 404);
  await guest.call('POST', '/api/auth/login', { email: guest.user.email, password: 'password-fixture-only' });
  await activate(guest, owner.pc, 'VERIFY');
  assert.equal((await ticketResponse(guest)).status, 403);
  assert.equal((await guest.call('GET', `/api/products/${slug}/download`)).status, 403);
  await revokeLicense(owner.user.id, owner.user.id);
  assert.equal((await ticketResponse(guest)).status, 403);
  assert.equal((await guest.call('GET', '/api/devices/session')).status, 403);
});

dbTest('cross-account verification requires an existing exact device ID and signing key; activation remains owner-only', async () => {
  const owner = await licensed(), guest = await account();
  const attemptVerify = async pc => {
    const challengeResponse = await guest.call('POST', '/api/devices/challenge', { ...pc.identity, purpose: 'VERIFY' });
    assert.equal(challengeResponse.status, 201);
    const challenge = await challengeResponse.json();
    return guest.call('POST', '/api/devices/verify', { challengeId: challenge.challengeId,
      signature: sign('RSA-SHA256', Buffer.from(challenge.message), pc.privateKey).toString('base64') });
  };
  assert.equal((await attemptVerify(machine())).status, 403);
  const imposter = machine();
  assert.equal((await attemptVerify({ ...imposter, identity: { ...imposter.identity, deviceId: owner.pc.identity.deviceId } })).status, 403);
  assert.equal((await attemptVerify({ ...owner.pc, identity: { ...owner.pc.identity, deviceId: randomUUID() } })).status, 403);
  const forgedChallenge = await guest.call('POST', '/api/devices/challenge', { ...owner.pc.identity, purpose: 'VERIFY' });
  const challenge = await forgedChallenge.json();
  const forged = await guest.call('POST', '/api/devices/verify', { challengeId: challenge.challengeId,
    signature: sign('RSA-SHA256', Buffer.from(challenge.message), imposter.privateKey).toString('base64') });
  assert.equal(forged.status, 403);
  assert.equal((await forged.json()).error, 'INVALID_DEVICE_PROOF');
  const activation = await guest.call('POST', '/api/devices/challenge', { ...owner.pc.identity, purpose: 'ACTIVATE' });
  assert.equal(activation.status, 403);
  assert.equal((await pool.query('select count(*) from license_devices where license_id=$1', [owner.license.id])).rows[0].count, '1');
});

dbTest('admin is server allowlisted; key owner-only; no reset APIs', async () => {
  const regular = await account(), admin = await account(), owner = await account();
  assert.equal((await regular.call('POST', '/api/admin/licenses/issue', { userId: owner.user.id })).status, 403);
  process.env.LICENSE_ADMIN_USER_IDS = admin.user.id;
  try {
    const issued = await admin.call('POST', '/api/admin/licenses/issue', { userId: owner.user.id });
    assert.equal(issued.status, 201);
    assert.equal((await issued.json()).license.key, undefined);
    assert.equal((await admin.call('POST', '/api/admin/licenses/issue', { userId: owner.user.id })).status, 201);
    assert.equal((await pool.query('select count(*) from licenses where user_id=$1', [owner.user.id])).rows[0].count, '1');
    const mine = await owner.call('GET', '/api/licenses/me');
    assert.match(mine.headers.get('cache-control'), /no-store/);
    assert.match((await mine.json()).license.key, /^3DM-/);
    assert.equal((await (await regular.call('GET', '/api/licenses/me')).json()).license, null);
    for (const [method, route] of [['DELETE', '/api/licenses/devices/anything'], ['POST', '/api/devices/reset'], ['POST', '/api/licenses/transfer'], ['POST', '/api/devices/deactivate']]) {
      assert.equal((await owner.call(method, route, {})).status, 404);
    }
  } finally { delete process.env.LICENSE_ADMIN_USER_IDS; }
});
