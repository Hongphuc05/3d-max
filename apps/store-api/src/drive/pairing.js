import path from 'node:path';

const ARCHIVES = ['.zip', '.rar', '.7z'];
const PREVIEWS = ['.jpg', '.jpeg', '.png', '.webp'];
const normalized = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const compare = (priorities, a, b) => priorities.indexOf(path.extname(a.name).toLowerCase()) - priorities.indexOf(path.extname(b.name).toLowerCase()) || a.id.localeCompare(b.id, 'en');

// Pair exclusively inside the actual parent folder; IDs remain the source identity.
export function pairFiles(files, logger = console) {
  const groups = new Map();
  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();
    if (!ARCHIVES.includes(extension) && !PREVIEWS.includes(extension)) continue;
    const folderId = file.parents?.[0];
    const basename = file.name.slice(0, -extension.length);
    const key = JSON.stringify([folderId, normalized(basename)]);
    const group = groups.get(key) || { folderId, archives: [], previews: [] };
    (ARCHIVES.includes(extension) ? group.archives : group.previews).push(file);
    groups.set(key, group);
  }
  const models = [];
  for (const group of groups.values()) {
    if (!group.archives.length) continue;
    const archives = [...group.archives].sort((a, b) => compare(ARCHIVES, a, b));
    const previews = [...group.previews].sort((a, b) => compare(PREVIEWS, a, b));
    if (archives.length > 1) logger.warn?.({ code: 'DRIVE_AMBIGUOUS_ARCHIVE', folderId: group.folderId, fileIds: archives.map(x => x.id), selectedId: archives[0].id });
    if (previews.length > 1) logger.warn?.({ code: 'DRIVE_AMBIGUOUS_PREVIEW', folderId: group.folderId, fileIds: previews.map(x => x.id), selectedId: previews[0].id });
    const archive = archives[0];
    const archiveExtension = path.extname(archive.name).toLowerCase();
    models.push({
      archiveId: archive.id, folderId: group.folderId,
      name: archive.name.slice(0, -archiveExtension.length).normalize('NFKC').trim().replace(/\s+/gu, ' '),
      archiveExtension, size: archive.size || null, modifiedTime: archive.modifiedTime || null,
      checksum: archive.md5Checksum || null, resourceKey: archive.resourceKey || null,
      canDownload: archive.capabilities?.canDownload !== false, preview: previews[0] || null,
    });
  }
  return models.sort((a, b) => a.archiveId.localeCompare(b.archiveId, 'en'));
}
