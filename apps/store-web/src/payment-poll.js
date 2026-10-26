// One request at a time; finite retries and a timeout even on a stalled network.
export function pollPayment({ fetchOrder, onOrder, onError, onTimeout,
  interval = 1000, maxAttempts = 1200, schedule = setTimeout, unschedule = clearTimeout }) {
  let cancelled = false;
  let attempts = 0;
  let controller;
  let timer;
  const poll = async () => {
    if (cancelled) return;
    if (attempts++ >= maxAttempts) { onTimeout(); return; }
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const { order } = await fetchOrder(controller.signal);
      if (cancelled) return;
      onOrder(order);
      if (order.status !== 'PENDING') return;
    } catch (error) { if (!cancelled) onError(error); }
    finally { clearTimeout(timeout); }
    if (!cancelled) timer = schedule(poll, interval);
  };
  timer = schedule(poll, 0);
  return () => { cancelled = true; unschedule(timer); controller?.abort(); };
}
