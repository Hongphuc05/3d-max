// P4.1: dang ky thiet bi (challenge/verify), token thiet bi, quyen so huu, MXL1. PostgreSQL that, khoa RSA that.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { constants, createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const MACHINE = `MAX-${'A1'.repeat(32)}`;
const OTHER_MACHINE = `MAX-${'B2'.repeat(32)}`;
const licenseKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const newKey = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
let dispose, pool, server, base, catId, sourceId, build, requireDevice, loadLegacyPublicKey;
let legacyKey = null;
let fileSeq = 0;

const jwkOf = (k) => { const { kty, n, e } = k.publicKey.export({ format: 'jwk' }); return { kty, n, e }; };
const signMessage = (k, message) => sign('RSA-SHA256', Buffer.from(message, 'utf8'), { key: k.privateKey, padding: constants.RSA_PKCS1_PADDING }).toString('base64');
const hashOf = (k) => createHash('sha256').update(k.publicKey.export({ type: 'spki', format: 'der' })).digest();
const license = (machineCode = MACHINE, licenseId = 'lic-001', key = licenseKeys.privateKey) => {
  const bytes = Buffer.from(JSON.stringify({ version: 1, product: '3dsmood-library', machineCode, licenseId }));
  return `MXL1.${bytes.toString('base64url')}.${sign('RSA-SHA256', bytes, { key, padding: constants.RSA_PKCS1_PADDING }).toString('base64url')}`;
};
const call = (path, { method = 'POST', body, headers = {} } = {}) => fetch(base + path, { method,
  headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const challengeBody = (k, over = {}) => ({ deviceUuid: randomUUID(), publicKey: jwkOf(k), keyProtection: 'SOFTWARE', machineCode: MACHINE, deviceName: 'PC-Test', ...over });
const challenge = async (body) => { const r = await call('/api/v1/device/challenge', { body }); return { r, j: await r.json() }; };
const verifyCall = (body) => call('/api/v1/device/verify', { body });
// Dang ky day du: challenge -> ky -> verify.
async function register(k = newKey(), over = {}, extra = {}) {
  const body = challengeBody(k, over);
  const { j } = await challenge(body);
  const r = await verifyCall({ challengeId: j.challengeId, signature: signMessage(k, j.message), ...extra });
  return { body, k, r, j: await r.json() };
}
const deviceRow = async (uuid) => (await pool.query('select * from devices where device_uuid=$1', [uuid])).rows[0];
const code = async (r) => (await r.json()).error?.code;
async function addModel(name) {
  const id = (await pool.query("insert into models(category_id,name,status,price_vnd,published_at) values($1,$2,'PUBLISHED',15000,now()) returning id", [catId, name])).rows[0].id;
  await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes) values($1,$2,$3,'m.rar','rar',1000)", [id, sourceId, `devFile${++fileSeq}`]);
  return id;
}
const grant = (deviceId, modelId) => pool.query("insert into entitlements(device_id,scope,model_id,source) values($1,'MODEL',$2,'ADMIN')", [deviceId, modelId]);
const auth = (token) => ({ authorization: `Device ${token}` });

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('device_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Living','living','Living') returning id")).rows[0].id;
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','devRootFolder0001','root','MY_DRIVE') returning id")).rows[0].id;
  ({ loadLegacyPublicKey } = await import('./mxl1.js'));
  const mod = await import('./routes.js');
  requireDevice = mod.requireDevice;
  build = (legacy) => {
    const app = express();
    app.use(express.json({ limit: '10kb' }));
    app.use('/api/v1', mod.createDeviceRouter({ pool, legacyPublicKey: legacy }));
    return app;
  };
  legacyKey = loadLegacyPublicKey(licenseKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  await new Promise((r) => { server = build(legacyKey).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  for (const t of ['mxl1_bindings', 'entitlements', 'device_tokens', 'device_auth_challenges', 'devices', 'audit_events']) await pool.query(`delete from ${t}`);
});

test('challenge: valid request returns id, message bound to uuid + key hash, 2 minute expiry; NO device row yet', { skip }, async () => {
  const k = newKey(), body = challengeBody(k);
  const { r, j } = await challenge(body);
  assert.equal(r.status, 200);
  assert.match(j.challengeId, /^[0-9a-f-]{36}$/);
  const parts = j.message.split('|');
  assert.equal(parts.length, 5);
  assert.equal(parts[0], '3DM-DEVICE-V2'); assert.equal(parts[1], j.challengeId); assert.equal(parts[3], body.deviceUuid);
  assert.equal(parts[4], hashOf(k).toString('hex'));
  assert.match(parts[2], /^[A-Za-z0-9_-]{43}$/, 'nonce: 32 bytes base64url, the shape the plugin validates');
  const ms = new Date(j.expiresAt) - Date.now();
  assert.ok(ms > 100_000 && ms <= 121_000, `expiry ${ms}`); // DB and host clocks can differ slightly.
  assert.equal(await deviceRow(body.deviceUuid), undefined, 'not registered before a valid signature');
  assert.equal((await pool.query('select count(*)::int n from device_auth_challenges')).rows[0].n, 1);
});

test('challenge: strict body validation (exact keys, uuid, JWK, protection, machine label, name); nothing stored', { skip }, async () => {
  const k = newKey();
  const ok = challengeBody(k);
  const bads = {
    'extra key': { ...ok, admin: true }, 'missing name': (({ deviceName, ...x }) => x)(ok), 'uuid junk': { ...ok, deviceUuid: 'nope' },
    'protection': { ...ok, keyProtection: 'HSM' }, 'machine lowercase': { ...ok, machineCode: MACHINE.toLowerCase() }, 'machine short': { ...ok, machineCode: 'MAX-abc' },
    'name empty': { ...ok, deviceName: '' }, 'name long': { ...ok, deviceName: 'x'.repeat(121) }, 'name control': { ...ok, deviceName: 'a\nb' }, 'name number': { ...ok, deviceName: 5 },
    'jwk extra': { ...ok, publicKey: { ...ok.publicKey, d: 'x' } }, 'jwk junk': { ...ok, publicKey: { kty: 'RSA', n: 'abc', e: 'AQAB' } },
    'jwk small': { ...ok, publicKey: { kty: 'RSA', n: jwkOf({ publicKey: generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey }).n, e: 'AQAB' } },
    'key string': { ...ok, publicKey: 'abc' }, 'array body': [],
  };
  for (const [name, body] of Object.entries(bads)) {
    const { r, j } = await challenge(body);
    assert.equal(r.status, 400, name); assert.equal(j.error.code, 'INVALID_PARAMS', name);
    assert.ok(j.error.requestId, name);
  }
  assert.equal((await pool.query('select count(*)::int n from device_auth_challenges')).rows[0].n, 0);
});

test('verify: valid signature registers the device, issues a 15 minute token (only its hash stored), audits DEVICE_REGISTERED once', { skip }, async () => {
  const { body, r, j } = await register();
  assert.equal(r.status, 200);
  assert.match(j.deviceToken, /^[A-Za-z0-9_-]{43}$/);
  const ms = new Date(j.expiresAt) - Date.now();
  assert.ok(ms > 14 * 60_000 && ms <= 15 * 60_000 + 1000, `ttl ${ms}`);
  assert.deepEqual(j.entitlements, { allModels: false, modelIds: [] });
  const dev = await deviceRow(body.deviceUuid);
  assert.equal(dev.status, 'ACTIVE'); assert.equal(dev.machine_code, MACHINE); assert.equal(dev.device_name, 'PC-Test'); assert.equal(dev.key_protection, 'SOFTWARE');
  const stored = (await pool.query('select id from device_tokens')).rows;
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].id, createHash('sha256').update(j.deviceToken).digest(), 'DB keeps only the hash');
  assert.equal(JSON.stringify(stored).includes(j.deviceToken), false);
  const events = (await pool.query("select * from audit_events where action='DEVICE_REGISTERED'")).rows;
  assert.equal(events.length, 1); assert.equal(events[0].actor_kind, 'SYSTEM');
});

