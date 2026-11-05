// Worker xử lý sync và kiểm tra key Drive mỗi 10 phút (chạy riêng với API): npm run worker
// SIGTERM/SIGINT -> dung an toan: job tra ve hang doi kem checkpoint, worker khac (hoac lan khoi dong sau) tiep tuc.
import { mkdir } from 'node:fs/promises';
import { pool } from './db.js';
import { loadWorkerConfig } from './worker/config.js';
import { createDriveCredentialStore, deriveDriveKeyEncryptionKey } from './drive/credentials.js';
import { startDriveKeyHealthMonitor } from './drive/health.js';
import { createSyncHandler } from './worker/process.js';
import { cleanStaleParts } from './worker/previews.js';
import { runWorker } from './worker/runner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadWorkerConfig(process.env);
if (process.env.DRIVE_API_KEY && !config.apiKey) {
  console.error('Worker configuration invalid, check: DRIVE_API_KEY');
  process.exit(1);
}
const configErrors = config.errors.filter(error => error !== 'DRIVE_API_KEY');
if (configErrors.length) {
  console.error('Worker configuration invalid, check:', configErrors.join(', '));
  process.exit(1);
}

await mkdir(config.previewDir, { recursive: true });
const removed = await cleanStaleParts(config.previewDir);
if (removed) console.log(`removed ${removed} stale .part file(s)`);

const credentialStore = createDriveCredentialStore({ pool,
  encryptionKey: deriveDriveKeyEncryptionKey(process.env.JWT_SECRET), legacyApiKey: config.apiKey });
if (!config.apiKey && !(await credentialStore.hasConfiguredKeys())) {
  console.error('Worker configuration invalid, check: DRIVE_API_KEY or saved Drive API key slots');
  await pool.end();
  process.exit(1);
}
const stopDriveKeyHealth = startDriveKeyHealthMonitor({ pool, credentialStore });

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { console.log(`${signal}: finishing the current step safely`); stop.abort(); });

console.log('store-worker started');
await runWorker({
  pool, signal: stop.signal, pollMs: Number(process.env.WORKER_POLL_MS) || 5000,
  handler: createSyncHandler({ pool, ...config, credentialStore }),
});
stopDriveKeyHealth();
await pool.end();
console.log('store-worker stopped');
