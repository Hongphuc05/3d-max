import { createDriveClient } from '../drive/client.js';

// The source and resource key come from server-side inventory, never from the client.
export function createDriveMediaProvider({ oauth, apiKey, backupApiKey, makeClient = createDriveClient }) {
  return {
    async openDownload(model, { signal }) {
      const { sourceMode, connectionId, driveFileId, resourceKey } = model.record;
      let client;
      if (sourceMode === 'OAUTH' && connectionId) client = makeClient({ getAccessToken: oauth.tokenProvider(connectionId) });
      else if (sourceMode === 'API_KEY' && apiKey) client = makeClient({ apiKey, backupApiKey });
      else throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED' });
      const result = await client.openMedia(driveFileId, { resourceKey, signal });
      const length = result.headers?.get?.('content-length');
      if (length && model.size != null && /^\d+$/.test(length) && BigInt(length) !== BigInt(model.size)) {
        result.data.destroy();
        throw Object.assign(new Error('DOWNLOAD_SIZE_MISMATCH'), { code: 'DOWNLOAD_SIZE_MISMATCH' });
      }
      return result;
    },
  };
}
