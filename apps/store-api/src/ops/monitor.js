// P6 (plan §P6.3, E2): kiem tra suc khoe VPS. Khong mo cong, khong phu thuoc dich vu ngoai: chay dinh ky (systemd timer), in van de ra stdout
// va (neu bot Telegram bat) bao chu. Cac nguon do (dia, RAM) duoc tiem vao de test; truy van DB la SQL that.
import { readFile, statfs } from 'node:fs/promises';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function num(env, name, fallback, { min, max, integer = true }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${name} khong hop le`);
  return value;
}

export function loadMonitorConfig(env = process.env) {
  const ratio = num(env, 'MONITOR_MIN_FREE_DISK_RATIO', 0.2, { min: 0.01, max: 0.99, integer: false });
  return {
    minFreeDiskRatio: ratio,
    rssLimitBytes: num(env, 'MONITOR_RSS_LIMIT_MB', 800, { min: 1, max: 1048576 }) * MB,
    driveErrorsPerHour: num(env, 'MONITOR_DRIVE_ERRORS_PER_HOUR', 20, { min: 0, max: 1e6 }),
    bandwidthBytesPerHour: num(env, 'MONITOR_BANDWIDTH_GB_PER_HOUR', 5, { min: 1, max: 1e6 }) * GB,
    awaitingOwnerMinutes: num(env, 'MONITOR_AWAITING_OWNER_MINUTES', 60, { min: 1, max: 1e5 }),
    repeatHours: num(env, 'MONITOR_REPEAT_HOURS', 6, { min: 1, max: 1e4 }),
  };
}

export async function systemDiskUsage(path) {
  const s = await statfs(path);
  return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
}

/** Linux: VmRSS cua mot tien trinh. */
export async function procRss(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid');
  const m = /^VmRSS:\s+(\d+)\s+kB$/m.exec(await readFile(`/proc/${pid}/status`, 'utf8'));
  if (!m) throw new Error('no VmRSS');
  return Number(m[1]) * 1024;
}

const gib = (bytes) => (bytes / GB).toFixed(1);

/** @returns {{problems: {key:string,text:string}[], metrics: object}} Loi doc nguon do KHONG bao gio lam hong ca lan chay. */
export async function collectProblems({ pool, config, dirs = [], processes = [], diskUsage = systemDiskUsage, readRss = procRss, now = () => new Date() }) {
  const at = now();
  const problems = [];
  const metrics = { freeDiskRatio: {}, rssBytes: {} };

  for (const { name, path } of dirs) {
    try {
      const { freeBytes, totalBytes } = await diskUsage(path);
      const ratio = totalBytes > 0 ? freeBytes / totalBytes : 0;
      metrics.freeDiskRatio[name] = ratio;
      if (ratio < config.minFreeDiskRatio) problems.push({ key: `disk:${name}`, text: `Đĩa ${name} chỉ còn trống ${Math.floor(ratio * 100)}% (ngưỡng ${Math.round(config.minFreeDiskRatio * 100)}%).` });
    } catch { problems.push({ key: `disk:${name}`, text: `Không đọc được dung lượng đĩa ${name}.` }); }
  }
  for (const { name, pid } of processes) {
    try {
      const rss = await readRss(pid);
      metrics.rssBytes[name] = rss;
      if (rss > config.rssLimitBytes) problems.push({ key: `rss:${name}`, text: `${name} dùng ${Math.round(rss / MB)} MB RAM (ngưỡng ${Math.round(config.rssLimitBytes / MB)} MB).` });
    } catch { problems.push({ key: `process:${name}`, text: `Không đọc được tiến trình ${name} (đã dừng?).` }); }
  }

  try { await pool.query('select 1'); } catch { problems.push({ key: 'db', text: 'Không kết nối được PostgreSQL.' }); return { problems, metrics }; }

  try {
    const hourAgo = new Date(at.getTime() - 3600e3), dayAgo = new Date(at.getTime() - 24 * 3600e3);
    const awaitingBefore = new Date(at.getTime() - config.awaitingOwnerMinutes * 60e3);
    const q = async (sql, params) => (await pool.query(sql, params)).rows[0];

    const failedJobs = (await q("select count(*)::int n from drive_sync_jobs where status = 'FAILED' and created_at > $1", [dayAgo])).n;
    if (failedJobs > 0) problems.push({ key: 'jobs-failed', text: `${failedJobs} job quét Drive thất bại trong 24 giờ qua.` });

    const driveErrors = (await q(
      `select (select count(*) from drive_sync_job_items i join drive_sync_jobs j on j.id = i.job_id where i.status = 'FAILED' and j.created_at > $1)::int
            + (select count(*) from model_download_logs where status = 'FAILED' and created_at > $1)::int as n`, [hourAgo])).n;
    metrics.driveErrorsLastHour = driveErrors;
    if (driveErrors > config.driveErrorsPerHour) problems.push({ key: 'drive-errors', text: `${driveErrors} lỗi Drive trong 1 giờ qua (ngưỡng ${config.driveErrorsPerHour}).` });

    const sent = Number((await q('select coalesce(sum(bytes_sent), 0) as n from model_download_logs where created_at > $1', [hourAgo])).n);
    metrics.bytesSentLastHour = sent;
    if (sent > config.bandwidthBytesPerHour) problems.push({ key: 'bandwidth', text: `Đã gửi ${gib(sent)} GiB trong 1 giờ qua (ngưỡng ${gib(config.bandwidthBytesPerHour)} GiB).` });

    const waiting = (await q("select count(*)::int n from purchase_orders where status = 'AWAITING_OWNER' and claimed_paid_at < $1 and expires_at > $2", [awaitingBefore, at])).n;
    if (waiting > 0) problems.push({ key: 'orders-waiting', text: `${waiting} đơn đã báo chuyển khoản đang chờ chủ xác nhận quá ${config.awaitingOwnerMinutes} phút.` });
  } catch { problems.push({ key: 'db-query', text: 'Truy vấn giám sát lỗi (kiểm tra migration và quyền DB).' }); }

  return { problems, metrics };
}

/**
 * Chong spam: moi 5 phut chay mot lan nhung chi bao khi tap van de DOI hoac sau `repeatHours`; het van de -> bao dung mot lan.
 * State hong/la thi coi nhu chua tung bao (khong bao gio im lang vi file loi).
 * @returns {{notify: 'PROBLEM'|'RECOVERED'|null, state: {keys: string[], at: number}}}
 */
export function decideNotification(prev, problems, nowMs, repeatHours = 6) {
  const keys = [...new Set(problems.map((p) => p.key))].sort();
  const valid = prev && Array.isArray(prev.keys) && prev.keys.every((k) => typeof k === 'string') && Number.isFinite(prev.at);
  if (keys.length === 0) return { notify: valid && prev.keys.length > 0 ? 'RECOVERED' : null, state: { keys: [], at: nowMs } };
  const same = valid && prev.keys.length === keys.length && prev.keys.every((k, i) => k === keys[i]);
  if (same && nowMs - prev.at < repeatHours * 3600e3) return { notify: null, state: prev };
  return { notify: 'PROBLEM', state: { keys, at: nowMs } };
}

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const stamp = (date) => new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

export function formatReport(kind, problems, at) {
  if (kind === 'RECOVERED') return `✅ 3DS Mood: mọi kiểm tra đã bình thường (${stamp(at)}).`;
  const lines = [`⚠️ 3DS Mood: có vấn đề (${stamp(at)})`];
  let size = lines[0].length;
  for (let i = 0; i < problems.length; i++) {
    const line = `• ${clean(problems[i].text).slice(0, 300)}`;
    if (size + line.length + 40 > 4000) { lines.push(`… và ${problems.length - i} vấn đề khác`); break; }
    lines.push(line); size += line.length + 1;
  }
  return lines.join('\n');
}
