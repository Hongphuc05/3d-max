// P4.3 step 3: PreviewCacheService — first-run download, 4-way verified background download, pause/resume, prune.
using System;
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

class PreviewCacheTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>();
        public Func<string, HttpResponseMessage> Override;
        public List<string> Requests = new List<string>();
        public int Active, MaxActive; public int DelayMs = 5;
        public Func<string, int, bool> Fail;            // (sha, attempt) -> throw network error
        readonly Dictionary<string, int> attempts = new Dictionary<string, int>();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            var path = r.RequestUri.AbsolutePath; int attempt;
            lock (this) { Requests.Add(path); Active++; MaxActive = Math.Max(MaxActive, Active); attempts[path] = attempt = (attempts.ContainsKey(path) ? attempts[path] : 0) + 1; }
            try
            {
                await Task.Delay(DelayMs, t);
                var sha = Path.GetFileNameWithoutExtension(path);
                if (Fail != null && Fail(sha, attempt)) throw new HttpRequestException("network down");
                if (Override != null) { var o = Override(sha); if (o != null) return o; }
                byte[] data;
                if (!path.StartsWith("/previews/") || !Files.TryGetValue(sha, out data)) return new HttpResponseMessage(HttpStatusCode.NotFound);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(data) };
            }
            finally { lock (this) Active--; }
        }
    }
    static readonly Uri Api = new Uri("https://api.example.test/");
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Sha(byte[] d) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(d)).Replace("-", "").ToLowerInvariant(); }
    static byte[] Image(int n) { var b = new byte[200 + n]; new Random(n).NextBytes(b); b[0] = (byte)'R'; b[1] = (byte)'I'; b[2] = (byte)'F'; b[3] = (byte)'F'; return b; }
    static string Uuid(int n) { return "00000000-0000-4000-8000-" + n.ToString("D12"); }
    static PreviewEntry Entry(int model, string variant, byte[] data) { return new PreviewEntry { ModelId = Uuid(model), Variant = variant, Sha256 = Sha(data), FileSize = data.Length }; }

    sealed class Rig
    {
        public Fake Fake = new Fake(); public string Root, Cache; public PreviewCacheService Service; public List<PreviewEntry> Entries = new List<PreviewEntry>(); public List<byte[]> Data = new List<byte[]>();
        public Rig(string root, int count, bool serve = true)
        {
            Root = root; Cache = Path.Combine(root, "Previews");
            for (var i = 1; i <= count; i++) { var d = Image(i); Data.Add(d); Entries.Add(Entry(i, i % 2 == 0 ? "lg" : "sm", d)); if (serve) Fake.Files[Sha(d)] = d; }
            Service = Make();
        }
        public PreviewCacheService Make() { return new PreviewCacheService(Cache, new BackendApi(Api, new HttpClient(Fake)), attempt => TimeSpan.Zero); }
        public bool Has(int i) { return File.Exists(Path.Combine(Cache, Entries[i].Sha256 + ".webp")); }
    }

    static void Main() { Run().GetAwaiter().GetResult(); }
    static string[] Parts(string dir) { return Directory.Exists(dir) ? Directory.GetFiles(dir, "*.part") : new string[0]; }

    static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "preview-cache-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            // 1. First run: the cache is empty and one sync downloads every preview, each verified.
            {
                var rig = new Rig(Path.Combine(root, "t1"), 6);
                var summary = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(summary.Total == 6 && summary.Done == 6 && summary.Failed == 0 && Enumerable.Range(0, 6).All(rig.Has), "first sync downloads every preview");
                Check(rig.Fake.Requests.Count == 6 && Parts(rig.Cache).Length == 0, "one request per preview and no .part files left");
                File.Delete(Path.Combine(rig.Cache, rig.Entries[0].Sha256 + ".webp"));
                var again = await rig.Make().SyncAsync(rig.Entries, CancellationToken.None);
                Check(again.Done == 6 && rig.Has(0) && rig.Fake.Requests.Count == 7, "a second sync fetches only the deleted file");
            }
            // 2b. Restart: a truncated file (right name, wrong size) is replaced; intact files are not requested again.
            {
                var rig = new Rig(Path.Combine(root, "t2b"), 4);
                await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                File.WriteAllBytes(Path.Combine(rig.Cache, rig.Entries[1].Sha256 + ".webp"), new byte[5]);
                var requestsBefore = rig.Fake.Requests.Count;
                var restart = await rig.Make().SyncAsync(rig.Entries, CancellationToken.None);
                Check(restart.Done == 4 && restart.Failed == 0, "restart: all four end up present and verified");
                Check(rig.Fake.Requests.Count == requestsBefore + 1 && new FileInfo(Path.Combine(rig.Cache, rig.Entries[1].Sha256 + ".webp")).Length == rig.Data[1].Length, "restart: only the damaged preview is fetched again");
            }
            // 3. Download: at most 4 in parallel, every file verified, order follows priority then sm-before-lg.
            {
                var rig = new Rig(Path.Combine(root, "t3"), 12); rig.Fake.DelayMs = 30;
                rig.Service.Prioritize(new[] { Uuid(11), Uuid(12) });
                var summary = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(summary.Done == 12 && rig.Fake.MaxActive == 4, "12 previews downloaded with exactly 4 in flight at most (max " + rig.Fake.MaxActive + ")");
                var first = rig.Fake.Requests.Take(4).Select(p => Path.GetFileNameWithoutExtension(p)).ToList();
                Check(first.Contains(rig.Entries[10].Sha256) && first.Contains(rig.Entries[11].Sha256), "previews of prioritised models are requested first");
                var order = rig.Fake.Requests.Select(p => rig.Entries.First(e => e.Sha256 == Path.GetFileNameWithoutExtension(p)).Variant).ToList();
                var afterPriority = order.Skip(4).ToList();
                Check(afterPriority.TakeWhile(v => v == "sm").Count() >= afterPriority.Count(v => v == "sm") - 1, "small variants come before large ones (after the prioritised models)");
                Check(Parts(rig.Cache).Length == 0, "no .part left after a successful sync");
            }
            // 4. Verification: wrong content, wrong size, HTML page, 404 are never stored and are retried 3 times, then counted as failed.
            {
                var rig = new Rig(Path.Combine(root, "t4"), 6);
                rig.Fake.Override = sha =>
                {
                    var i = rig.Entries.FindIndex(e => e.Sha256 == sha);
                    if (i == 0) return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Image(500)) };                                  // wrong bytes
                    if (i == 1) return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(rig.Data[1].Take(50).ToArray()) };            // truncated
                    if (i == 2) return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(rig.Data[2].Concat(new byte[10]).ToArray()) };  // too long
                    if (i == 3) return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>login</html>", Encoding.UTF8, "text/html") };
                    if (i == 4) return new HttpResponseMessage(HttpStatusCode.NotFound);
                    return null;
                };
                var summary = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(summary.Done == 1 && summary.Failed == 5, "5 bad responses fail, the good one succeeds (done " + summary.Done + ", failed " + summary.Failed + ")");
                Check(!rig.Has(0) && !rig.Has(1) && !rig.Has(2) && !rig.Has(3) && !rig.Has(4) && rig.Has(5) && Parts(rig.Cache).Length == 0, "nothing unverified is published and no .part is left");
                Check(rig.Fake.Requests.Count(p => p.Contains(rig.Entries[0].Sha256)) == 3, "a bad file is attempted three times");
                rig.Fake.Override = null;
                var retry = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(retry.Failed == 0 && retry.Done == 6, "the next sync recovers the failed previews (no negative caching)");
            }
            // 4b. Same length, different content: only the hash can tell. Out-of-range sizes are never requested.
            {
                var rig = new Rig(Path.Combine(root, "t4b"), 3);
                rig.Fake.Override = sha => rig.Entries.FindIndex(e => e.Sha256 == sha) == 0 ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(rig.Data[0].Select(b => (byte)(b ^ 1)).ToArray()) } : null;
                var summary = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(summary.Done == 2 && summary.Failed == 1 && !rig.Has(0), "a body of the right length but the wrong content is rejected by its hash");
                var rig2 = new Rig(Path.Combine(root, "t4c"), 1);
                var zero = new PreviewEntry { ModelId = Uuid(1), Variant = "sm", Sha256 = rig2.Entries[0].Sha256, FileSize = 0 };
                var huge = new PreviewEntry { ModelId = Uuid(2), Variant = "sm", Sha256 = new string('b', 64), FileSize = 100L * 1024 * 1024 };
                var bounded = await rig2.Service.SyncAsync(new[] { zero, huge }, CancellationToken.None);
                Check(bounded.Failed == 2 && rig2.Fake.Requests.Count == 0, "a manifest size of 0 or 100 MB is refused without any request");
            }
            // 5. Network loss mid-way: finished files stay, the rest is reported failed, no exception; later sync completes.
            {
                var rig = new Rig(Path.Combine(root, "t5"), 8);
                rig.Fake.Fail = (sha, attempt) => rig.Entries.FindIndex(e => e.Sha256 == sha) >= 4;
                var summary = await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(summary.Done == 4 && summary.Failed == 4, "lost connection: 4 stored, 4 failed, no exception");
                rig.Fake.Fail = null;
                Check((await rig.Service.SyncAsync(rig.Entries, CancellationToken.None)).Done == 8, "when the network returns a new sync finishes the job");
            }
            // 6. Progress events: monotonic and ending at the total.
            {
                var rig = new Rig(Path.Combine(root, "t6"), 7); var events = new List<int[]>();
                rig.Service.Progress += (done, total) => { lock (events) events.Add(new[] { done, total }); };
                await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                Check(events.Count > 0 && events.All(e => e[1] == 7) && events.Zip(events.Skip(1), (a, b) => b[0] >= a[0]).All(x => x) && events.Last()[0] == 7, "progress is monotonic and ends at 7/7");
            }
            // 7. Pause / resume / cancel.
            {
                var rig = new Rig(Path.Combine(root, "t7"), 10); rig.Fake.DelayMs = 40;
                rig.Service.Pause();
                var run = rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                await Task.Delay(200);
                Check(rig.Fake.Requests.Count == 0 && !run.IsCompleted, "while paused nothing is downloaded");
                rig.Service.Resume();
                var summary = await run;
                Check(summary.Done == 10, "after Resume() the sync completes");
                var rig2 = new Rig(Path.Combine(root, "t7b"), 10); rig2.Fake.DelayMs = 40;
                using (var cts = new CancellationTokenSource())
                {
                    var running = rig2.Service.SyncAsync(rig2.Entries, cts.Token);
                    await Task.Delay(60); cts.Cancel();
                    try { await running; throw new Exception("cancelled sync completed"); } catch (OperationCanceledException) { Check(true, "cancellation stops the sync"); }
                    await Task.Delay(100);
                    Check(Parts(rig2.Cache).Length == 0, "cancellation leaves no .part files");
                }
            }
            // 8. Prune: files outside the wanted set (and stray .part files) go; wanted files stay.
            {
                var rig = new Rig(Path.Combine(root, "t8"), 4);
                await rig.Service.SyncAsync(rig.Entries, CancellationToken.None);
                File.WriteAllBytes(Path.Combine(rig.Cache, "stale.part"), new byte[3]);
                File.WriteAllBytes(Path.Combine(rig.Cache, Sha(Image(777)) + ".webp"), Image(777));
                File.WriteAllText(Path.Combine(rig.Cache, "notes.txt"), "keep me");
                var removed = rig.Service.Prune(rig.Entries.Take(2));
                Check(removed == 4 && rig.Has(0) && rig.Has(1) && !rig.Has(2) && !rig.Has(3) && File.Exists(Path.Combine(rig.Cache, "notes.txt")), "prune removes unreferenced previews and .part files, keeps wanted files and foreign files");
            }
            // 9. On-demand read: cached → no HTTP; missing → fetched once even when asked in parallel; invalid names refused; offline → ApiException.
            {
                var rig = new Rig(Path.Combine(root, "t9"), 3);
                var sha = rig.Entries[0].Sha256;
                var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => rig.Service.GetAsync(rig.Entries[0], CancellationToken.None)));
                Check(results.All(r => r.SequenceEqual(rig.Data[0])) && rig.Fake.Requests.Count == 1, "five parallel reads of an uncached preview cause one request");
                rig.Fake.Requests.Clear();
                Check((await rig.Service.GetAsync(rig.Entries[0], CancellationToken.None)).Length == rig.Data[0].Length && rig.Fake.Requests.Count == 0, "a cached preview is served without HTTP");
                Check(rig.Service.TryRead(sha).Length == rig.Data[0].Length && rig.Service.TryRead(rig.Entries[1].Sha256) == null, "TryRead returns cached bytes or null");
                foreach (var bad in new[] { "../x", sha + "/../a", "short", sha.ToUpperInvariant(), "", null })
                    Check(rig.Service.TryRead(bad) == null, "TryRead refuses '" + bad + "'");
                rig.Fake.Fail = (s, a) => true;
                try { await rig.Service.GetAsync(rig.Entries[1], CancellationToken.None); throw new Exception("offline read succeeded"); } catch (ApiException e) { Check(e.Code == "SERVER_UNAVAILABLE", "uncached preview while offline: SERVER_UNAVAILABLE"); }
            }
            // 10. Entries from the manifest with an unsafe hash are never requested.
            {
                var rig = new Rig(Path.Combine(root, "t10"), 1);
                var evil = new PreviewEntry { ModelId = Uuid(1), Variant = "sm", Sha256 = "../../etc/passwd", FileSize = 10 };
                var summary = await rig.Service.SyncAsync(new[] { evil }, CancellationToken.None);
                Check(summary.Failed == 1 && rig.Fake.Requests.Count == 0, "an unsafe hash is counted failed without any request");
            }
        }
        finally { try { Directory.Delete(root, true); } catch (IOException) { } }
        Console.WriteLine("Preview cache tests passed");
    }
}
