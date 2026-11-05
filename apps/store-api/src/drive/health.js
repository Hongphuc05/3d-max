import { createDriveClient } from './client.js';

const HEALTH_LOCK = 727005;

// A single worker owns the periodic check. The advisory lock also protects deployments that run
// more than one worker replica. The probe reads only the configured root folder metadata.
export function startDriveKeyHealthMonitor({ pool, credentialStore, intervalMs = 10 * 60_000, logger = console }) {
  let stopped = false;
  let busy = false;
  let timer;

  async function tick() {
    if (stopped || busy) return;
    busy = true;
    let lockClient;
    let locked = false;
    let credential;
    try {
      lockClient = await pool.connect();
      locked = (await lockClient.query('select pg_try_advisory_lock($1) as locked', [HEALTH_LOCK])).rows[0].locked;
      if (!locked) return;
      credential = await credentialStore.getActiveCredential();
      if (!credential?.apiKey) return;
      const source = (await pool.query('select root_folder_id, root_resource_key from drive_sources where enabled order by created_at limit 1')).rows[0];
      if (!source) return;
      const client = createDriveClient({ apiKey: credential.apiKey, apiKeyHeader: true, retry: { retries: 0 } });
      await client.getFile(source.root_folder_id, { resourceKey: source.root_resource_key ?? undefined });
      await credentialStore.markHealthy(credential);
    } catch (error) {
      if (credential) {
        if (error?.code === 'DRIVE_QUOTA_EXCEEDED') await credentialStore.markRateLimited(credential, error).catch(() => {});
        else await credentialStore.markFailed(credential, error?.reason ?? error?.code).catch(() => {});
      }
      logger.warn?.('[drive-key-check]', credential?.slot ?? 'none', error?.code ?? 'DRIVE_CHECK_FAILED');
    } finally {
      if (locked) await lockClient.query('select pg_advisory_unlock($1)', [HEALTH_LOCK]).catch(() => {});
      lockClient?.release();
      busy = false;
    }
  }

  void tick();
  timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
