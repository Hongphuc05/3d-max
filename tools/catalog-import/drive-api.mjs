const ID = /^[A-Za-z0-9_-]{10,200}$/;
const API_URL = 'https://www.googleapis.com/drive/v3/files';
const MAX_PAGES = 100;
const MAX_FILES = 100_000;

export function createDriveApiLister({ apiKey, fetchImpl = fetch, pageSize = 1000 } = {}) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) {
    throw new Error('Google Drive API key is missing or invalid.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error('Drive API page size must be between 1 and 1000.');
  }

  return async function listDriveFolder(folderId) {
    if (!ID.test(folderId ?? '')) throw new Error('Invalid Drive folder ID.');

    const files = [];
    const seenIds = new Set();
    const seenTokens = new Set();
    let pageToken;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(API_URL);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
      url.searchParams.set('fields', 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime)');
      url.searchParams.set('pageSize', String(pageSize));
      url.searchParams.set('orderBy', 'name');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000)
        });
      } catch {
        const error = new Error('Could not reach the Google Drive listing API.');
        error.transient = true;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(`Google Drive API returned HTTP ${response.status}; check the API key, sharing, and quota.`);
        error.transient = response.status === 429 || response.status >= 500;
        throw error;
      }

      const body = await response.text();
      if (body.length > 5 * 1024 * 1024) throw new Error('Google Drive API response is too large.');

      let listing;
      try {
        listing = JSON.parse(body);
      } catch {
        throw new Error('Google Drive API returned invalid JSON.');
      }
      if (!listing || !Array.isArray(listing.files) || listing.incompleteSearch === true) {
        throw new Error('Google Drive returned an incomplete or invalid folder listing.');
      }
      if (listing.files.length > pageSize) throw new Error('Google Drive returned more files than the requested page size.');

      for (const file of listing.files) {
        if (!file || !ID.test(file.id ?? '') || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 200
            || typeof file.mimeType !== 'string' || (file.size !== undefined && !/^\d{1,16}$/.test(file.size))) {
          throw new Error('Google Drive returned invalid file metadata.');
        }
        if (seenIds.has(file.id)) throw new Error('Google Drive returned a duplicate file ID.');
        seenIds.add(file.id);
        files.push({
          id: file.id,
          name: file.name,
          mime: file.mimeType,
          size: file.size === undefined ? 0 : Number(file.size),
          modified: file.modifiedTime ?? ''
        });
        if (files.length > MAX_FILES) throw new Error('Google Drive folder contains too many files.');
      }

      if (!listing.nextPageToken) return files;
      if (typeof listing.nextPageToken !== 'string' || seenTokens.has(listing.nextPageToken)) {
        throw new Error('Google Drive returned an invalid page token.');
      }
      seenTokens.add(listing.nextPageToken);
      pageToken = listing.nextPageToken;
    }

    throw new Error('Google Drive listing exceeded the page limit.');
  };
}