test('verify: the same device logs in again with a new token, no second registration audit', { skip }, async () => {
  const k = newKey();
  const first = await register(k);
  const second = await register(k, { deviceUuid: first.body.deviceUuid, deviceName: 'Renamed' });
  assert.equal(second.r.status, 200);
  assert.notEqual(second.j.deviceToken, first.j.deviceToken);
  assert.equal((await pool.query('select count(*)::int n from devices')).rows[0].n, 1);
  assert.equal((await pool.query("select count(*)::int n from audit_events where action='DEVICE_REGISTERED'")).rows[0].n, 1);
  assert.equal((await deviceRow(first.body.deviceUuid)).device_name, 'Renamed');
});

test('verify: a challenge works once (replay refused), expired refused, unknown refused', { skip }, async () => {
  const k = newKey(), body = challengeBody(k), { j } = await challenge(body);
  const signature = signMessage(k, j.message);
  assert.equal((await verifyCall({ challengeId: j.challengeId, signature })).status, 200);
  const replay = await verifyCall({ challengeId: j.challengeId, signature });
  assert.equal(replay.status, 403); assert.equal(await code(replay), 'CHALLENGE_INVALID');
  const e = await challenge(body);
  await pool.query("update device_auth_challenges set expires_at = now() - interval '1 second', created_at = now() - interval '1 minute' where id=$1", [e.j.challengeId]);
  assert.equal(await code(await verifyCall({ challengeId: e.j.challengeId, signature: signMessage(k, e.j.message) })), 'CHALLENGE_INVALID');
  assert.equal(await code(await verifyCall({ challengeId: randomUUID(), signature })), 'CHALLENGE_INVALID');
  assert.equal(await code(await verifyCall({ challengeId: 'not-a-uuid', signature })), 'INVALID_PARAMS');
});

