using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MaxWebViewHost
{
    /// <summary>Minimal Server-Sent-Events reader: only the fields we use (event, data), bounded line and event size.</summary>
    internal static class SseParser
    {
        private const int MaxLine = 64 * 1024, MaxEvent = 1024 * 1024;

        public static async Task ReadAsync(TextReader reader, Action<string, string> onEvent, CancellationToken ct)
        {
            var buffer = new char[4096]; var line = new StringBuilder(); var data = (StringBuilder)null; string name = null; var skipLf = false;
            int read;
            while ((read = await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
            {
                ct.ThrowIfCancellationRequested();
                for (var i = 0; i < read; i++)
                {
                    var c = buffer[i];
                    if (skipLf) { skipLf = false; if (c == '\n') continue; }
                    if (c != '\n' && c != '\r')
                    {
                        if (line.Length >= MaxLine) throw new InvalidDataException("SSE line too long.");
                        line.Append(c); continue;
                    }
                    skipLf = c == '\r';
                    var text = line.ToString(); line.Clear();
                    if (text.Length == 0)
                    {
                        if (data != null) onEvent(name ?? "message", data.ToString());
                        data = null; name = null; continue;
                    }
                    if (text[0] == ':') continue;
                    var colon = text.IndexOf(':');
                    var field = colon < 0 ? text : text.Substring(0, colon);
                    var value = colon < 0 ? "" : text.Substring(colon + 1);
                    if (value.StartsWith(" ", StringComparison.Ordinal)) value = value.Substring(1);
                    if (field == "event") name = value;
                    else if (field == "data")
                    {
                        if (data == null) data = new StringBuilder(); else data.Append('\n');
                        if (data.Length + value.Length > MaxEvent) throw new InvalidDataException("SSE event too large.");
                        data.Append(value);
                    }
                }
            }
        }
    }

    /// <summary>Keeps the local catalog and previews current while the panel is open: an immediate check, one every few minutes,
    /// and an instant one when the server announces a publish (SSE). Never touches running downloads.</summary>
    internal sealed class CatalogUpdateWatcher : IDisposable
    {
        private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(250);
        private readonly CatalogCacheService catalog;
        private readonly PreviewCacheService previews;
        private readonly BackendApi api;
        private readonly TimeSpan pollInterval;
        private readonly Func<TimeSpan, CancellationToken, Task> delay;
        private readonly Func<int, TimeSpan> reconnectBackoff;
        private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1), previewGate = new SemaphoreSlim(1, 1);
        private readonly object state = new object();
        private CancellationTokenSource loops;
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private volatile CachedCatalog current;
        private bool offline, previewsPending = true, disposed;
        private int scheduled;

        public event Action<CachedCatalog> Updated;
        public event Action<bool> OfflineChanged;

        public CatalogUpdateWatcher(CatalogCacheService catalog, PreviewCacheService previews, BackendApi api, TimeSpan pollInterval,
            Func<TimeSpan, CancellationToken, Task> delay = null, Func<int, TimeSpan> reconnectBackoff = null)
        {
            if (catalog == null || previews == null || api == null) throw new ArgumentNullException();
            this.catalog = catalog; this.previews = previews; this.api = api; this.pollInterval = pollInterval;
            this.delay = delay ?? Task.Delay;
            this.reconnectBackoff = reconnectBackoff ?? (attempt => TimeSpan.FromSeconds(Math.Min(60, 5 << Math.Min(attempt, 4))));
        }

        public CachedCatalog Current { get { return current; } }

        /// <summary>Panel opened (true) or closed (false). Opening checks at once and starts polling + SSE.</summary>
        public void SetActive(bool active)
        {
            lock (state)
            {
                if (disposed) return;
                if (active && loops == null)
                {
                    var cts = loops = new CancellationTokenSource();
                    Task.Run(() => PollLoop(cts.Token));
                    Task.Run(() => SseLoop(cts.Token));
                }
                else if (!active && loops != null) { loops.Cancel(); loops = null; }
            }
        }

        /// <summary>Catalog step only (serialised): returns as soon as the catalog is cached, without waiting for preview downloads.
        /// Previews are synced by the next CheckNowAsync (previewsPending stays true until a sync succeeds).</summary>
        public async Task<CatalogUpdateResult> FetchCatalogAsync(CancellationToken ct)
        {
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var result = await catalog.UpdateAsync(ct).ConfigureAwait(false);
                if (result.Catalog != null) current = result.Catalog;
                SetOffline(result.Offline);
                if (!result.Offline && result.Catalog != null && result.Changed) Raise(Updated, result.Catalog);
                return result;
            }
            finally { gate.Release(); }
        }

        /// <summary>One check: catalog, then previews. Throws on invalid server data; being offline is not an error.
        /// The preview sync has its own gate, so a long first-run download never blocks the catalog step.</summary>
        public async Task CheckNowAsync(CancellationToken ct)
        {
            var result = await FetchCatalogAsync(ct).ConfigureAwait(false);
            if (result.Offline || result.Catalog == null) return;
            if (!result.Changed && !previewsPending) return;
            await previewGate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var summary = await previews.SyncAsync(result.Catalog.Previews, ct).ConfigureAwait(false);
                previewsPending = summary.Failed > 0;
                // Prune only against the newest manifest, and only after a complete sync.
                if (!previewsPending && ReferenceEquals(current, result.Catalog)) previews.Prune(result.Catalog.Previews);
            }
            finally { previewGate.Release(); }
        }

        /// <summary>Starts a full check (catalog + previews) without waiting; used when the first fetch succeeds off-schedule (retry after offline).</summary>
        public void CheckInBackground() { Task.Run(() => CheckSafeAsync(lifetime.Token)); }

        private async Task CheckSafeAsync(CancellationToken ct)
        {
            try { await CheckNowAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
            catch (Exception e) { Debug.WriteLine("[catalog] check failed: " + e.GetType().Name); }
        }

        private void SetOffline(bool value)
        {
            if (offline == value) return;
            offline = value;
            Raise(OfflineChanged, value);
        }

        private static void Raise<T>(Action<T> handler, T value)
        {
            if (handler == null) return;
            foreach (Action<T> each in handler.GetInvocationList())
            {
                try { each(value); } catch (Exception e) { Debug.WriteLine("[catalog] handler failed: " + e.GetType().Name); }
            }
        }

        private async Task PollLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                await CheckSafeAsync(ct).ConfigureAwait(false);
                try { await delay(pollInterval, ct).ConfigureAwait(false); } catch (OperationCanceledException) { return; }
            }
        }

        private async Task SseLoop(CancellationToken ct)
        {
            for (var attempt = 0; !ct.IsCancellationRequested; attempt++)
            {
                try
                {
                    using (var response = await api.OpenStreamAsync("/api/v1/catalog/events", null, ct).ConfigureAwait(false))
                    using (ct.Register(() => response.Dispose()))
                    using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        attempt = 0;
                        await SseParser.ReadAsync(reader, (name, data) => { if (name == "catalog.updated") ScheduleCheck(ct); }, ct).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
                catch (Exception e) when (e is ApiException || e is IOException || e is InvalidDataException || e is ObjectDisposedException || e is System.Net.Http.HttpRequestException) { }
                try { await delay(reconnectBackoff(attempt), ct).ConfigureAwait(false); } catch (OperationCanceledException) { return; }
            }
        }

        // A burst of announcements becomes one check, shortly after the first.
        private void ScheduleCheck(CancellationToken ct)
        {
            if (Interlocked.CompareExchange(ref scheduled, 1, 0) != 0) return;
            Task.Run(async () =>
            {
                try { await delay(Debounce, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { Interlocked.Exchange(ref scheduled, 0); return; }
                Interlocked.Exchange(ref scheduled, 0);
                await CheckSafeAsync(ct).ConfigureAwait(false);
            });
        }

        public void Dispose()
        {
            lock (state)
            {
                disposed = true;
                lifetime.Cancel();
                if (loops != null) { loops.Cancel(); loops = null; }
            }
        }
    }
}
