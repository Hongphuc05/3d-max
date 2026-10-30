// Tien trinh worker dong bo Drive (chay rieng voi API): npm run worker
// SIGTERM/SIGINT -> dung an toan: job tra ve hang doi kem checkpoint, worker khac (hoac lan khoi dong sau) tiep tuc.
import { mkdir } from 'node:fs/promises';
import { pool } from './db.js';
import { loadWorkerConfig } from './worker/config.js';
import { createSyncHandler } from './worker/process.js';
import { cleanStaleParts } from './worker/previews.js';
import { runWorker } from './worker/runner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadWorkerConfig(process.env);
if (config.errors.length) {
  console.error('Worker configuration invalid, check:', config.errors.join(', '));
  process.exit(1);
}

await mkdir(config.previewDir, { recursive: true });
const removed = await cleanStaleParts(config.previewDir);
if (removed) console.log(`removed ${removed} stale .part file(s)`);

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { console.log(`${signal}: finishing the current step safely`); stop.abort(); });

console.log('store-worker started');
await runWorker({
  pool, signal: stop.signal, pollMs: Number(process.env.WORKER_POLL_MS) || 5000,
  handler: createSyncHandler({ pool, ...config }),
});
await pool.end();
console.log('store-worker stopped');
