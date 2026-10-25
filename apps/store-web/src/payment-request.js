// Abort on timeout/unmount and release UI controls even if a transport stalls.
export async function paymentRequest(action, controller, timeoutMs = 20000) {
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) abort();
    else controller.signal.addEventListener('abort', abort, { once: true });
  });
  const timeout = setTimeout(() => controller.abort(Object.assign(new Error('Payment request timed out'),
    { code: 'PAYMENT_REQUEST_TIMEOUT' })), timeoutMs);
  try { return await Promise.race([Promise.resolve().then(() => action(controller.signal)), cancelled]); }
  finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); }
}
