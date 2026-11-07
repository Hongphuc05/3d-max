// Audit by default; --upload explicitly sends files through the normal admin API.
// Credentials come from environment variables, never command-line arguments or reports.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const stemOf = name => name.normalize('NFC').replace(/(\s*\.(jpe?g|png|webp|rar|zip|7z))+\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function inventory(root, contentDomain) {
  if (!['3dmodels', '3dscenes'].includes(contentDomain)) throw new Error('Invalid content domain');
  const items = [], ignored = [], errors = [];
  async function visit(dir, segments = []) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const parts = [...segments, entry.name], absolute = path.join(dir, entry.name), relative = parts.join('/');
      if (entry.isSymbolicLink()) { errors.push(`${relative}: symbolic links are not supported`); continue; }
      if (entry.name === '.DS_Store' || entry.name.startsWith('._')) { ignored.push(relative); continue; }
      if (entry.isDirectory()) { await visit(absolute, parts); continue; }
      const type = mime[path.extname(entry.name).toLowerCase()];
      if (!entry.isFile() || !type) { errors.push(`${relative}: unsupported file`); continue; }
      if (!segments.length || segments.length > 6 || parts.some(p => !p.trim() || /[\\\u0000-\u001f\u007f]/.test(p))) {
        errors.push(`${relative}: invalid category path`); continue;
      }
      const bytes = await readFile(absolute), stem = stemOf(entry.name);
      if (!stem || !bytes.length || bytes.length > 15 * 1024 * 1024) { errors.push(`${relative}: invalid filename or size`); continue; }
      items.push({ relative, category: segments.join('/'), filename: entry.name, contentDomain, stem,
        sha256: sha(bytes), size: bytes.length, type });
    }
  }
  await visit(path.resolve(root));
  const groups = Map.groupBy(items, x => x.stem);
  const duplicates = [...groups].filter(([, list]) => list.length > 1).map(([stem, list]) => ({ stem,
    identical: new Set(list.map(x => x.sha256)).size === 1, paths: list.map(x => x.relative) }));
  for (const group of duplicates) {
    if (contentDomain === '3dmodels' || !group.identical) errors.push(`${group.stem}: ambiguous duplicate preview content`);
  }
  return { contentDomain, fileCount: items.length, uniqueStems: groups.size, totalBytes: items.reduce((n, x) => n + x.size, 0), duplicates, ignored, errors, items };
}

async function saveReport(filename, report) {
  await mkdir(path.dirname(filename), { recursive: true });
  const pending = `${filename}.tmp`;
  await writeFile(pending, JSON.stringify(report, null, 2) + '\n');
  await rename(pending, filename);
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--upload' || arg === '--replace') options[arg.slice(2)] = true;
    else if (['--root', '--domain', '--origin', '--report'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[++i];
    else throw new Error('Usage: node tools/preview-library.mjs --root <folder> --domain 3dmodels|3dscenes [--report <json>] [--upload --origin https://host] [--replace]');
  }
  if (!options.root || !options.domain) throw new Error('--root and --domain are required');
  const root = path.resolve(options.root), reportPath = path.resolve(options.report ?? `data/${options.domain}-preview-report.json`);
  if (reportPath === root || reportPath.startsWith(root + path.sep)) throw new Error('Report must be outside the source image directory');
  const report = await inventory(root, options.domain);
  let previous;
  try { previous = JSON.parse(await readFile(reportPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  report.generatedAt = new Date().toISOString();
  report.mode = options.upload ? 'upload' : 'audit';
  console.log(JSON.stringify({ files: report.fileCount, uniqueStems: report.uniqueStems, totalBytes: report.totalBytes,
    duplicates: report.duplicates, errors: report.errors }, null, 2));
  if (report.errors.length) { await saveReport(reportPath, report); throw new Error('Audit failed; no files uploaded'); }
  if (!options.upload) { await saveReport(reportPath, report); return; }
  const origin = new URL(options.origin ?? 'https://3dsmood.io.vn');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('Invalid or insecure API origin');
  report.origin = origin.origin;
  // Authenticate before storing or sending image data. Existing reports contain no cookies.
  let cookie = process.env.PREVIEW_ADMIN_COOKIE;
  if (!cookie) {
    if (!process.env.PREVIEW_ADMIN_EMAIL || !process.env.PREVIEW_ADMIN_PASSWORD) throw new Error('Set PREVIEW_ADMIN_COOKIE or PREVIEW_ADMIN_EMAIL and PREVIEW_ADMIN_PASSWORD');
    const response = await fetch(new URL('/api/auth/login', origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.PREVIEW_ADMIN_EMAIL, password: process.env.PREVIEW_ADMIN_PASSWORD }) });
    if (!response.ok) throw new Error(`Admin login failed: HTTP ${response.status}`);
    cookie = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    if (!cookie) throw new Error('Admin login did not return a session cookie');
  }
  // Check the server supports content domains before posting anything to a legacy backend.
  const categoriesResponse = await fetch(new URL(`/api/admin/categories?contentDomain=${options.domain}`, origin),
    { headers: { Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!categoriesResponse.ok) throw new Error(`Admin access failed: HTTP ${categoriesResponse.status}`);
  const payload = await categoriesResponse.json(), categories = Array.isArray(payload) ? payload : payload.items;
  if (payload?.contentDomain !== options.domain || !Array.isArray(categories) || categories.some(c => c.contentDomain !== options.domain)) throw new Error('Server does not expose the selected content domain');
  report.results = [];
  const completed = new Map(previous?.origin === origin.origin && previous.contentDomain === options.domain
    ? (previous.results ?? []).filter(x => x.status === 'uploaded').map(x => [x.relative, x]) : []);
  // Sequential uploads limit memory, CPU and avoid alias/replacement races on a small VPS.
  for (const item of report.items) {
    const old = completed.get(item.relative);
    if (old?.sha256 === item.sha256) { report.results.push(old); console.log(`Resume: ${item.relative}`); continue; }
    const bytes = await readFile(path.join(root, ...item.relative.split('/')));
    if (sha(bytes) !== item.sha256) throw new Error(`File changed since audit: ${item.relative}`);
    const query = new URLSearchParams({ category: item.category, filename: item.filename, contentDomain: options.domain, ...(options.replace ? { replace: '1' } : {}) });
    const response = await fetch(new URL(`/api/admin/previews?${query}`, origin), { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(120000), headers: { Cookie: cookie, 'Content-Type': item.type }, body: bytes });
    const result = await response.json().catch(() => null);
    const record = { relative: item.relative, sha256: item.sha256, status: response.ok ? 'uploaded' : 'failed',
      httpStatus: response.status, ...(response.ok ? { modelId: result?.id, state: result?.state } : { code: result?.error?.code ?? 'HTTP_ERROR' }) };
    report.results.push(record);
    await saveReport(reportPath, report);
    console.log(`${record.status}: ${item.relative}${record.code ? ` (${record.code})` : ''}`);
    if (!response.ok && [401, 403, 429].includes(response.status)) throw new Error(`Upload stopped: HTTP ${response.status}; rerun using the same report to resume`);
  }
  await saveReport(reportPath, report);
  if (report.results.some(x => x.status === 'failed')) throw new Error('Some previews failed; inspect the report and rerun to retry');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
