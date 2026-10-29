// Plain SQL access for Drive connections/sources. Returns only fields that are safe for admin screens:
// no tokens, no ciphertext, and never anything derived from them.
const connectionCols = 'id, google_account_email, auth_kind, status, connected_at, last_token_refresh_at, last_error_code';
const publicConnection = r => !r ? null : ({ id: r.id, email: r.google_account_email, authKind: r.auth_kind, status: r.status,
  connectedAt: r.connected_at, lastTokenRefreshAt: r.last_token_refresh_at, lastErrorCode: r.last_error_code });
const publicSource = r => ({ id: r.id, rootFolderName: r.root_folder_name, sourceType: r.source_type, enabled: r.enabled,
  lastSuccessfulSyncAt: r.last_successful_sync_at, connectionId: r.connection_id });

export function createDriveRepository(pool) {
  return {
    async latestConnection() {
      return publicConnection((await pool.query(`select ${connectionCols} from drive_connections order by connected_at desc limit 1`)).rows[0]);
    },
    async listSources() {
      return (await pool.query(`select id, connection_id, root_folder_name, source_type, enabled, last_successful_sync_at
        from drive_sources order by created_at`)).rows.map(publicSource);
    },
    // Internal only (worker/client calls). Never serialised to HTTP.
    async getSourceInternal(id) {
      return (await pool.query('select * from drive_sources where id = $1', [id])).rows[0] ?? null;
    },
    async firstEnabledSourceInternal() {
      return (await pool.query('select * from drive_sources where enabled order by created_at limit 1')).rows[0] ?? null;
    },
    async insertSource({ connectionId, folderId, name, resourceKey, sourceType, driveId }) {
      const { rows } = await pool.query(
        `insert into drive_sources (connection_id, root_folder_id, root_folder_name, root_resource_key, source_type, drive_id)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (connection_id, root_folder_id) do update set root_folder_name = excluded.root_folder_name,
           root_resource_key = excluded.root_resource_key, source_type = excluded.source_type, drive_id = excluded.drive_id, enabled = true
         returning id, connection_id, root_folder_name, source_type, enabled, last_successful_sync_at`,
        [connectionId, folderId, name.slice(0, 500), resourceKey ?? null, sourceType, driveId ?? null]);
      return publicSource(rows[0]);
    },
  };
}
