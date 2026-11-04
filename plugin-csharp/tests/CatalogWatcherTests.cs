// P4.3 step 3b: CatalogUpdateWatcher — poll while the panel is open, SSE for instant updates, offline status, preview sync.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using MaxWebViewHost;

class CatalogWatcherTests
{
    // Byte feed for the SSE connection: the test writes frames, Close() ends the stream.
    sealed class FeedStream : Stream
    {
        readonly BlockingCollection<byte[]> queue = new BlockingCollection<byte[]>(); byte[] current = new byte[0]; int offset; bool closed;
        public void Send(string text) { queue.Add(Encoding.UTF8.GetBytes(text)); }
        public void Close2() { queue.CompleteAdding(); }
        public override async Task<int> ReadAsync(byte[] buffer, int off, int count, CancellationToken ct)
        {
            if (offset >= current.Length)
            {
                byte[] next = null;
                await Task.Run(() => { try { queue.TryTake(out next, Timeout.Infinite, ct); } catch (OperationCanceledException) { } });
                ct.ThrowIfCancellationRequested();
                if (next == null) return 0;
                current = next; offset = 0;
            }
            var n = Math.Min(count, current.Length - offset); Array.Copy(current, offset, buffer, off, n); offset += n; return n;
        }
        public override int Read(byte[] b, int o, int c) { throw new NotSupportedException(); }
        public override bool CanRead { get { return true; } } public override bool CanSeek { get { return false; } } public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } } public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { } public override long Seek(long o, SeekOrigin s) { throw new NotSupportedException(); } public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
        protected override void Dispose(bool disposing) { closed = true; base.Dispose(disposing); }
    }

    sealed class Server : HttpMessageHandler
    {
        public int Version = 1; public bool Down; public ConcurrentQueue<FeedStream> Streams = new ConcurrentQueue<FeedStream>(); public bool EventsDown;
        public int VersionCalls, EventConnections; public List<string> PreviewRequests = new List<string>(); public Dictionary<string, byte[]> Images = new Dictionary<string, byte[]>();
        public int Models = 2; public bool FailPreviews;
        public string ETag { get { return "\"v" + Version + "\""; } }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            var path = r.RequestUri.AbsolutePath;
            if (Down && path != "/api/v1/catalog/events") throw new HttpRequestException("down");
            if (path == "/api/v1/catalog/events")
            {
                Interlocked.Increment(ref EventConnections);
                if (Down || EventsDown) throw new HttpRequestException("down");
                var feed = new FeedStream(); Streams.Enqueue(feed);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(feed) });
            }
            if (path.StartsWith("/previews/"))
            {
                lock (PreviewRequests) PreviewRequests.Add(path);
                if (FailPreviews) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
                byte[] data; var sha = Path.GetFileNameWithoutExtension(path);
                return Task.FromResult(Images.TryGetValue(sha, out data) ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(data) } : new HttpResponseMessage(HttpStatusCode.NotFound));
            }
            if (path == "/api/v1/catalog/version")
            {
                Interlocked.Increment(ref VersionCalls);
                if (r.Headers.IfNoneMatch.ToString() == ETag) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotModified));
                return Task.FromResult(Json(new Dictionary<string, object> { { "catalogVersion", Version } }, ETag));
            }
            if (path == "/api/v1/catalog")
                return Task.FromResult(Json(new Dictionary<string, object> { { "catalogVersion", Version }, { "models", Enumerable.Range(1, Models).Select(i => new Dictionary<string, object> { { "id", Uuid(i) }, { "name", "M" + i } }).ToArray() } }));
            if (path == "/api/v1/categories") return Task.FromResult(Json(new[] { new Dictionary<string, object> { { "id", Uuid(900) }, { "name", "Living" } } }));
            if (path == "/api/v1/previews/manifest")
            {
                var list = new List<object>();
                for (var i = 1; i <= Models; i++)
                {
                    var data = Encoding.UTF8.GetBytes("img-" + Version + "-" + i); var sha = Sha(data); Images[sha] = data;
                    list.Add(new Dictionary<string, object> { { "modelId", Uuid(i) }, { "variant", "sm" }, { "url", "/previews/" + sha + ".webp" }, { "sha256", sha }, { "fileSize", data.Length } });
                }
                return Task.FromResult(Json(new Dictionary<string, object> { { "catalogVersion", Version }, { "previews", list.ToArray() } }));
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
    static HttpResponseMessage Json(object body, string etag = null)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(new JavaScriptSerializer().Serialize(body), Encoding.UTF8, "application/json") };
        if (etag != null) r.Headers.TryAddWithoutValidation("ETag", etag);
        return r;
    }
    static string Sha(byte[] d) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(d)).Replace("-", "").ToLowerInvariant(); }
    static string Uuid(int n) { return "00000000-0000-4000-8000-" + n.ToString("D12"); }
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static async Task Until(Func<bool> condition, string what, int ms = 5000)
    {
        var end = DateTime.UtcNow.AddMilliseconds(ms);
        while (!condition()) { if (DateTime.UtcNow > end) throw new Exception("timeout waiting for " + what); await Task.Delay(10); }
    }

    // Manual clock: delay(interval) completes when the test calls Tick(); delays of 'instant' length complete at once.
    sealed class Clock
    {
        public readonly ConcurrentQueue<TaskCompletionSource<bool>> Waiters = new ConcurrentQueue<TaskCompletionSource<bool>>(); public int Requested; public TimeSpan Instant = TimeSpan.FromMilliseconds(300);
        public Task Delay(TimeSpan span, CancellationToken ct)
        {
            Interlocked.Increment(ref Requested);
            if (span < TimeSpan.FromSeconds(1)) return Task.Delay(span, ct); // debounce: real, short
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously); ct.Register(() => tcs.TrySetCanceled()); Waiters.Enqueue(tcs); return tcs.Task;
        }
        public void Tick() { TaskCompletionSource<bool> w; for (var n = Waiters.Count; n > 0 && Waiters.TryDequeue(out w); n--) w.TrySetResult(true); }
    }

    sealed class Rig : IDisposable
    {
        public Server Server = new Server(); public Clock Clock = new Clock(); public string Root; public CatalogCacheService Catalog; public PreviewCacheService Previews; public CatalogUpdateWatcher Watcher;
        public List<int> Updates = new List<int>(); public List<bool> Offline = new List<bool>();
        public Rig(string root)
        {
            Root = root; var api = new BackendApi(new Uri("https://api.example.test/"), new HttpClient(Server));
            Catalog = new CatalogCacheService(Path.Combine(root, "Catalog"), api);
            Previews = new PreviewCacheService(Path.Combine(root, "Previews"), api, a => TimeSpan.Zero);
            Watcher = new CatalogUpdateWatcher(Catalog, Previews, api, TimeSpan.FromMinutes(5), Clock.Delay, a => TimeSpan.FromSeconds(10));
            Watcher.Updated += c => { lock (Updates) Updates.Add(c.CatalogVersion); };
            Watcher.OfflineChanged += o => { lock (Offline) Offline.Add(o); };
        }
        public void Dispose() { Watcher.Dispose(); }
    }

    static void Main() { try { Run().GetAwaiter().GetResult(); } catch (Exception e) { Console.WriteLine("FAILED: " + e); Environment.Exit(1); } }

    static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "watcher-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            // 0. SSE parser.
            {
                var events = new List<string>();
                var text = ": keepalive\r\nretry: 5000\r\nevent: catalog.updated\r\ndata: {\"catalogVersion\":3}\r\n\r\ndata: a\ndata: b\n\nevent: ignored\n\nid: 7\nevent: x\ndata: y\n\n";
                await SseParser.ReadAsync(new StringReader(text), (name, data) => events.Add(name + "=" + data), CancellationToken.None);
                Check(events.SequenceEqual(new[] { "catalog.updated={\"catalogVersion\":3}", "message=a\nb", "x=y" }), "SSE: comments/retry ignored, CRLF handled, data lines joined, empty events dropped");
                try { await SseParser.ReadAsync(new StringReader("data: " + new string('x', 100000) + "\n\n"), (n, d) => { }, CancellationToken.None); throw new Exception("oversized line accepted"); }
                catch (InvalidDataException) { Check(true, "SSE: a line over 64 KB is refused"); }
            }
            // 1. CheckNow: first call downloads catalog + previews, raises Updated once, prunes; second call is silent.
            {
                using (var rig = new Rig(Path.Combine(root, "t1")))
                {
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Updates.SequenceEqual(new[] { 1 }), "first check raises Updated(1)");
                    Check(rig.Server.PreviewRequests.Count == 2 && Directory.GetFiles(Path.Combine(rig.Root, "Previews"), "*.webp").Length == 2, "the previews of the new catalog are downloaded");
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Updates.Count == 1 && rig.Server.PreviewRequests.Count == 2, "unchanged: no event, no further preview traffic");
                    rig.Server.Version = 2;
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Updates.SequenceEqual(new[] { 1, 2 }), "a new version raises Updated(2)");
                    Check(Directory.GetFiles(Path.Combine(rig.Root, "Previews"), "*.webp").Length == 2, "after a fully successful preview sync, previews of the old version are pruned");
                    Check(rig.Watcher.Current != null && rig.Watcher.Current.CatalogVersion == 2, "Current exposes the latest catalog");
                }
            }
            // 2. Polling only while the panel is open: immediate check on open, then one per interval; none when closed.
            {
                using (var rig = new Rig(Path.Combine(root, "t2")))
                {
                    await Task.Delay(100);
                    Check(rig.Server.VersionCalls == 0, "nothing is polled before the panel is opened");
                    rig.Watcher.SetActive(true);
                    await Until(() => rig.Server.VersionCalls == 1, "immediate check on open");
                    await Until(() => rig.Clock.Waiters.Count >= 1, "poll loop waiting for its interval");
                    rig.Clock.Tick(); await Until(() => rig.Server.VersionCalls == 2, "second poll after one interval");
                    rig.Watcher.SetActive(false);
                    await Task.Delay(150); var calls = rig.Server.VersionCalls; rig.Clock.Tick(); await Task.Delay(150);
                    Check(rig.Server.VersionCalls == calls, "closing the panel stops polling");
                    rig.Watcher.SetActive(true);
                    await Until(() => rig.Server.VersionCalls == calls + 1, "reopening checks immediately");
                }
            }
            // 3. SSE: an event triggers a (debounced) check; a burst causes at most two; keepalives and foreign events do nothing.
            {
                using (var rig = new Rig(Path.Combine(root, "t3")))
                {
                    rig.Watcher.SetActive(true);
                    await Until(() => rig.Server.EventConnections == 1 && rig.Server.Streams.Count == 1, "SSE connection");
                    await Until(() => rig.Updates.Count == 1, "initial update");
                    FeedStream feed; rig.Server.Streams.TryPeek(out feed);
                    var before = rig.Server.VersionCalls;
                    feed.Send(": keepalive\n\nevent: other\ndata: {}\n\n"); await Task.Delay(700);
                    Check(rig.Server.VersionCalls == before, "keepalive and unknown events do not trigger checks");
                    rig.Server.Version = 2;
                    for (var i = 0; i < 5; i++) feed.Send("event: catalog.updated\ndata: {\"catalogVersion\":2}\n\n");
                    await Until(() => rig.Updates.Count == 2, "Updated(2) from SSE");
                    await Task.Delay(100);
                    Check(rig.Server.VersionCalls - before <= 2, "five events in a burst cause at most two checks (" + (rig.Server.VersionCalls - before) + ")");
                }
            }
            // 4. SSE drop: reconnects after the backoff; polling keeps working while SSE is down.
            {
                using (var rig = new Rig(Path.Combine(root, "t4")))
                {
                    rig.Server.EventsDown = true;
                    rig.Watcher.SetActive(true);
                    await Until(() => rig.Server.EventConnections == 1 && rig.Updates.Count == 1, "first SSE attempt failed, polling still delivers the catalog");
                    await Until(() => rig.Clock.Waiters.Count >= 2, "poll and reconnect both waiting");
                    rig.Server.EventsDown = false; rig.Clock.Tick();
                    await Until(() => rig.Server.Streams.Count == 1, "SSE reconnected after the backoff");
                    FeedStream feed; rig.Server.Streams.TryPeek(out feed);
                    feed.Close2();
                    await Until(() => rig.Clock.Waiters.Count >= 2, "a closed stream schedules a reconnect (next to the poll wait)");
                    rig.Clock.Tick();
                    await Until(() => rig.Server.EventConnections >= 3, "and reconnects again");
                }
            }
            // 5. Offline / online transitions are reported once each; the cached catalog is still available.
            {
                using (var rig = new Rig(Path.Combine(root, "t5")))
                {
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Offline.Count == 0, "no offline event while the server answers");
                    rig.Server.Down = true;
                    await rig.Watcher.CheckNowAsync(CancellationToken.None); await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Offline.SequenceEqual(new[] { true }), "going offline is reported once");
                    Check(rig.Watcher.Current != null && rig.Watcher.Current.CatalogVersion == 1, "the cached catalog stays available offline");
                    rig.Server.Down = false; rig.Server.Version = 2;
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Offline.SequenceEqual(new[] { true, false }) && rig.Updates.SequenceEqual(new[] { 1, 2 }), "coming back reports online and delivers the new version");
                }
            }
            // 6. Resilience: a throwing handler or a failing preview sync does not stop the watcher; Dispose stops all activity.
            {
                var rig = new Rig(Path.Combine(root, "t6"));
                var afterThrower = new List<int>();
                rig.Watcher.Updated += c => { throw new InvalidOperationException("handler bug"); };
                rig.Watcher.Updated += c => afterThrower.Add(c.CatalogVersion);
                await rig.Watcher.CheckNowAsync(CancellationToken.None);
                rig.Server.Version = 2; await rig.Watcher.CheckNowAsync(CancellationToken.None);
                Check(rig.Updates.SequenceEqual(new[] { 1, 2 }) && afterThrower.SequenceEqual(new[] { 1, 2 }), "a throwing Updated handler neither breaks later updates nor starves the handlers after it");
                rig.Watcher.SetActive(true);
                await Until(() => rig.Server.EventConnections >= 1, "connected");
                rig.Watcher.Dispose();
                var calls = rig.Server.VersionCalls; rig.Clock.Tick(); await Task.Delay(200);
                Check(rig.Server.VersionCalls == calls, "after Dispose nothing is requested");
                FeedStream feed; rig.Server.Streams.TryPeek(out feed);
            }
            // 6b. Previews that cannot be fetched: the new catalog is announced, old previews are NOT pruned, and the next check retries the sync.
            {
                using (var rig = new Rig(Path.Combine(root, "t6b")))
                {
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    var dir = Path.Combine(rig.Root, "Previews");
                    var v1 = Directory.GetFiles(dir, "*.webp").Select(Path.GetFileName).ToList();
                    rig.Server.Version = 2; rig.Server.FailPreviews = true;
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Updates.SequenceEqual(new[] { 1, 2 }) && v1.All(f => File.Exists(Path.Combine(dir, f))), "a failed preview sync still announces the catalog and keeps the old previews (no pruning)");
                    rig.Server.FailPreviews = false;
                    var before = rig.Server.PreviewRequests.Count;
                    await rig.Watcher.CheckNowAsync(CancellationToken.None);
                    Check(rig.Updates.Count == 2 && rig.Server.PreviewRequests.Count > before, "an unchanged catalog still retries previews that failed before");
                    Check(Directory.GetFiles(dir, "*.webp").Length == 2 && v1.All(f => !File.Exists(Path.Combine(dir, f))), "once everything is present the old previews are pruned");
                }
            }
            // 7. Overlapping CheckNow calls are serialised (never two catalog downloads at once).
            {
                using (var rig = new Rig(Path.Combine(root, "t7")))
                {
                    await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => rig.Watcher.CheckNowAsync(CancellationToken.None)));
                    Check(rig.Updates.SequenceEqual(new[] { 1 }) && rig.Server.PreviewRequests.Count == 2, "six simultaneous checks produce one update and one preview download set");
                }
            }
        }
        finally { try { Directory.Delete(root, true); } catch (IOException) { } }
        Console.WriteLine("Catalog watcher tests passed");
    }
}