test('verify: signature by another key or a tampered one is refused, burns the challenge, registers nothing', { skip }, async () => {
  const k = newKey(), other = newKey();
  for (const make of [(j) => signMessage(other, j.message), (j) => signMessage(k, j.message + 'x'), (j) => { const s = signMessage(k, j.message); return `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`; }]) {
    const body = challengeBody(k), { j } = await challenge(body);
    const r = await verifyCall({ challengeId: j.challengeId, signature: make(j) });
    assert.equal(r.status, 403); assert.equal(await code(r), 'SIGNATURE_INVALID');
    assert.equal(await deviceRow(body.deviceUuid), undefined);
    assert.equal(await code(await verifyCall({ challengeId: j.challengeId, signature: signMessage(k, j.message) })), 'CHALLENGE_INVALID', 'a failed attempt burns the challenge');
  }
  assert.equal((await pool.query('select count(*)::int n from device_tokens')).rows[0].n, 0);
});

test('verify: strict body (exact keys, signature must be a string)', { skip }, async () => {
  const k = newKey(), { j } = await challenge(challengeBody(k));
  for (const body of [{ challengeId: j.challengeId }, { signature: 'x' }, { challengeId: j.challengeId, signature: 5 }, { challengeId: j.challengeId, signature: 'x', extra: 1 }, []]) {
    assert.equal(await code(await verifyCall(body)), 'INVALID_PARAMS', JSON.stringify(body));
  }
  // Challenge chua bi tieu thu boi cac yeu cau sai dinh dang.
  assert.equal((await verifyCall({ challengeId: j.challengeId, signature: signMessage(k, j.message) })).status, 200);
});

test('key identity: uuid with another key, and key under another uuid, are refused at challenge and at verify', { skip }, async () => {
  const k = newKey(), first = await register(k);
  const intruder = newKey();
  // Cung uuid, khoa khac.
  const a = await challenge(challengeBody(intruder, { deviceUuid: first.body.deviceUuid }));
  assert.equal(a.r.status, 403); assert.equal(a.j.error.code, 'DEVICE_KEY_MISMATCH');
  // Cung khoa, uuid khac.
  const b = await challenge(challengeBody(k));
  assert.equal(b.r.status, 403); assert.equal(b.j.error.code, 'DEVICE_KEY_MISMATCH');
  assert.equal((await pool.query('select count(*)::int n from devices')).rows[0].n, 1);
  // Giua challenge va verify: nguoi khac dang ky mat uuid/khoa nay -> verify van phai tu choi.
  const uuid = randomUUID(), k2 = newKey(), c = await challenge(challengeBody(k2, { deviceUuid: uuid }));
  await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values($1,'{}',$2,'SOFTWARE',$3,'x')", [uuid, hashOf(newKey()), MACHINE]);
  const v = await verifyCall({ challengeId: c.j.challengeId, signature: signMessage(k2, c.j.message) });
  assert.equal(v.status, 403); assert.equal(await code(v), 'DEVICE_KEY_MISMATCH');
  // Khoa nay duoc dang ky duoi uuid khac giua challenge va verify (vi pham unique tren khoa).
  const k3 = newKey(), c3 = await challenge(challengeBody(k3));
  await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values($1,'{}',$2,'SOFTWARE',$3,'y')", [randomUUID(), hashOf(k3), MACHINE]);
  const v3 = await verifyCall({ challengeId: c3.j.challengeId, signature: signMessage(k3, c3.j.message) });
  assert.equal(v3.status, 403); assert.equal(await code(v3), 'DEVICE_KEY_MISMATCH');
});

