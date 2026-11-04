import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from './test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
let dispose, pool, migrate;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('migration_roundtrip');
  ({ pool, migrate } = await import('./db.js'));
  process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
  process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await migrate();
});
after(async () => { if (dispose) await dispose(pool); });
const rollback = name => readFileSync(new URL(`../migrations/rollback/${name}.sql`, import.meta.url), 'utf8');

test('empty license/payment schema rolls back then reapplies; real records block destructive rollback', { skip: !configured }, async () => {
  const client = await pool.connect();
  try {
    for (const name of ['024_single_device_license', '007_payment_checkout', '006_device_identity_scope', '005_licensed_import_tickets', '004_payments', '003_licenses']) await client.query(rollback(name));
    assert.equal((await client.query("select to_regclass('licenses') is null as absent")).rows[0].absent, true);
    assert.equal((await client.query("select to_regclass('users') is not null as preserved")).rows[0].preserved, true);
    assert.deepEqual(await migrate(), ['003_licenses.sql', '004_payments.sql', '005_licensed_import_tickets.sql', '006_device_identity_scope.sql', '007_payment_checkout.sql', '024_single_device_license.sql']);
    const user = (await client.query('insert into users(email,password_hash) values($1,$2) returning id',
      [`${randomUUID()}@test.invalid`, 'fixture'])).rows[0];
    await client.query('insert into orders(user_id,amount_vnd) values($1,1000)', [user.id]);
    await assert.rejects(client.query(rollback('004_payments')), /Rollback refused/);
    await client.query('rollback');
    assert.equal(Number((await client.query('select count(*) from orders')).rows[0].count), 1);
    const { issueLifetimeLicense } = await import('./licensing/service.js');
    await issueLifetimeLicense(user.id);
    await assert.rejects(client.query(rollback('003_licenses')), /Rollback refused/);
    await client.query('rollback');
    assert.equal(Number((await client.query('select count(*) from licenses')).rows[0].count), 1);
  } finally { client.release(); }
});
