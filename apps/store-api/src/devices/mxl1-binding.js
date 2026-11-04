import { apiError } from '../drive/errors.js';

// The caller owns a transaction and has verified both the device signature and MXL1 signature.
// Historical conflicting grants are left untouched; they cannot be used to add a new grant.
export async function bindMxl1(db, { deviceId, deviceUuid, machineCode, licenseId }) {
  for (const lock of [`license:${licenseId}`, `machine:${machineCode}`].sort()) {
    await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lock]);
  }

  const bindings = (await db.query(
    'select license_id, device_id, machine_code from mxl1_bindings where license_id = $1 or device_id = $2 or machine_code = $3',
    [licenseId, deviceId, machineCode])).rows;
  if (bindings.some((b) => b.license_id !== licenseId || b.device_id !== deviceId || b.machine_code !== machineCode)) {
    throw apiError('LEGACY_LICENSE_CONFLICT');
  }

  const existing = (await db.query(
    `select e.device_id, e.mxl1_license_id, d.machine_code
       from entitlements e join devices d on d.id = e.device_id
      where e.source = 'MXL1' and (e.mxl1_license_id = $1 or e.device_id = $2 or d.machine_code = $3)`,
    [licenseId, deviceId, machineCode])).rows;
  const owned = existing.some((e) => e.device_id === deviceId && e.mxl1_license_id === licenseId);
  const conflict = existing.some((e) => e.device_id !== deviceId || e.mxl1_license_id !== licenseId);
  // A historical duplicate may keep using its original entitlement, but cannot reserve or issue another one.
  if (conflict && !owned) throw apiError('LEGACY_LICENSE_CONFLICT');
  if (!bindings.length && !conflict) {
    await db.query('insert into mxl1_bindings (license_id, device_id, machine_code) values ($1, $2, $3)',
      [licenseId, deviceId, machineCode]);
  }
  if (owned) return;

  const granted = await db.query(
    `insert into entitlements (device_id, scope, source, mxl1_license_id)
     values ($1, 'ALL_MODELS', 'MXL1', $2) on conflict do nothing`, [deviceId, licenseId]);
  // An existing ALL_MODELS grant from another source cannot stand in for this
  // licence. Rolling back also rolls back the new binding, so activation never
  // reports success without actually creating the MXL1 entitlement.
  if (!granted.rowCount) throw apiError('LEGACY_LICENSE_CONFLICT');
  await db.query(
    "insert into audit_events (actor_kind, action, target_type, target_id, details) values ('SYSTEM', 'MXL1_GRANTED', 'device', $1, $2)",
    [deviceUuid, JSON.stringify({ licenseId })]);
}