test('verify: legacyLicense must be a string when present (malformed request, unlike a bad licence which is ignored)', { skip }, async () => {
  const k = newKey(), { j } = await challenge(challengeBody(k));
  assert.equal(await code(await verifyCall({ challengeId: j.challengeId, signature: signMessage(k, j.message), legacyLicense: 5 })), 'INVALID_PARAMS');
});

test('blocked device: refused at challenge, and between challenge and verify; its tokens stop working', { skip }, async () => {
  const k = newKey(), first = await register(k);
  const mid = await challenge(challengeBody(k, { deviceUuid: first.body.deviceUuid }));
  assert.equal(mid.r.status, 200);
  await pool.query("update devices set status='BLOCKED' where device_uuid=$1", [first.body.deviceUuid]);
  const v = await verifyCall({ challengeId: mid.j.challengeId, signature: signMessage(k, mid.j.message) });
  assert.equal(v.status, 403); assert.equal(await code(v), 'DEVICE_BLOCKED');
  const c = await challenge(challengeBody(k, { deviceUuid: first.body.deviceUuid }));
  assert.equal(c.r.status, 403); assert.equal(c.j.error.code, 'DEVICE_BLOCKED');
  assert.equal((await call('/api/v1/me/entitlements', { method: 'GET', headers: auth(first.j.deviceToken) })).status, 401, 'old token of a blocked device');
});

test('registration race: the same device registering twice in parallel yields one devices row', { skip }, async () => {
  const k = newKey(), body = challengeBody(k);
  const [a, b] = await Promise.all([challenge(body), challenge(body)]);
  const results = await Promise.all([a, b].map(({ j }) => verifyCall({ challengeId: j.challengeId, signature: signMessage(k, j.message) })));
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal((await pool.query('select count(*)::int n from devices where device_uuid=$1', [body.deviceUuid])).rows[0].n, 1);
  assert.equal((await pool.query("select count(*)::int n from audit_events where action='DEVICE_REGISTERED'")).rows[0].n, 1);
});

test('MXL1: a valid licence grants ALL_MODELS idempotently; invalid licences fail closed', { skip }, async () => {
  const k = newKey();
  const first = await register(k, {}, { legacyLicense: license() });
  assert.equal(first.r.status, 200);
  assert.deepEqual(first.j.entitlements, { allModels: true, modelIds: [] });
  const row = (await pool.query("select * from entitlements where source='MXL1'")).rows;
  assert.equal(row.length, 1); assert.equal(row[0].scope, 'ALL_MODELS'); assert.equal(row[0].mxl1_license_id, 'lic-001'); assert.equal(row[0].model_id, null);
  const again = await register(k, { deviceUuid: first.body.deviceUuid }, { legacyLicense: license() });
  assert.equal(again.j.entitlements.allModels, true);
  assert.equal((await pool.query("select count(*)::int n from entitlements where source='MXL1'")).rows[0].n, 1, 'idempotent');
  assert.equal((await pool.query("select count(*)::int n from audit_events where action='MXL1_GRANTED'")).rows[0].n, 1);
  // Admin da thu hoi quyen MXL1: dang nhap lai voi cung license khong cap lai.
  await pool.query("update entitlements set revoked_at = now() where source = 'MXL1'");
  const revoked = await register(k, { deviceUuid: first.body.deviceUuid }, { legacyLicense: license() });
  assert.equal(revoked.j.entitlements.allModels, false, 'a revoked MXL1 right is not re-granted by the same licence');
  assert.equal((await pool.query("select count(*)::int n from entitlements where source='MXL1'")).rows[0].n, 1);
  await pool.query("update entitlements set revoked_at = null where source = 'MXL1'");
  const wrong = { 'other machine': license(OTHER_MACHINE), 'foreign signer': license(MACHINE, 'x', newKey().privateKey), 'junk': 'MXL1.a.b', 'empty': '' };
  for (const [name, legacyLicense] of Object.entries(wrong)) {
    const x = await register(newKey(), {}, { legacyLicense });
    assert.equal(x.r.status, 403, name);
    assert.equal(x.j.error.code, 'LEGACY_LICENSE_INVALID', name);
  }
  assert.equal((await pool.query("select count(*)::int n from entitlements where source='MXL1'")).rows[0].n, 1);
});

