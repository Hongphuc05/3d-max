const adminLabel = (name) => !name || name === 'Admin' ? 'Admin' : `Admin ${name}`;

export function decisionMessage(outcome, decidedByName, source = 'Telegram') {
  const actor = adminLabel(decidedByName);
  const via = source === 'web' ? ' trên web' : '';
  if (outcome === 'CONFIRMED') return `✅ ĐÃ XÁC NHẬN NHẬN TIỀN — ${actor} đã xác nhận${via}; license thư viện đã được cấp.`;
  if (outcome === 'REJECTED') return `❌ ${actor} đã từ chối đơn${via}.`;
  return null;
}

export function alreadyDecidedMessage(order, decidedByName) {
  const actor = decidedByName ? ` Người xử lý: ${adminLabel(decidedByName)}` : '';
  return `ℹ️ Đơn đã được xử lý: ${order?.status ?? '?'}${actor}.`;
}
