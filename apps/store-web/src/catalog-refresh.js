// One request at a time. A failed refresh keeps the last successful snapshot.
export function watchCatalog({ fetchVersion, fetchSnapshot, onSnapshot, onStatus, onError,
  events = window, document: doc = document, schedule = setInterval, unschedule = clearInterval }) {
  let stopped = false, running = false, version, controller;
  const refresh = async () => {
    if (stopped || running) return;
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const status = await fetchVersion(controller.signal);
      if (stopped) return;
      onStatus(status);
      const identity = `${status.provider || ''}:${status.catalogKey || ''}:${status.version}`;
      if (version === undefined || identity !== version) {
        const snapshot = await fetchSnapshot(controller.signal);
        if (stopped) return;
        const latest = await fetchVersion(controller.signal);
        if (stopped) return;
        if (`${latest.provider || ''}:${latest.catalogKey || ''}:${latest.version}` !== identity) return;
        onSnapshot(snapshot);
        version = identity;
      }
    } catch (error) { if (!stopped) onError(error); }
    finally { clearTimeout(timeout); running = false; }
  };
  const foreground = () => { if (doc.visibilityState !== 'hidden') void refresh(); };
  const timer = schedule(refresh, 120000);
  events.addEventListener('focus', foreground);
  doc.addEventListener('visibilitychange', foreground);
  void refresh();
  return () => {
    stopped = true;
    controller?.abort();
    unschedule(timer);
    events.removeEventListener('focus', foreground);
    doc.removeEventListener('visibilitychange', foreground);
  };
}
