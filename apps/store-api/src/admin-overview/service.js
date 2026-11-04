// Trang "Tong quan" admin: so lieu doanh thu/don/license/catalog + suc khoe he thong. Chi doc DB, khong doi schema.
// Doanh thu = purchase_orders.status 'CONFIRMED' (decided_at, fallback created_at), ngay theo Asia/Ho_Chi_Minh.
import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { loadTelegramConfig } from '../telegram/config.js';
import { buildWebhookUrl } from '../telegram/setup.js';
import { loadDownloadConfig } from '../downloads/config.js';

const TTL = 60_000;
const DAY = "(coalesce(o.decided_at, o.created_at) at time zone 'Asia/Ho_Chi_Minh')::date";
const TODAY = "(now() at time zone 'Asia/Ho_Chi_Minh')::date";

export function createOverviewService({ pool, env = process.env, fetchImpl = fetch, now = () => Date.now(), diskStat = statfs }) {
  let tg = null; // { at, value } cache 60s
  const config = () => loadTelegramConfig(env);

  async function overview() {
    const [rev, daily, ord, lic, cat, sync] = await Promise.all([
      pool.query(`select coalesce(sum(amount_vnd) filter (where ${DAY} = ${TODAY}),0)::bigint as today,
        coalesce(sum(amount_vnd) filter (where date_trunc('month', ${DAY}) = date_trunc('month', ${TODAY})),0)::bigint as month,
        coalesce(sum(amount_vnd),0)::bigint as total from purchase_orders o where o.status = 'CONFIRMED'`),
      pool.query(`select to_char(d, 'YYYY-MM-DD') date, coalesce(sum(o.amount_vnd),0)::bigint amount
        from generate_series(${TODAY} - 29, ${TODAY}, interval '1 day') d
        left join purchase_orders o on o.status = 'CONFIRMED' and ${DAY} = d::date
        group by d order by d`),
      pool.query(`select count(*) filter (where status = 'AWAITING_OWNER')::int awaiting, count(*) filter (where status = 'PENDING_PAYMENT')::int pending from purchase_orders`),
      pool.query(`select (select count(distinct device_id) from entitlements where revoked_at is null)::int active,
        (select count(*) from devices where first_seen_at > now() - interval '7 days')::int new7`),
      pool.query("select count(*)::int n from models where status = 'PUBLISHED'"),
      pool.query('select status, finished_at, error_code from drive_sync_jobs where finished_at is not null order by finished_at desc limit 1'),
    ]);
    const s = sync.rows[0];
    return {
      revenue: { today: Number(rev.rows[0].today), month: Number(rev.rows[0].month), total: Number(rev.rows[0].total),
        daily: daily.rows.map((r) => ({ date: r.date, amountVnd: Number(r.amount) })) },
      orders: { awaitingConfirm: ord.rows[0].awaiting, pending: ord.rows[0].pending },
      licenses: { activeDevices: lic.rows[0].active, newDevices7d: lic.rows[0].new7 },
      catalog: { models: cat.rows[0].n, lastSync: s ? { status: s.status, finishedAt: s.finished_at, errorCode: s.error_code } : null },
    };
  }

  async function tgCall(token, method) {
    try {
      const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(5000) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) return { error: r.status === 401 ? 'TOKEN_INVALID' : 'TELEGRAM_API' };
      return { result: d.result };
    } catch { return { error: 'TELEGRAM_UNREACHABLE' }; }
  }

  async function telegram() {
    if (tg && now() - tg.at < TTL) return tg.value;
    const c = config();
    let value = { configured: c.enabled, botOk: false, botUsername: null, webhookUrl: null, webhookMatches: false, pendingUpdates: null, lastErrorMessage: null, lastErrorDate: null };
    if (!c.enabled) value.error = c.errors.length ? 'CONFIG_INVALID' : 'NOT_CONFIGURED';
    else {
      const me = await tgCall(c.botToken, 'getMe');
      if (me.error) value.error = me.error;
      else {
        value.botOk = true; value.botUsername = me.result.username ?? null;
        const w = await tgCall(c.botToken, 'getWebhookInfo');
        if (w.error) value.error = w.error;
        else {
          let expected = null;
          try { expected = buildWebhookUrl(env.TELEGRAM_WEBHOOK_BASE_URL, c.webhookPath); } catch { /* chua dat base url */ }
          // Duong dan webhook la bi mat: chi tra origin.
          let origin = null; try { origin = w.result.url ? new URL(w.result.url).origin : null; } catch { /* url la */ }
          value = { ...value, webhookUrl: origin, webhookMatches: Boolean(expected) && w.result.url === expected,
            pendingUpdates: w.result.pending_update_count ?? 0,
            lastErrorMessage: w.result.last_error_message ? String(w.result.last_error_message).slice(0, 200) : null,
            lastErrorDate: w.result.last_error_date ? new Date(w.result.last_error_date * 1000).toISOString() : null };
        }
      }
    }
    tg = { at: now(), value };
    return value;
  }

  async function dirBytes(dir) {
    let bytes = 0;
    for (const name of await readdir(dir).catch(() => [])) if (name.endsWith('.bin')) bytes += (await stat(path.join(dir, name)).catch(() => null))?.size ?? 0;
    return bytes;
  }

  async function newestFile(dir) {
    if (!dir) return null;
    let best = 0;
    for (const name of await readdir(dir).catch(() => [])) { const s = await stat(path.join(dir, name)).catch(() => null); if (s?.isFile() && s.mtimeMs > best) best = s.mtimeMs; }
    return best ? new Date(best).toISOString() : null;
  }

  async function health() {
    const dl = loadDownloadConfig(env);
    const storage = env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../../storage');
    const [telegramInfo, disk, cacheBytes, backupAt, db] = await Promise.all([
      telegram(),
      diskStat(storage).then((s) => ({ freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }), () => ({ freeBytes: null, totalBytes: null })),
      dirBytes(dl.cacheDir),
      newestFile(env.BACKUP_DIR),
      pool.query('select 1').then(() => true, () => false),
    ]);
    return { telegram: telegramInfo, disk, modelCache: { bytes: cacheBytes, limitBytes: dl.maxBytes }, backup: { lastAt: backupAt }, db: { ok: db } };
  }

  async function telegramTest() {
    const c = config();
    if (!c.enabled) return { ok: false, error: 'NOT_CONFIGURED' };
    try {
      const r = await fetchImpl(`https://api.telegram.org/bot${c.botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(c.ownerChatIds[0]), text: 'Tin nhắn thử từ trang Tổng quan 3DS Mood.' }), signal: AbortSignal.timeout(5000) });
      const d = await r.json().catch(() => null);
      return d?.ok === true && r.ok ? { ok: true } : { ok: false, error: 'TELEGRAM_API' };
    } catch { return { ok: false, error: 'TELEGRAM_UNREACHABLE' }; }
  }

  return { overview, health, telegramTest };
}
