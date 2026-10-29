#!/usr/bin/env node
// Real-Drive probe for docs/v3-implementation-plan.md P1.3. Read-only: lists the whole folder tree and streams 3 files
// (smallest / median / largest) to memory to check size + MD5. Writes storage/drive-probe-report.json (no ids, no tokens).
//
//   node --env-file=.env scripts/drive-probe.js --folder <url-or-id> --connection <drive_connections.id>
//   node --env-file=.env scripts/drive-probe.js --folder <url-or-id> --service-account ./sa-key.json     (Q4 comparison)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDriveClient } from '../src/drive/client.js';
import { createOAuth, loadDriveConfig } from '../src/drive/oauth.js';
import { runProbe } from '../src/drive/probe.js';
import { parseFolderRef } from '../src/drive/routes.js';
import { serviceAccountTokenProvider } from '../src/drive/service-account.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const fail = message => { console.error(message); process.exit(1); };
if (!args.folder || (!args.connection && !args['service-account'])) {
  fail('Usage: drive-probe.js --folder <url-or-id> (--connection <id> | --service-account <key.json>) [--samples 3] [--resource-key K] [--out file]');
}

let getAccessToken, closeDb = async () => {}, mode;
if (args['service-account']) {
  const key = JSON.parse(await readFile(args['service-account'], 'utf8'));
  getAccessToken = serviceAccountTokenProvider({ clientEmail: key.client_email, privateKey: key.private_key });
  mode = 'SERVICE_ACCOUNT';
} else {
  const { pool } = await import('../src/db.js');
  const config = loadDriveConfig();
  if (!config.configured) fail(`Missing configuration: ${config.errors.join(', ')}`);
  getAccessToken = createOAuth({ pool, config }).tokenProvider(args.connection);
  closeDb = () => pool.end();
  mode = 'OAUTH_USER';
}

try {
  const ref = parseFolderRef(args.folder, args['resource-key']);
  const client = createDriveClient({ getAccessToken });
  console.log(`Probe (${mode}) — quét thư mục…`);
  const report = await runProbe(client, { id: ref.id, resourceKey: ref.resourceKey, driveId: undefined },
    { samples: Number(args.samples || 3), log: m => console.log(m) });
  const out = path.resolve(args.out || path.join(import.meta.dirname, '../../../storage/drive-probe-report.json'));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ mode, ...report }, null, 2));
  const t = report.tree;
  console.log(`\nThư mục: ${t.folders} · File: ${t.files} · Shortcut: ${t.shortcuts} · Google Docs bỏ qua: ${t.googleDocs} · Sâu nhất: ${t.maxDepth}`);
  console.log(`Lớn nhất 1 thư mục: ${t.maxChildrenInFolder} mục / ${t.maxPagesInFolder} trang · Tổng dung lượng: ${(t.bytes / 1073741824).toFixed(2)} GB`);
  console.log(`Cờ canDownload=false: ${t.noDownloadFlag} · Thiếu md5: ${t.noMd5} · Lỗi khi quét: ${t.errors.length}`);
  for (const d of report.downloads) console.log(`  ${d.ok ? 'OK ' : 'LỖI'} ${d.name}: ${d.ok ? `${d.mbPerSec} MB/s, md5 ${d.md5Matches === null ? 'không có để so' : d.md5Matches ? 'khớp' : 'KHÔNG KHỚP'}` : `${d.code}${d.reason ? '/' + d.reason : ''}`}`);
  console.log(`Kết luận: list=${report.verdict.listed ? 'OK' : 'CÓ LỖI'} · tải=${report.verdict.downloadable ? 'OK' : 'KHÔNG ĐẠT'}\nBáo cáo: ${out}`);
  process.exitCode = report.verdict.listed && report.verdict.downloadable ? 0 : 2;
} catch (error) {
  console.error('Probe thất bại:', error?.code || 'INTERNAL', error?.reason || ''); process.exitCode = 1;
} finally { await closeDb(); }
