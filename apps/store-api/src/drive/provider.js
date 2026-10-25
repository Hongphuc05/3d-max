import { google } from 'googleapis';
import { setTimeout as sleepDefault } from 'node:timers/promises';
import { pairFiles } from './pairing.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,size,modifiedTime,md5Checksum,resourceKey,capabilities(canDownload)';
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'downloadQuotaExceeded', 'dailyLimitExceeded']);

export class DriveError extends Error {
  constructor(code, status = 502) { super(code); this.name = 'DriveError'; this.code = code; this.status = status; }
}

export function classifyDriveError(error) {
  if (error instanceof DriveError) return error;
  const status = Number(error.response?.status || error.status || error.code);
  let body = error.response?.data;
  // Gaxios puts a consumed streaming error body in message instead of data.
  const encoded = typeof body === 'string' ? body : error.config?.responseType === 'stream' ? error.message : null;
  if(status===403 && typeof encoded==='string' && encoded.length<=65536 && /<html/i.test(encoded) && /automated queries/i.test(encoded)) return new DriveError('DRIVE_AUTOMATED_REQUESTS_BLOCKED',503);
  if (typeof encoded === 'string' && encoded.length <= 65536) { try { body = JSON.parse(encoded); } catch { /* Unstructured provider error is classified only by status. */ } }
  const reason = body?.error?.errors?.[0]?.reason || '';
  if (reason === 'accessNotConfigured' || body?.error?.details?.some(item => item.reason === 'SERVICE_DISABLED')) return new DriveError('GOOGLE_DRIVE_API_DISABLED', 503);
  if (body?.error?.details?.some(item => /^API_KEY_/.test(item.reason || ''))) return new DriveError('GOOGLE_DRIVE_API_KEY_RESTRICTED', 503);
  if (status === 401) return new DriveError('DRIVE_AUTHENTICATION_REQUIRED');
  if (status === 404) return new DriveError('DRIVE_FILE_OR_RESOURCE_KEY_NOT_FOUND', 404);
  if (status === 429 || QUOTA_REASONS.has(reason)) return new DriveError('DRIVE_QUOTA_EXCEEDED', 503);
  if (/downloadRestricted|cannotDownload|fileNotDownloadable|abuse|notAuthorizedToDownload/i.test(reason)) return new DriveError('DRIVE_DOWNLOAD_RESTRICTED', 403);
  if (status === 403) return new DriveError('DRIVE_PERMISSION_DENIED', 403);
  if (error.name === 'AbortError' || ['TimeoutError','ETIMEDOUT','ECONNABORTED'].includes(error.code)) return new DriveError('DRIVE_TIMEOUT', 504);
  return new DriveError('DRIVE_UNAVAILABLE', 503);
}

function identity(file) {
  const id = file.archiveId || file.id;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new DriveError('DRIVE_INVALID_FILE_ID', 400);
  if (file.resourceKey && !/^[\w-]+$/.test(file.resourceKey)) throw new DriveError('DRIVE_INVALID_RESOURCE_KEY', 400);
  return { id, resourceKey: file.resourceKey };
}

export class CatalogProvider {
  async scan() { throw new Error('CatalogProvider.scan must be implemented'); }
  async openDownload() { throw new Error('CatalogProvider.openDownload must be implemented'); }
}

export class GoogleDriveCatalogProvider extends CatalogProvider {
  constructor({ config, drive, sleep = sleepDefault, random = Math.random, logger = console }) {
    super();
    this.config = config;
    this.drive = drive || google.drive({ version: 'v3', auth: config.apiKey });
    this.sleep = sleep; this.random = random; this.logger = logger;
  }

