// P5.2: job dinh ky 1 phut danh dau don het han (UPDATE ... WHERE expires_at <= now()).
// KHONG sua tin nhan Telegram: don khach da bao chuyen khoan van xac nhan duoc sau khi het han (chu van con nut bam).
export function createOrderMaintenance({ service, intervalMs = 60_000 }) {
  let timer, running = false;
  async function runOnce() {
    const swept = await service.expireDue();
    return swept.length;
  }
  return {
    runOnce,
    start() {
      timer = setInterval(async () => {
        if (running) return; running = true;
        try { await runOnce(); } catch (e) { console.error('[orders] expiry sweep failed', e?.code ?? e?.name ?? 'INTERNAL'); } finally { running = false; }
      }, intervalMs);
      timer.unref();
    },
    stop() { clearInterval(timer); },
  };
}
