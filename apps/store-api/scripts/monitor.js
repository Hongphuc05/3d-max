// P6: chay boi systemd timer (deploy/systemd/store-monitor.timer) moi 5 phut.
//   node --env-file-if-exists=.env scripts/monitor.js
// In van de ra stdout (journald) va bao chu qua Telegram khi tap van de doi / het van de. Thoat 0 = binh thuong, 2 = co van de, 1 = chinh script loi.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pool } from '../src/db.js';
import { createTelegramClient } from '../src/telegram/client.js';
import { loadTelegramConfig } from '../src/telegram/config.js';
import { collectProblems, decideNotification, formatReport, loadMonitorConfig } from '../src/ops/monitor.js';

const run = promisify(execFile);
const STORAGE = process.env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../storage');
const UNITS = (process.env.MONITOR_UNITS || 'store-api,store-worker').split(',').map((s) => s.trim()).filter(Boolean);
const STATE_FILE = path.join(STORAGE, 'monitor-state.json');

async function pidOf(unit) {
  const { stdout } = await run('systemctl', ['show', '-p', 'MainPID', '--value', `${unit}.service`], { timeout: 5000 });
  return Number(stdout.trim());
}

async function main() {
  const config = loadMonitorConfig(process.env);
  const processes = [];
  // Khong co systemd (may dev/Windows) thi bo qua kiem tra RAM, khong coi la loi.
  for (const unit of UNITS) { try { const pid = await pidOf(unit); processes.push({ name: unit, pid }); } catch { /* khong co systemd */ } }
  const now = new Date();
  const { problems } = await collectProblems({ pool, config, dirs: [{ name: 'storage', path: STORAGE }], processes, now: () => now });
  for (const p of problems) console.log(`[monitor] ${p.key}: ${p.text}`);
  if (!problems.length) console.log('[monitor] ok');

  let prev = null;
  try { prev = JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { /* chua co / hong -> coi nhu chua bao */ }
  const { notify, state } = decideNotification(prev, problems, now.getTime(), config.repeatHours);

  if (notify) {
    const telegram = loadTelegramConfig(process.env);
    if (telegram.enabled) {
      const client = createTelegramClient({ token: telegram.botToken });
      const text = formatReport(notify, problems, now);
      let delivered = 0;
      for (const chatId of telegram.ownerChatIds) { try { await client.sendMessage({ chatId: String(chatId), text }); delivered++; } catch (e) { console.error('[monitor] telegram send failed:', e?.code ?? e?.name ?? 'ERROR'); } }
      // Khong gui duoc cho ai thi KHONG ghi state -> lan chay sau thu lai.
      if (delivered === 0) return problems.length ? 2 : 0;
    }
  }
  await mkdir(STORAGE, { recursive: true });
  await writeFile(`${STATE_FILE}.tmp`, JSON.stringify(state)); await rename(`${STATE_FILE}.tmp`, STATE_FILE);
  return problems.length ? 2 : 0;
}

let code = 1;
try { code = await main(); } catch (e) { console.error('[monitor] failed:', e?.message ?? e); } finally { await pool.end().catch(() => {}); }
process.exit(code);
