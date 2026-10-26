const changeEvents = ['message', 'catalog.changed', 'category.created', 'category.updated',
  'category.deleted', 'model.created', 'model.updated', 'model.deleted', 'open'];
const identity = status => `${status.provider || ''}:${status.catalogKey || ''}:${status.version}`;

// Native EventSource reconnects automatically. Every reconnect refetches the catalog,
// so missed events and server restarts recover without relying on an event history.
const connect = url => typeof globalThis.EventSource === 'function' ? new EventSource(url) : null;

// One request at a time. A failed refresh keeps the last successful snapshot.
export function watchCatalog({ fetchVersion, fetchSnapshot, onSnapshot, onStatus, onError,
  events = window, document: doc = document, schedule = setInterval, unschedule = clearInterval,
  createEventSource = connect, location: pageLocation = globalThis.location }) {
  // The packaged app serves API responses through a bounded native proxy. Keep
  // its catalog current with short foreground polling rather than an SSE stream.
  const packaged = pageLocation?.origin === 'https://app.3dsmood.local';
  let stopped = false, running = false, version, controller, pending = false;
  const refresh = async (force = false) => {
    if (stopped) return;
    if (running) { if (force) pending = true; return; }
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const status = await fetchVersion(controller.signal);
      if (stopped) return;
      onStatus(status);
      const current = identity(status);
      if (force || version === undefined || current !== version) {
        const snapshot = await fetchSnapshot(controller.signal);
        if (stopped) return;
        const latest = await fetchVersion(controller.signal);
        if (stopped) return;
        if (identity(latest) !== current) { pending = true; return; }
        onSnapshot(snapshot);
        version = current;
      }
    } catch (error) { if (!stopped) onError(error); }
    finally {
      clearTimeout(timeout); running = false;
      if (pending && !stopped) { pending = false; void refresh(true); }
    }
  };
  const foreground = () => { if (doc.visibilityState !== 'hidden') void refresh(); };
  const changed = () => { void refresh(true); };
  let source;
  if (!packaged) {
    try { source = createEventSource('/api/catalog/events'); } catch { /* Polling remains available. */ }
  }
  changeEvents.forEach(type => source?.addEventListener(type, changed));
  const timer = schedule(packaged ? foreground : () => refresh(), packaged ? 15000 : 120000);
  events.addEventListener('focus', foreground);
  doc.addEventListener('visibilitychange', foreground);
  void refresh();
  return () => {
    stopped = true;
    controller?.abort();
    changeEvents.forEach(type => source?.removeEventListener(type, changed));
    source?.close();
    unschedule(timer);
    events.removeEventListener('focus', foreground);
    doc.removeEventListener('visibilitychange', foreground);
  };
}