  options(file, extra = {}) {
    const { id, resourceKey } = identity(file);
    return { timeout: this.config.requestTimeoutMs || 30000, retry: false, ...extra,
      headers: { ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${id}/${resourceKey}` } : {}), ...extra.headers } };
  }

  async request(operation, signal) {
    const retries = this.config.retries ?? 4;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DriveError('DRIVE_TIMEOUT', 504);
      try { return await operation(); }
      catch (error) {
        const classified = classifyDriveError(error);
        const status = Number(error.response?.status || error.status || error.code);
        const transient = classified.code === 'DRIVE_QUOTA_EXCEEDED' || classified.code === 'DRIVE_TIMEOUT' || status >= 500 || ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code);
        if (!transient || attempt >= retries || signal?.aborted) throw classified;
        await this.sleep(Math.min(32000, 1000 * 2 ** attempt) + Math.floor(this.random() * 1000), undefined, signal ? { signal } : undefined);
      }
    }
  }

  async getMetadata(file, { signal } = {}) {
    const { id } = identity(file);
    const response = await this.request(() => this.drive.files.get({ fileId: id, fields: FIELDS, supportsAllDrives: true }, this.options(file, { signal })), signal);
    if (!response.data || response.data.id !== id || !response.data.name || !response.data.mimeType) throw new DriveError('DRIVE_INVALID_METADATA');
    return response.data;
  }

  async listFolder(folder, { signal } = {}) {
    const files = [];
    const tokens = new Set();
    let pageToken;
    do {
      const response = await this.request(() => this.drive.files.list({
        q: `'${identity(folder).id}' in parents and trashed = false`,
        fields: `nextPageToken,incompleteSearch,files(${FIELDS})`, pageSize: 1000, pageToken,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      }, this.options(folder, { signal })), signal);
      const data = response.data;
      if (!data || !Array.isArray(data.files) || data.incompleteSearch) throw new DriveError('DRIVE_INCOMPLETE_SCAN');
      for (const file of data.files) {
        identity(file);
        if (!file.name || !file.mimeType || !file.parents?.includes(folder.id)) throw new DriveError('DRIVE_INVALID_METADATA');
        files.push(file);
      }
      pageToken = data.nextPageToken;
      if (pageToken && (typeof pageToken !== 'string' || tokens.has(pageToken))) throw new DriveError('DRIVE_PAGINATION_CYCLE');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    return files;
  }

  async scan({ signal } = {}) {
    const root = await this.getMetadata({ id: this.config.folderId, resourceKey: this.config.resourceKey }, { signal });
    if (root.mimeType !== FOLDER_MIME) throw new DriveError('DRIVE_ROOT_IS_NOT_FOLDER');
    const folders = [{ id: root.id, parentId: null, name: root.name, path: root.name, resourceKey: root.resourceKey || this.config.resourceKey || null }];
    const seenFolders = new Set([root.id]);
    const seenFiles = new Set();
    const allFiles = [];
    let filesScanned = 0;
    for (let index = 0; index < folders.length; index++) {
      const current = folders[index];
      const files = await this.listFolder(current, { signal });
      filesScanned += files.length;
      for (const file of files) {
        if (file.mimeType === FOLDER_MIME) {
          if (seenFolders.has(file.id)) throw new DriveError('DRIVE_FOLDER_CYCLE');
          seenFolders.add(file.id);
          folders.push({ id: file.id, parentId: current.id, name: file.name, path: `${current.path}/${file.name}`, resourceKey: file.resourceKey || null });
        } else {
          if (seenFiles.has(file.id)) throw new DriveError('DRIVE_DUPLICATE_FILE');
          seenFiles.add(file.id);
          allFiles.push({ ...file, parents: [current.id] });
        }
      }
    }
    return { folders, models: pairFiles(allFiles, this.logger), filesScanned };
  }

  async openDownload(file, { signal, range } = {}) {
    const { id } = identity(file);
    if (file.canDownload === false || file.capabilities?.canDownload === false) throw new DriveError('DRIVE_DOWNLOAD_RESTRICTED', 403);
    if (range && !/^bytes=\d+-\d*$/.test(range)) throw new DriveError('DRIVE_INVALID_RANGE', 416);
    return this.request(() => this.drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, this.options(file, {
      responseType: 'stream', signal, timeout: this.config.downloadTimeoutMs || 30 * 60000,
      headers: range ? { Range: range } : {},
    })), signal);
  }
}
