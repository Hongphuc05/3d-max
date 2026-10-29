// Read-only survey of a shared Drive folder + download integrity check. Pure logic (client injected) so it can be
// tested against a fake Drive; scripts/drive-probe.js wires it to the real one. Output contains NO Drive ids/tokens.
import { createHash } from 'node:crypto';
import { FOLDER, SHORTCUT } from './client.js';

const ext = name => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? '(none)').toLowerCase();
const GOOGLE_APPS = 'application/vnd.google-apps.';
const bump = (map, key) => { map[key] = (map[key] ?? 0) + 1; };

export async function surveyTree(client, root, { signal, maxFolders = 50_000, onFolder } = {}) {
  const stats = { folders: 0, files: 0, shortcuts: 0, shortcutsFollowed: 0, googleDocs: 0, bytes: 0, maxDepth: 0, maxChildrenInFolder: 0, maxPagesInFolder: 0,
    noDownloadFlag: 0, noMd5: 0, byExtension: {}, errors: [] };
  const files = []; // candidates for download sampling (metadata only, ids kept in memory only)
  const seen = new Set([root.id]);
  const queue = [{ ...root, depth: 0, path: '' }];
  while (queue.length) {
    const folder = queue.shift();
    if (stats.folders >= maxFolders) { stats.errors.push({ path: folder.path || '/', code: 'MAX_FOLDERS_REACHED' }); break; }
    stats.folders++; stats.maxDepth = Math.max(stats.maxDepth, folder.depth);
    let token = null, children = 0, pages = 0;
    try {
      do {
        const page = await client.listChildren(folder.id, { pageToken: token, resourceKey: folder.resourceKey, driveId: folder.driveId, signal });
        pages++; token = page.nextPageToken; children += page.files.length;
        for (const f of page.files) {
          if (f.mimeType === FOLDER) { if (!seen.has(f.id)) { seen.add(f.id); queue.push({ id: f.id, resourceKey: f.resourceKey, driveId: f.driveId ?? folder.driveId, depth: folder.depth + 1, path: `${folder.path}/${f.name}` }); } continue; }
          if (f.mimeType === SHORTCUT) {
            stats.shortcuts++;
            const t = f.shortcutDetails;
            if (t?.targetMimeType === FOLDER && t.targetId && !seen.has(t.targetId)) { // follow folder shortcuts once; the visited set breaks cycles
              seen.add(t.targetId); stats.shortcutsFollowed++;
              queue.push({ id: t.targetId, resourceKey: t.targetResourceKey, driveId: folder.driveId, depth: folder.depth + 1, path: `${folder.path}/${f.name}` });
            }
            continue;
          }
          if (f.mimeType?.startsWith(GOOGLE_APPS)) { stats.googleDocs++; continue; }
          stats.files++; stats.bytes += Number(f.size) || 0; bump(stats.byExtension, ext(f.name));
          if (f.capabilities?.canDownload === false) stats.noDownloadFlag++;
          if (!f.md5Checksum) stats.noMd5++;
          files.push({ id: f.id, name: f.name, size: Number(f.size) || 0, md5: f.md5Checksum, resourceKey: f.resourceKey, canDownload: f.capabilities?.canDownload !== false });
        }
      } while (token);
    } catch (error) {
      if (!error?.code) throw error; // programming error / abort: do not hide it
      stats.errors.push({ path: folder.path || '/', code: error.code, reason: error.reason });
    }
    stats.maxChildrenInFolder = Math.max(stats.maxChildrenInFolder, children); stats.maxPagesInFolder = Math.max(stats.maxPagesInFolder, pages);
    onFolder?.(stats);
  }
  return { stats, files };
}

export function pickSamples(files, count = 3) {
  const ok = files.filter(f => f.canDownload && f.size > 0).sort((a, b) => a.size - b.size);
  if (!ok.length) return [];
  const picks = count === 1 ? [ok[ok.length - 1]] : [ok[0], ok[Math.floor((ok.length - 1) / 2)], ok[ok.length - 1]].slice(0, Math.max(1, count));
  return [...new Map(picks.map(f => [f.id, f])).values()];
}

// Streams the file once, hashing as it goes; nothing is written to disk.
export async function downloadSample(client, file, { signal, now = () => performance.now() } = {}) {
  const t0 = now(); let bytes = 0; const md5 = createHash('md5');
  try {
    const media = await client.openMedia(file.id, { resourceKey: file.resourceKey, signal });
    for await (const chunk of media.data) { bytes += chunk.length; md5.update(chunk); }
  } catch (error) {
    if (!error?.code) throw error;
    return { name: file.name, size: file.size, ok: false, code: error.code, reason: error.reason, bytes };
  }
  const ms = Math.max(1, now() - t0);
  const sizeOk = bytes === file.size;
  const md5Ok = file.md5 ? md5.digest('hex') === file.md5 : null; // null = Drive gave no checksum to compare with
  return { name: file.name, size: file.size, ok: sizeOk && md5Ok !== false, sizeMatches: sizeOk, md5Matches: md5Ok, ms: Math.round(ms), mbPerSec: Number(((bytes / 1048576) / (ms / 1000)).toFixed(2)) };
}

export async function runProbe(client, root, { samples = 3, signal, log = () => {}, now } = {}) {
  const started = Date.now();
  const { stats, files } = await surveyTree(client, root, { signal, onFolder: s => { if (s.folders % 25 === 0) log(`  ${s.folders} thư mục, ${s.files} file…`); } });
  const picked = pickSamples(files, samples);
  const downloads = [];
  for (const f of picked) { log(`  tải thử ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`); downloads.push(await downloadSample(client, f, { signal, now })); }
  return { generatedAt: new Date(started).toISOString(), durationMs: Date.now() - started, tree: stats, downloads,
    verdict: { listed: stats.folders > 0 && stats.errors.length === 0, downloadable: downloads.length > 0 && downloads.every(d => d.ok), restrictedFiles: stats.noDownloadFlag } };
}