test('MXL1: missing server verification key refuses activation', { skip }, async () => {
  const s = build(null).listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  try {
    const k = newKey(), url = `http://127.0.0.1:${s.address().port}/api/v1/device`;
    const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const c = await post('/challenge', challengeBody(k));
    const v = await post('/verify', { challengeId: c.challengeId, signature: signMessage(k, c.message), legacyLicense: license() });
    assert.equal(v.error.code, 'LEGACY_LICENSE_INVALID');
  } finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

test('MXL1 first binding is one key per device and one key per machine even under concurrent requests', { skip }, async () => {
  const a = newKey(), b = newKey();
  const bodies = [challengeBody(a), challengeBody(b)];
  const challenges = await Promise.all(bodies.map(challenge));
  const responses = await Promise.all(challenges.map(({ j }, i) => verifyCall({
    challengeId: j.challengeId, signature: signMessage([a, b][i], j.message), legacyLicense: license(),
  })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await pool.query('select count(*)::int n from mxl1_bindings')).rows[0].n, 1);
  assert.equal((await pool.query("select count(*)::int n from entitlements where source='MXL1'")).rows[0].n, 1);
  const winner = responses[0].status === 200 ? 0 : 1;
  const duplicate = await register([a, b][winner], { deviceUuid: bodies[winner].deviceUuid }, { legacyLicense: license(MACHINE, 'another') });
  assert.equal(duplicate.r.status, 409);
  assert.equal(duplicate.j.error.code, 'LEGACY_LICENSE_CONFLICT');
  const anotherDevice = await register(newKey(), {}, { legacyLicense: license(MACHINE, 'third') });
  assert.equal(anotherDevice.r.status, 409);
});

test('historical duplicated MXL1 grants remain usable, including revoked grants, without granting a third device', { skip }, async () => {
  const a = await register(), b = await register();
  const da = await deviceRow(a.body.deviceUuid), db = await deviceRow(b.body.deviceUuid);
  for (const device of [da, db]) await pool.query(
    "insert into entitlements(device_id,scope,source,mxl1_license_id) values($1,'ALL_MODELS','MXL1','lic-001')", [device.id]);
  await pool.query('update entitlements set revoked_at=now() where device_id=$1', [db.id]);
  const aAgain = await register(a.k, { deviceUuid: a.body.deviceUuid }, { legacyLicense: license() });
  const bAgain = await register(b.k, { deviceUuid: b.body.deviceUuid }, { legacyLicense: license() });
  assert.equal(aAgain.j.entitlements.allModels, true);
  assert.equal(bAgain.j.entitlements.allModels, false);
  const c = await register(newKey(), {}, { legacyLicense: license() });
  assert.equal(c.r.status, 409);
  assert.equal((await pool.query('select count(*)::int n from mxl1_bindings')).rows[0].n, 0);
});

test('MXL1 activation refuses another active full-library grant instead of binding without its own grant', { skip }, async () => {
  const client = await register();
  const device = await deviceRow(client.body.deviceUuid);
  await pool.query("insert into entitlements(device_id,scope,source) values($1,'ALL_MODELS','ADMIN')", [device.id]);
  const denied = await register(client.k, { deviceUuid: client.body.deviceUuid }, { legacyLicense: license() });
  assert.equal(denied.r.status, 409);
  assert.equal(denied.j.error.code, 'LEGACY_LICENSE_CONFLICT');
  assert.equal((await pool.query('select count(*)::int n from mxl1_bindings')).rows[0].n, 0);
  await pool.query("update entitlements set revoked_at = now() where device_id=$1 and source='ADMIN'", [device.id]);
  const accepted = await register(client.k, { deviceUuid: client.body.deviceUuid }, { legacyLicense: license() });
  assert.equal(accepted.r.status, 200);
  assert.equal(accepted.j.entitlements.allModels, true);
  assert.equal((await pool.query("select count(*)::int n from entitlements where device_id=$1 and source='MXL1' and revoked_at is null", [device.id])).rows[0].n, 1);
});

test('a bound or historically MXL1-licensed device cannot silently change its machine code', { skip }, async () => {
  const current = await register(newKey(), {}, { legacyLicense: license() });
  const changed = await register(current.k, { deviceUuid: current.body.deviceUuid, machineCode: OTHER_MACHINE });
  assert.equal(changed.r.status, 409);
  assert.equal((await deviceRow(current.body.deviceUuid)).machine_code, MACHINE);
  await pool.query('delete from mxl1_bindings'); // simulate an entitlement created before this migration
  const historical = await register(current.k, { deviceUuid: current.body.deviceUuid, machineCode: OTHER_MACHINE });
  assert.equal(historical.r.status, 409);
  assert.equal((await deviceRow(current.body.deviceUuid)).machine_code, MACHINE);
});

test('requireDevice: only a live token of an active device passes; every other case is a v3 401', { skip }, async () => {
  const { j } = await register();
  const get = (headers) => call('/api/v1/me/entitlements', { method: 'GET', headers });
  const ok = await get(auth(j.deviceToken));
  assert.equal(ok.status, 200);
  const cases = {
    'no header': {}, 'bearer scheme': { authorization: `Bearer ${j.deviceToken}` }, 'lowercase scheme': { authorization: `device ${j.deviceToken}` },
    'unknown token': auth('A'.repeat(43)), 'short token': auth(j.deviceToken.slice(1)), 'long token': auth(j.deviceToken + 'A'), 'junk chars': auth('!'.repeat(43)), 'empty': { authorization: 'Device ' },
  };
  for (const [name, headers] of Object.entries(cases)) {
    const r = await get(headers);
    assert.equal(r.status, 401, name);
    const e = (await r.json()).error;
    assert.equal(e.code, 'UNAUTHENTICATED', name); assert.ok(e.requestId, name);
  }
  await pool.query("update device_tokens set expires_at = now() - interval '1 second', created_at = now() - interval '1 minute'");
  assert.equal((await get(auth(j.deviceToken))).status, 401, 'expired');
  const fresh = await register();
  await pool.query('update device_tokens set revoked_at = now() where id = $1', [createHash('sha256').update(fresh.j.deviceToken).digest()]);
  assert.equal((await get(auth(fresh.j.deviceToken))).status, 401, 'revoked');
});

test('requireDevice exported middleware sets req.device and rejects with the v3 envelope', { skip }, async () => {
  const { j, body } = await register();
  const app = express();
  app.get('/probe', requireDevice(pool), (req, res) => res.json({ uuid: req.device.deviceUuid, id: typeof req.device.id }));
  app.use(await import('../drive/errors.js').then((m) => m.v3ErrorHandler));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  try {
    const url = `http://127.0.0.1:${s.address().port}/probe`;
    const good = await (await fetch(url, { headers: auth(j.deviceToken) })).json();
    assert.deepEqual(good, { uuid: body.deviceUuid, id: 'string' });
    assert.equal((await fetch(url)).status, 401);
  } finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

test('entitlements: only this device\'s active rights are listed; revoked and other devices\' are not', { skip }, async () => {
  const a = await register(), b = await register();
  const [m1, m2, m3] = [await addModel('M1'), await addModel('M2'), await addModel('M3')];
  const idA = (await deviceRow(a.body.deviceUuid)).id, idB = (await deviceRow(b.body.deviceUuid)).id;
  await grant(idA, m1); await grant(idA, m2); await grant(idB, m3);
  await pool.query("update entitlements set revoked_at = now() where device_id=$1 and model_id=$2", [idA, m2]);
  const list = async (t) => (await call('/api/v1/me/entitlements', { method: 'GET', headers: auth(t) })).json();
  assert.deepEqual(await list(a.j.deviceToken), { allModels: false, modelIds: [m1] });
  assert.deepEqual(await list(b.j.deviceToken), { allModels: false, modelIds: [m3] });
  await pool.query("insert into entitlements(device_id,scope,source) values($1,'ALL_MODELS','ADMIN')", [idA]);
  assert.deepEqual(await list(a.j.deviceToken), { allModels: true, modelIds: [m1] });
});
