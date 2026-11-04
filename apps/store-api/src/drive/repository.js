// Plain SQL access for Drive sources. Returns only fields that are safe for admin screens:
// no tokens, no ciphertext, and never anything derived from them.
const publicSource = r => ({ id: r.id, rootFolderName: r.root_folder_name, sourceType: r.source_type, enabled: r.enabled,
  lastSuccessfulSyncAt: r.last_successful_sync_at, connectionId: r.connection_id });

export function createDriveRepository(pool) {
  return {
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
  };
}
