function backendConfiguration(env) {
  let endpoint;
  try { endpoint = new URL(env.BACKEND_R2_EVENT_URL); } catch { /* Fail closed below. */ }
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      !env.R2_EVENT_WEBHOOK_SECRET || /[\r\n]/.test(env.R2_EVENT_WEBHOOK_SECRET)) {
    throw new Error('R2_CONSUMER_CONFIGURATION_REQUIRED');
  }
  return { endpoint: endpoint.href, secret: env.R2_EVENT_WEBHOOK_SECRET };
}

// Each successful POST means the backend committed the event or its durable inbox entry.
// Errors are deliberately not logged: fetch errors may contain credentials or private keys.
export async function handleQueue(batch, env, { fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  const config = backendConfiguration(env);
  for (const message of batch.messages) {
    try {
      const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
      const response = await fetchImpl(config.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const accepted = response.ok;
      await response.body?.cancel().catch(() => {});
      if (!accepted) throw new Error('R2_BACKEND_REJECTED');
      message.ack();
    } catch {
      const attempt = Math.max(1, Math.min(10, Number(message.attempts) || 1));
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** (attempt - 1)) });
    }
  }
}

export default { queue(batch, env) { return handleQueue(batch, env); } };
