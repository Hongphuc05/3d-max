// Bounded, non-overlapping sweeps. PostgreSQL claims also coordinate API replicas.
export function startPaymentMaintenance(service, enabled) {
  if (!enabled) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await service.reconcilePending({ limit: 20 });
      if (result.failed) console.error('[payments] reconciliation requires retry', { failed: result.failed });
    } catch { console.error('[payments] reconciliation unavailable; retrying next cycle'); }
    finally { running = false; }
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
