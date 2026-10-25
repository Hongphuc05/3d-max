import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, generateKeyPairSync, sign } from 'node:crypto';

const configured = Boolean(process.env.TEST_DATABASE_URL);
let pool, service, devices, crypto, migrate;
before(async () => {
  if (!configured) return;
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))) throw new Error('Requires isolated test database name containing test');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
  process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  ({ pool, migrate } = await import('../db.js'));
  service = await import('./service.js');
  devices = await import('./devices.js');
  crypto = await import('./crypto.js');
  await migrate();
});
after(async () => { if (pool) await pool.end(); });
const dbTest = (name, fn) => test(name, { skip: !configured }, fn);

async function account() {
  const user = (await pool.query('insert into users(email,password_hash) values($1,$2) returning *',
    [`license-${randomUUID()}@test.invalid`, 'fixture-not-loginable'])).rows[0];
  const sessionId = randomBytes(32);
  await pool.query("insert into sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [sessionId,user.id]);
  return { userId: user.id, sessionId };
}
async function licensed() {
  const user = await account();
  const row = await service.issueLifetimeLicense(user.userId);
  return { ...user, license: row, key: service.publicLicense(row, { includeKey: true }).key };
}
function machine() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { deviceId: randomUUID(), publicKey: keys.publicKey.export({ format: 'jwk' }), privateKey: keys.privateKey,
    deviceName: 'Test Windows', keyProtection: 'SOFTWARE' };
}
async function proof(user, pc, purpose = 'ACTIVATE') {
  const { privateKey, ...identity } = pc;
  const challenge = await devices.createDeviceChallenge(user.userId, user.sessionId, { ...identity, purpose });
  const signature = sign('RSA-SHA256', Buffer.from(challenge.message, 'utf8'), privateKey).toString('base64');
  return { challengeId: challenge.challengeId, signature, ...(purpose === 'ACTIVATE' ? { licenseKey: user.key } : {}) };
}
const activate = async (user, pc) => devices.activateDevice(user.userId, user.sessionId, await proof(user, pc));

dbTest('issuance is idempotent under concurrency, bound to account, authenticated encrypted', async () => {
  const user = await account();
  const rows = await Promise.all(Array.from({ length: 5 }, () => service.issueLifetimeLicense(user.userId)));
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
  const key = service.publicLicense(rows[0], { includeKey: true }).key;
  assert.equal((await service.verifyLicenseOwnership(user.userId, key.toLowerCase())).id, rows[0].id);
  await assert.rejects(service.verifyLicenseOwnership(user.userId, crypto.generateLicenseKey()), { code: 'INVALID_LICENSE_KEY' });
  const other = await licensed();
  await assert.rejects(service.verifyLicenseOwnership(other.userId, key), { code: 'INVALID_LICENSE_KEY' });
  const input = { ...await proof(other, machine()), licenseKey: key };
  await assert.rejects(devices.activateDevice(other.userId, other.sessionId, input), { code: 'INVALID_LICENSE_KEY' });
  assert.equal((await service.getActivatedDevices(other.userId)).length, 0);
});

dbTest('two permanent slots, third denied, existing device verifies without license key', async () => {
  const user = await licensed(), pc1 = machine(), pc2 = machine();
  const one = await activate(user, pc1);
  assert.equal(one.device.slotNumber, 1);
  assert.equal((await activate(user, pc2)).device.slotNumber, 2);
  await assert.rejects(activate(user, machine()), { code: 'DEVICE_LIMIT_REACHED' });
  assert.equal((await activate(user, pc1)).device.id, one.device.id);
  const verified = await devices.verifyDevice(user.userId, user.sessionId, await proof(user, pc1, 'VERIFY'));
  assert.equal(verified.device.id, one.device.id);
  assert.equal((await service.getActivatedDevices(user.userId)).length, 2);
  assert.equal((await devices.getDeviceSession(user.userId, user.sessionId, verified.token)).license.status, 'ACTIVE');
  await assert.rejects(devices.getDeviceSession(user.userId, user.sessionId, one.token), { code: 'DEVICE_SESSION_INVALID' });
});

