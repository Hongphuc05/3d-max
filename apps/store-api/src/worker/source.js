// Nguon quet bang API key (D26): xac nhan thu muc goc qua Drive roi tao/bat lai hang drive_sources.
import { apiError } from '../drive/errors.js';
import { FOLDER, validId } from '../drive/client.js';

const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

export async function ensureApiKeySource({ pool, client, rootFolderId, resourceKey }) {
  if (!validId(rootFolderId)) throw apiError('INVALID_PARAMS');
  const f = await client.getFile(rootFolderId, { resourceKey }); // nem DRIVE_NOT_FOUND / DRIVE_PERMISSION_DENIED neu khong doc duoc
  if (f?.mimeType !== FOLDER) throw apiError('DRIVE_NOT_A_FOLDER');
  const name = String(f.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500) || 'root';
  const r = await pool.query(
    `insert into drive_sources (access_mode, root_folder_id, root_folder_name, source_type, drive_id, root_resource_key)
     values ('API_KEY', $1, $2, $3, $4, $5)
     on conflict (root_folder_id) where access_mode = 'API_KEY'
     do update set enabled = true, root_folder_name = excluded.root_folder_name
     returning id, root_folder_name, source_type`,
    [rootFolderId, name, f.driveId ? 'SHARED_DRIVE' : 'MY_DRIVE', validId(f.driveId) ? f.driveId : null, [resourceKey, f.resourceKey].find((k) => RESOURCE_KEY.test(k ?? '')) ?? null]);
  const row = r.rows[0];
  return { id: row.id, rootFolderName: row.root_folder_name, sourceType: row.source_type };
}
