// P5.2: job dinh ky 1 phut danh dau don het han (UPDATE ... WHERE expires_at <= now()) va sua tin nhan Telegram con nut bam cua don do.
export function createOrderMaintenance({ service, client, intervalMs = 60_000 }) {
  let timer, running = false;
  async function runOnce() {
    const swept = await service.expireDue();
    for (const o of swept) {
      if (!client || !o.telegramChatId || !o.telegramMessageId) continue;
      await client.editMessageText({ chatId: String(o.telegramChatId), messageId: String(o.telegramMessageId), text: `⌛ Đơn ${o.code} đã hết hạn. Không cấp quyền.` }).catch(() => {});
    }
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