dbTest('simultaneous contenders cannot take a third slot', async () => {
  const user = await licensed();
  await activate(user, machine());
  const outcomes = await Promise.allSettled([activate(user, machine()), activate(user, machine()), activate(user, machine())]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.ok(outcomes.filter(item => item.status === 'rejected').every(item => item.reason.code === 'DEVICE_LIMIT_REACHED'));
  assert.equal((await service.getActivatedDevices(user.userId)).length, 2);
});

dbTest('one Windows identity can use independently owned licenses without transferring a slot', async () => {
  const first = await licensed(), second = await licensed(), pc = machine();
  await activate(first, pc);
  await assert.rejects(devices.activateDevice(second.userId, second.sessionId,
    { ...await proof(second, pc), licenseKey: first.key }), { code: 'INVALID_LICENSE_KEY' });
  await activate(second, pc);
  const restored = await devices.verifyDevice(second.userId, second.sessionId, await proof(second, pc, 'VERIFY'));
  assert.equal(restored.license.id, second.license.id, 'prefer the signed-in owner binding when several licenses share this machine');
  assert.equal((await service.getActivatedDevices(first.userId)).length, 1);
  assert.equal((await service.getActivatedDevices(second.userId)).length, 1);
  await assert.rejects(activate(second, { ...pc, deviceId: randomUUID() }), { code: 'DEVICE_IDENTITY_ALREADY_BOUND' });
});

dbTest('spoofed device ID/new key and reused key/new ID cannot bypass permanent bindings', async () => {
  const user = await licensed(), pc = machine();
  await activate(user, pc);
  await assert.rejects(activate(user, { ...machine(), deviceId: pc.deviceId }), { code: 'DEVICE_KEY_MISMATCH' });
  await assert.rejects(activate(user, { ...pc, deviceId: randomUUID() }), { code: 'DEVICE_IDENTITY_ALREADY_BOUND' });
  assert.equal((await service.getActivatedDevices(user.userId)).length, 1);
});

dbTest('bad signature burns nonce; used, expired and wrong-session challenges reject', async () => {
  const user = await licensed(), pc = machine();
  const bad = await proof(user, pc);
  const attacker = machine();
  await assert.rejects(devices.activateDevice(user.userId, user.sessionId,
    { ...bad, signature: sign('RSA-SHA256', Buffer.from('wrong-message'), attacker.privateKey).toString('base64') }), { code: 'INVALID_DEVICE_PROOF' });
  await assert.rejects(devices.activateDevice(user.userId, user.sessionId, bad), { code: 'INVALID_OR_USED_CHALLENGE' });
  const expired = await proof(user, pc);
  await pool.query("update device_challenges set expires_at=now()-interval '1 second' where id=$1", [expired.challengeId]);
  await assert.rejects(devices.activateDevice(user.userId, user.sessionId, expired), { code: 'CHALLENGE_EXPIRED' });
  const input = await proof(user, pc);
  await assert.rejects(devices.activateDevice(user.userId, randomBytes(32), input), { code: 'INVALID_OR_USED_CHALLENGE' });
  await devices.activateDevice(user.userId, user.sessionId, input);
  await assert.rejects(devices.activateDevice(user.userId, user.sessionId, input), { code: 'INVALID_OR_USED_CHALLENGE' });
});

dbTest('revoke invalidates sessions and blocks subsequent proof; no second license', async () => {
  const user = await licensed(), pc = machine();
  const active = await activate(user, pc);
  const pending = await proof(user, pc, 'VERIFY');
  await service.revokeLicense(user.userId, user.userId);
  await assert.rejects(devices.verifyDevice(user.userId, user.sessionId, pending), { code: 'LICENSE_REVOKED' });
  await assert.rejects(devices.getDeviceSession(user.userId, user.sessionId, active.token), { code: 'DEVICE_SESSION_INVALID' });
  const afterRevocation = await proof(user, pc, 'VERIFY');
  await assert.rejects(devices.verifyDevice(user.userId, user.sessionId, afterRevocation), { code: 'LICENSE_REVOKED' });
  assert.equal((await service.issueLifetimeLicense(user.userId)).id, user.license.id);
  assert.equal((await service.getLicenseByAccount(user.userId)).status, 'REVOKED');
});

dbTest('caller transaction rollback removes issued license and its audit record atomically', async () => {
  const user = await account(), client = await pool.connect();
  try {
    await client.query('begin');
    const row = await service.issueLifetimeLicense(user.userId, null, client);
    assert.ok(row.id);
    await client.query('rollback');
    assert.equal(await service.getLicenseByAccount(user.userId), null);
    assert.equal((await pool.query('select 1 from license_audit_logs where license_id=$1', [row.id])).rowCount, 0);
  } finally { client.release(); }
});

dbTest('device sessions are bound to auth session, account and auth expiry', async () => {
  const user = await licensed(), other = await account(), pc = machine();
  const result = await activate(user, pc);
  await assert.rejects(devices.getDeviceSession(other.userId, other.sessionId, result.token), { code: 'DEVICE_SESSION_INVALID' });
  await assert.rejects(devices.getDeviceSession(user.userId, randomBytes(32), result.token), { code: 'DEVICE_SESSION_INVALID' });
  await pool.query('delete from sessions where id=$1', [user.sessionId]);
  await assert.rejects(devices.getDeviceSession(user.userId, user.sessionId, result.token), { code: 'DEVICE_SESSION_INVALID' });
});

dbTest('database rejects identity mutation/deletion, slot3, duplicate user license', async () => {
  const user = await licensed(), result = await activate(user, machine());
  await assert.rejects(pool.query('update license_devices set device_id=$2 where id=$1', [result.device.id,randomUUID()]), { code: '23514' });
  await assert.rejects(pool.query('delete from license_devices where id=$1', [result.device.id]), { code: '23514' });
  await assert.rejects(pool.query('update licenses set user_id=$2 where id=$1', [user.license.id,(await account()).userId]), { code: '23514' });
  await assert.rejects(pool.query('delete from licenses where id=$1', [user.license.id]), { code: '23514' });
  const pc = machine(), parsed = (await import('./device-crypto.js')).validatedPublicKey(pc.publicKey);
  await assert.rejects(pool.query(`insert into license_devices(license_id,slot_number,device_id,device_public_key,public_key_hash,device_name,key_protection)
    values($1,3,$2,$3,$4,'test','SOFTWARE')`, [user.license.id,pc.deviceId,parsed.pem,parsed.hash]), { code: '23514' });
  const key = crypto.generateLicenseKey(), enc = crypto.encryptLicenseKey(key,user.userId);
  await assert.rejects(pool.query(`insert into licenses(user_id,key_hash,key_ciphertext,key_iv,key_auth_tag,key_last4)
    values($1,$2,$3,$4,$5,$6)`, [user.userId,crypto.hashLicenseKey(key),enc.key_ciphertext,enc.key_iv,enc.key_auth_tag,key.slice(-4)]), { code: '23505' });
});
