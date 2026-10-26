import { pool } from '../db.js';
import { publicLicense, publicDevice } from '../licensing/service.js';
import { licenseError, uuid } from '../licensing/errors.js';

const LIMIT = 25;
const licenseColumns = `l.id,l.license_type,l.status,l.key_last4,l.issued_at`;
const userColumns = `u.id as user_id,u.email,u.created_at as user_created_at`;
const orderColumns = `o.id,o.user_id,o.order_code,o.amount_vnd,o.status,o.created_at,o.paid_at,o.fulfillment_result`;
const auditColumns = `a.id,a.event_type,a.license_id,a.created_at,a.details,
  actor.email as actor_email,owner.email as target_email`;
const auditJoins = `from license_audit_logs a left join users actor on actor.id=a.actor_user_id
  left join licenses l on l.id=a.license_id left join users owner on owner.id=l.user_id`;

function pagination(query) {
  const raw = query.page ?? '1';
  if (typeof raw !== 'string' || !/^[1-9]\d{0,5}$/.test(raw)) throw licenseError('INVALID_PAGE');
  const page = Number(raw);
  return { page, offset: (page - 1) * LIMIT };
}

function search(query) {
  const value = query.q ?? '';
  if (typeof value !== 'string' || value.length > 254) throw licenseError('INVALID_SEARCH');
  return `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;
}

const publicOrder = row => ({ id: row.id, userId: row.user_id, email: row.email,
  orderCode: Number(row.order_code), amountVnd: Number(row.amount_vnd), status: row.status,
  createdAt: row.created_at, paidAt: row.paid_at, fulfillmentResult: row.fulfillment_result });
const publicAudit = row => ({ id: String(row.id), eventType: row.event_type, actorEmail: row.actor_email,
  targetEmail: row.target_email, licenseId: row.license_id, createdAt: row.created_at, details: row.details });
const userSummary = row => ({ id: row.user_id, email: row.email, createdAt: row.user_created_at,
  license: row.id ? publicLicense(row) : null, deviceCount: Number(row.device_count || 0) });

export async function overview(catalog) {
  const { rows } = await pool.query(`select
    (select count(*) from users where role='USER') as users,
    (select count(*) from licenses where status='ACTIVE') as active_licenses,
    (select count(*) from orders where status='PAID') as paid_orders,
    (select coalesce(sum(amount_vnd),0) from orders where status='PAID') as revenue_vnd`);
  const row = rows[0];
  return { stats: { users: Number(row.users), activeLicenses: Number(row.active_licenses),
    paidOrders: Number(row.paid_orders), revenueVnd: Number(row.revenue_vnd) }, catalog: await catalog.status() };
}

export async function listUsers(query) {
  const { page, offset } = pagination(query), pattern = search(query);
  const where = `where u.role='USER' and (u.email ilike $1 or u.id::text ilike $1)`;
  const [count, items] = await Promise.all([
    pool.query(`select count(*) from users u ${where}`, [pattern]),
    pool.query(`select ${userColumns},${licenseColumns},
      (select count(*) from license_devices d where d.license_id=l.id) as device_count
      from users u left join licenses l on l.user_id=u.id ${where}
      order by u.created_at desc,u.id limit $2 offset $3`, [pattern, LIMIT, offset]),
  ]);
  return { items: items.rows.map(userSummary), total: Number(count.rows[0].count), page, limit: LIMIT };
}

export async function userDetail(id) {
  const userId = uuid(id, 'INVALID_USER_ID');
  const { rows } = await pool.query(`select ${userColumns},${licenseColumns}
    from users u left join licenses l on l.user_id=u.id where u.id=$1 and u.role='USER'`, [userId]);
  if (!rows[0]) throw licenseError('USER_NOT_FOUND', 404);
  const row = rows[0];
  const [devices, orders, audit] = await Promise.all([
    pool.query('select * from license_devices where license_id=$1 order by slot_number', [row.id || null]),
    pool.query(`select ${orderColumns} from orders o where o.user_id=$1 order by o.created_at desc,o.id desc limit 25`, [userId]),
    pool.query(`select ${auditColumns} ${auditJoins} where l.user_id=$1
      order by a.created_at desc,a.id desc limit 50`, [userId]),
  ]);
  return { user: { id: row.user_id, email: row.email, createdAt: row.user_created_at },
    license: row.id ? publicLicense(row) : null, devices: devices.rows.map(publicDevice),
    orders: orders.rows.map(publicOrder), audit: audit.rows.map(publicAudit) };
}

export async function listOrders(query) {
  const { page, offset } = pagination(query), pattern = search(query), status = query.status || '';
  if (typeof status !== 'string' || !['', 'PENDING', 'PAID', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(status)) {
    throw licenseError('INVALID_ORDER_STATUS');
  }
  const where = `where ($2='' or o.status=$2) and (u.email ilike $1 or o.order_code::text ilike $1 or o.id::text ilike $1)`;
  const [count, items] = await Promise.all([
    pool.query(`select count(*) from orders o join users u on u.id=o.user_id ${where}`, [pattern, status]),
    pool.query(`select ${orderColumns},u.email from orders o join users u on u.id=o.user_id ${where}
      order by o.created_at desc,o.id desc limit $3 offset $4`, [pattern, status, LIMIT, offset]),
  ]);
  return { items: items.rows.map(publicOrder), total: Number(count.rows[0].count), page, limit: LIMIT };
}

export async function listAudit(query) {
  const { page, offset } = pagination(query);
  const [count, items] = await Promise.all([
    pool.query('select count(*) from license_audit_logs'),
    pool.query(`select ${auditColumns} ${auditJoins} order by a.created_at desc,a.id desc limit $1 offset $2`, [LIMIT, offset]),
  ]);
  return { items: items.rows.map(publicAudit), total: Number(count.rows[0].count), page, limit: LIMIT };
}
