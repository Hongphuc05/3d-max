import path from 'node:path';

export function loadDriveConfig(env = process.env) {
  const provider = env.CATALOG_PROVIDER || 'google_drive';
  const errors = [];
  let folderId = env.GOOGLE_DRIVE_FOLDER_ID || '';
  let resourceKey = env.GOOGLE_DRIVE_RESOURCE_KEY || '';
  if (env.GOOGLE_DRIVE_FOLDER_URL) {
    try {
      const url = new URL(env.GOOGLE_DRIVE_FOLDER_URL);
      const match = url.pathname.match(/^\/drive\/folders\/([\w-]+)\/?$/);
      if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || !match) throw new Error();
      if (folderId && folderId !== match[1]) errors.push('GOOGLE_DRIVE_FOLDER_ID_MISMATCH');
      folderId ||= match[1];
      resourceKey ||= url.searchParams.get('resourcekey') || '';
    } catch { errors.push('GOOGLE_DRIVE_FOLDER_URL_INVALID'); }
  }
  const interval = Number(env.GOOGLE_DRIVE_SYNC_INTERVAL_MINUTES || 30);
  if (!['local', 'google_drive'].includes(provider)) errors.push('CATALOG_PROVIDER_INVALID');
  if (provider === 'google_drive') {
    if (!/^[\w-]+$/.test(folderId)) errors.push('GOOGLE_DRIVE_FOLDER_ID_REQUIRED');
    if (!env.GOOGLE_DRIVE_API_KEY?.trim()) errors.push('GOOGLE_DRIVE_API_KEY_REQUIRED');
    if (resourceKey && !/^[\w-]+$/.test(resourceKey)) errors.push('GOOGLE_DRIVE_RESOURCE_KEY_INVALID');
    if (!Number.isFinite(interval) || interval < 1 || interval > 10080) errors.push('GOOGLE_DRIVE_SYNC_INTERVAL_INVALID');
  }
  return {
    provider, folderId, resourceKey, apiKey: env.GOOGLE_DRIVE_API_KEY?.trim() || '',
    syncIntervalMinutes: interval, syncIntervalMs: interval * 60000,
    previewCacheDir: path.resolve(env.GOOGLE_DRIVE_PREVIEW_CACHE_DIR || './storage/drive-previews'),
    requestTimeoutMs: 30000, downloadTimeoutMs: 30 * 60000, retries: 4,
    configured: errors.length === 0, errors,
  };
}
