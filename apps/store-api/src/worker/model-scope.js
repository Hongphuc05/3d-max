import { FOLDER, SHORTCUT, validId } from '../drive/client.js';
import { apiError } from '../drive/errors.js';

export const MODEL_SCOPE_POLICY = 'catalog-v2';
const nameOf = name => String(name ?? '').trim().toUpperCase();
export const isModelLibrarySource = source => ['3DSMOOD', '3DMODELS', '3DSCENES'].includes(nameOf(source.root_folder_name));

// Keep source/root IDs unchanged. The effective scan root is a child, not a new source.
export async function resolveModelScope(client, source, { signal, contentDomain = '3dmodels' } = {}) {
  const root = { id: source.root_folder_id, resourceKey: source.root_resource_key ?? null };
  const branch = contentDomain === '3dscenes' ? '3DSCENES' : '3DMODELS';
  const errorPrefix = contentDomain === '3dscenes' ? 'DRIVE_SCENES' : 'DRIVE_MODELS';
  if (nameOf(source.root_folder_name) !== '3DSMOOD') {
    if (['3DMODELS','3DSCENES'].includes(nameOf(source.root_folder_name)) && nameOf(source.root_folder_name) !== branch) throw apiError(errorPrefix + '_FOLDER_NOT_FOUND');
    return root;
  }
  const matches = new Map();
  let pageToken;
  const seenTokens = new Set();
  do {
    if (signal?.aborted) throw signal.reason ?? new Error('Scope resolution aborted');
    const page = await client.listChildren(root.id, { pageToken, resourceKey: root.resourceKey, driveId: source.drive_id ?? undefined, signal });
    for (const file of page.files) {
      if (nameOf(file.name) !== branch) continue;
      if (file.mimeType === FOLDER && validId(file.id)) matches.set(file.id, { id: file.id, resourceKey: file.resourceKey ?? null });
      if (file.mimeType === SHORTCUT && file.shortcutDetails?.targetMimeType === FOLDER && validId(file.shortcutDetails.targetId))
        matches.set(file.shortcutDetails.targetId, { id: file.shortcutDetails.targetId, resourceKey: file.shortcutDetails.targetResourceKey ?? null });
    }
    if (matches.size > 1) throw apiError(errorPrefix + '_FOLDER_AMBIGUOUS');
    pageToken = page.nextPageToken;
    if (pageToken && seenTokens.has(pageToken)) throw apiError('DRIVE_UPSTREAM_ERROR');
    if (pageToken) seenTokens.add(pageToken);
    if (seenTokens.size > 100) throw apiError('SCAN_LIMIT_EXCEEDED');
  } while (pageToken);
  if (!matches.size) throw apiError(errorPrefix + '_FOLDER_NOT_FOUND');
  return matches.values().next().value;
}

// One automatic attempt per source/policy; a cancelled or failed attempt is retried manually.
// Active jobs defer scheduling until the next check; multiple worker instances cannot duplicate a live job.
export async function queueModelScopeRefresh(pool) {
  return (await pool.query(
    `insert into drive_sync_jobs(source_id, content_domain, mode, status, checkpoint)
     select s.id, d.domain, 'FULL', 'QUEUED', jsonb_build_object('scopeRefresh', $1::text)
       from drive_sources s cross join (values ('3dmodels'),('3dscenes')) d(domain)
      where s.enabled and (upper(trim(s.root_folder_name)) = '3DSMOOD'
        or upper(trim(s.root_folder_name)) = case when d.domain='3dscenes' then '3DSCENES' else '3DMODELS' end)
        and not exists(select 1 from drive_sync_jobs j where j.source_id = s.id and j.content_domain = d.domain
          and (j.status in ('QUEUED','RUNNING','CANCELLING') or j.checkpoint->>'scopeRefresh' = $1
            or (j.mode = 'FULL' and j.status = 'COMPLETED' and j.error_count = 0
              and j.checkpoint #>> '{scan,scopePolicy}' = $1 and j.checkpoint #>> '{scan,done}' = 'true')))
     on conflict do nothing returning id`, [MODEL_SCOPE_POLICY])).rowCount;
}
