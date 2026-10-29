// Exponential backoff + jitter. Only errors flagged `retryable` are retried; permission/not-found never are.
export const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
});

export function backoffDelay(attempt, { baseMs = 1000, maxMs = 300_000, random = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(cap / 2 + random() * (cap / 2)); // "equal jitter": never below half, never above cap
}

export async function withRetry(fn, { retries = 6, baseMs, maxMs = 300_000, sleep = defaultSleep, random, signal, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      if (!error?.retryable || attempt >= retries || signal?.aborted) throw error;
      // A server-provided Retry-After wins, but is still bounded by maxMs.
      const wait = error.retryAfterMs != null ? Math.min(maxMs, error.retryAfterMs) : backoffDelay(attempt, { baseMs, maxMs, random });
      onRetry?.({ attempt: attempt + 1, waitMs: wait, code: error.code });
      await sleep(wait, signal);
    }
  }
}
