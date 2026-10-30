// Tao nguon quet (API key) va xep mot job FULL: npm run sync:drive -- <rootFolderId>
// Thay the tam cho man admin (P3). Khong in ID thu muc/Drive, chi in ID nguon noi bo va ten.
import { createDriveClient } from '../src/drive/client.js';
import { pool } from '../src/db.js';
import { loadWorkerConfig } from '../src/worker/config.js';
import { enqueueJob } from '../src/worker/queue.js';
import { ensureApiKeySource } from '../src/worker/source.js';

async function main() {
  const config = loadWorkerConfig(process.env);
  // Loi cau hinh/cu phap chi chua TEN bien hoac huong dan nen in duoc; loi tu Drive/DB thi chi in ma (xuong catch).
  if (config.errors.length) { console.error(`sync:drive: invalid configuration, check: ${config.errors.join(', ')}`); return 1; }
  const root = process.argv[2] || process.env.DRIVE_ROOT_FOLDER_ID;
  if (!root) { console.error('usage: npm run sync:drive -- <rootFolderId>  (or set DRIVE_ROOT_FOLDER_ID)'); return 1; }
  const source = await ensureApiKeySource({ pool, client: createDriveClient({ apiKey: config.apiKey }), rootFolderId: root });
  const job = await enqueueJob(pool, { sourceId: source.id, mode: 'FULL' });
  console.log(`Source "${source.rootFolderName}" (${source.id}) ready. Job ${job.id} queued: start the worker with "npm run worker".`);
  return 0;
}

try { process.exitCode = await main(); } catch (e) {
  console.error(`sync:drive failed: ${e.code ?? e.name}${e.code === 'SYNC_ALREADY_RUNNING' ? ' (a job is already queued or running for this source)' : ''}`);
  process.exitCode = 1;
} finally { await pool.end(); }
