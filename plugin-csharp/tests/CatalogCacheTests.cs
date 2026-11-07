// P4.3 step 2: CatalogCacheService — version/ETag polling, all-or-nothing consistent cache on disk, offline fallback.
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

class CatalogCacheTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Reply;
        public List<string> Calls = new List<string>();
        public List<string> IfNoneMatch = new List<string>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            if (!r.Headers.Contains("X-3dsmood-Content-Domains") || r.Headers.GetValues("X-3dsmood-Content-Domains").Single() != "1")
                throw new Exception("All native catalog requests must advertise mixed content-domain capability.");
            lock (Calls) { Calls.Add(r.RequestUri.AbsolutePath); IfNoneMatch.Add(r.Headers.IfNoneMatch.Count == 0 ? null : r.Headers.IfNoneMatch.ToString()); }
            return Task.FromResult(Reply(r));
        }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly Uri Api = new Uri("https://api.example.test/");
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Hex(string seed) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(seed))).Replace("-", "").ToLowerInvariant(); }
    static string Uuid(int n) { return "00000000-0000-4000-8000-" + n.ToString("D12"); }
    static HttpResponseMessage JsonOk(object body, string etag = null)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Json.Serialize(body), Encoding.UTF8, "application/json") };
        if (etag != null) r.Headers.TryAddWithoutValidation("ETag", etag);
        return r;
    }

    // Fake catalog server for a given version with N models.
    sealed class Server
    {
        public int Version = 1, Models = 2; public Func<int> ManifestVersion; public Action<Dictionary<string, object>> BreakManifest; public Action<Dictionary<string, object>> BreakCatalog;
        public string ETag { get { return "\"v" + Version + "\""; } }
        public HttpResponseMessage Handle(HttpRequestMessage r)
        {
            var path = r.RequestUri.AbsolutePath;
            if (path == "/api/v1/catalog/version")
            {
                if (r.Headers.IfNoneMatch.ToString() == ETag) { var nm = new HttpResponseMessage(HttpStatusCode.NotModified); nm.Headers.TryAddWithoutValidation("ETag", ETag); return nm; }
                return JsonOk(new Dictionary<string, object> { { "catalogVersion", Version }, { "manifestChecksum", Hex("m" + Version) }, { "publishedAt", "2026-11-01T00:00:00Z" } }, ETag);
            }
            if (path == "/api/v1/catalog")
            {
                var d = new Dictionary<string, object> { { "catalogVersion", Version }, { "models", Enumerable.Range(1, Models).Select(i => new Dictionary<string, object> {
                    { "id", Uuid(i) }, { "name", "Model " + i }, { "categoryId", Uuid(900) }, { "priceVnd", 15000 }, { "sizeBytes", 1000 }, { "fileType", "rar" }, { "status", "PUBLISHED" } }).ToArray() } };
                if (BreakCatalog != null) BreakCatalog(d);
                return JsonOk(d);
            }
            if (path == "/api/v1/categories")
                return JsonOk(new[] { new Dictionary<string, object> { { "id", Uuid(900) }, { "parentId", null }, { "name", "Living" }, { "fullPath", "Living" }, { "modelCount", Models } } });
            if (path == "/api/v1/previews/manifest")
            {
                var v = ManifestVersion != null ? ManifestVersion() : Version;
                var previews = Enumerable.Range(1, Models).SelectMany(i => new[] { "sm", "lg" }.Select(variant => new Dictionary<string, object> {
                    { "modelId", Uuid(i) }, { "variant", variant }, { "url", "/previews/" + Hex(i + variant + Version) + ".webp" }, { "sha256", Hex(i + variant + Version) },
                    { "version", 1 }, { "fileSize", 5000 }, { "width", 320 }, { "height", 240 } })).ToArray();
                var d = new Dictionary<string, object> { { "catalogVersion", v }, { "previews", previews } };
                if (BreakManifest != null) BreakManifest(d);
                return JsonOk(d);
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }
    }

    static void Main() { Run().GetAwaiter().GetResult(); }
    static async Task<string> CodeOf(Func<Task> action)
    {
        try { await action(); } catch (ApiException e) { return e.Code; }
        return null;
    }
    static string[] Leftovers(string dir) { return Directory.Exists(dir) ? Directory.GetFiles(dir, "*.tmp") : new string[0]; }

    static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "catalog-cache-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            {
                var server = new Server();
                server.BreakCatalog = d => {
                    var models = (Dictionary<string, object>[])d["models"];
                    models[0]["contentDomain"] = "3dscenes";
                    models[0]["categoryIds"] = new[] { Uuid(900), Uuid(901) };
                };
                server.BreakManifest = d => {
                    foreach (var p in (Dictionary<string, object>[])d["previews"])
                        p["url"] = "/previews/3dscenes/" + p["sha256"] + ".webp";
                };
                var dir = Path.Combine(root, "scoped");
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(new Fake { Reply = server.Handle })));
                var updated = await cache.UpdateAsync(CancellationToken.None);
                var restored = cache.Load();
                Check(updated.Catalog.Previews.All(p => p.Url.StartsWith("/previews/3dscenes/")) && restored.Previews[0].Url == updated.Catalog.Previews[0].Url, "scoped manifest URLs survive offline cache reload");
                Check(Encoding.UTF8.GetString(restored.CatalogJson).Contains("3dscenes") && Encoding.UTF8.GetString(restored.CatalogJson).Contains("categoryIds"), "mixed content domain and alias fields survive catalog cache unchanged");
                foreach (var bad in new[] { "/previews/unknown/", "/previews/3dscenes/extra/", "https://evil.test/previews/" })
                {
                    server.Version++;
                    server.BreakManifest = d => { foreach (var p in (Dictionary<string, object>[])d["previews"]) p["url"] = bad + p["sha256"] + ".webp"; };
                    Check(await CodeOf(async () => await cache.UpdateAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "unsafe preview URL rejected: " + bad);
                }
            }
            // 1. First update stores a consistent set; Load returns it; nothing temporary is left.
            {
                var dir = Path.Combine(root, "t1"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                Check(cache.Load() == null, "empty cache loads as null");
                var result = await cache.UpdateAsync(CancellationToken.None);
                Check(result.Changed && !result.Offline && result.Catalog.CatalogVersion == 1, "first update downloads and reports a change");
                Check(result.Catalog.Previews.Length == 4 && result.Catalog.ModelIds.Length == 2, "previews and model ids are parsed");
                Check(fake.Calls.SequenceEqual(new[] { "/api/v1/catalog/version", "/api/v1/catalog", "/api/v1/categories", "/api/v1/previews/manifest" }), "exactly the four public endpoints, in order");
                Check(fake.Calls.Count == 4, "all four public endpoints advertise content-domain capability");
                Check(Leftovers(dir).Length == 0 && File.Exists(Path.Combine(dir, "meta.json")), "no temporary files; meta.json present");
                var again = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake))).Load();
                Check(again != null && again.CatalogVersion == 1 && Encoding.UTF8.GetString(again.CatalogJson).Contains("Model 1"), "a new instance reads the same cache from disk");
                Check(Encoding.UTF8.GetString(again.CategoriesJson).Contains("Living") && Encoding.UTF8.GetString(again.ManifestJson).Contains("previews"), "categories and manifest bytes are kept for offline serving");
            }
            // 2. Unchanged catalog costs a single 304; the stored ETag is sent.
            {
                var dir = Path.Combine(root, "t2"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                await cache.UpdateAsync(CancellationToken.None);
                fake.Calls.Clear(); fake.IfNoneMatch.Clear();
                var result = await cache.UpdateAsync(CancellationToken.None);
                Check(!result.Changed && !result.Offline && fake.Calls.Count == 1 && fake.IfNoneMatch[0] == server.ETag, "unchanged: one request with If-None-Match, answered 304");
                Check(result.Catalog != null && result.Catalog.CatalogVersion == 1, "unchanged result still carries the cached catalog");
            }
            // 3. New version replaces the old one atomically.
            {
                var dir = Path.Combine(root, "t3"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                await cache.UpdateAsync(CancellationToken.None);
                server.Version = 2; server.Models = 3;
                var result = await cache.UpdateAsync(CancellationToken.None);
                Check(result.Changed && result.Catalog.CatalogVersion == 2 && result.Catalog.ModelIds.Length == 3, "a newer version is downloaded and replaces the cache");
                Check(new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake))).Load().CatalogVersion == 2, "the new version survives a restart");
                server.Version = 1; server.Models = 2;
                Check((await cache.UpdateAsync(CancellationToken.None)).Catalog.CatalogVersion == 1, "an administrator rolling back to an older version is followed (any change counts)");
            }
            // 4. Publish racing the download: catalog and manifest must agree; retried, else the old cache is kept.
            {
                var dir = Path.Combine(root, "t4"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                await cache.UpdateAsync(CancellationToken.None);
                server.Version = 5; int manifestCalls = 0;
                server.ManifestVersion = () => ++manifestCalls == 1 ? 4 : 5;
                var result = await cache.UpdateAsync(CancellationToken.None);
                Check(result.Catalog.CatalogVersion == 5 && manifestCalls == 2, "a catalog/manifest version mismatch is retried and then succeeds");
                server.Version = 6; server.ManifestVersion = () => 5;
                Check(await CodeOf(() => cache.UpdateAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "persistent mismatch fails instead of storing an inconsistent pair");
                Check(cache.Load().CatalogVersion == 5, "the previous consistent cache is untouched");
            }
            // 5. Offline: serve the cache; with no cache, report offline with nothing.
            {
                var dir = Path.Combine(root, "t5"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                var none = await new CatalogCacheService(Path.Combine(root, "t5b"), new BackendApi(Api, new HttpClient(new Fake { Reply = r => { throw new HttpRequestException("down"); } }))).UpdateAsync(CancellationToken.None);
                Check(none.Offline && none.Catalog == null && !none.Changed, "offline with no cache: Offline, no data");
                await cache.UpdateAsync(CancellationToken.None);
                fake.Reply = r => { throw new HttpRequestException("down"); };
                var offline = await cache.UpdateAsync(CancellationToken.None);
                Check(offline.Offline && !offline.Changed && offline.Catalog.CatalogVersion == 1, "offline with cache: the cached catalog is returned");
                fake.Reply = r => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                Check((await cache.UpdateAsync(CancellationToken.None)).Offline, "a 503 from the server is also treated as offline");
            }
            // 6. Corruption: a tampered/partial file invalidates the whole cache; the next update repairs it without trusting the ETag.
            {
                var dir = Path.Combine(root, "t6"); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                await cache.UpdateAsync(CancellationToken.None);
                File.WriteAllText(Path.Combine(dir, "catalog.json"), File.ReadAllText(Path.Combine(dir, "catalog.json")).Replace("Model 1", "Model X"));
                Check(cache.Load() == null, "a catalog.json that is still valid but no longer matches meta.json is rejected (hash check)");
                File.WriteAllText(Path.Combine(dir, "catalog.json"), "{\"catalogVersion\":1,\"models\":[]}");
                Check(cache.Load() == null, "a file that no longer matches meta.json makes Load() return null");
                fake.Calls.Clear(); fake.IfNoneMatch.Clear();
                var repaired = await cache.UpdateAsync(CancellationToken.None);
                Check(repaired.Changed && fake.IfNoneMatch[0] == null && repaired.Catalog.ModelIds.Length == 2, "repair: no If-None-Match, everything downloaded again");
                File.Delete(Path.Combine(dir, "manifest.json"));
                Check(cache.Load() == null, "a missing file invalidates the cache");
                File.WriteAllText(Path.Combine(dir, "meta.json"), "not json");
                Check(cache.Load() == null, "garbage meta.json invalidates the cache");
                File.WriteAllText(Path.Combine(dir, "stale.tmp"), "x");
                await cache.UpdateAsync(CancellationToken.None);
                Check(Leftovers(dir).Length == 0, "stale temporary files are cleaned up by an update");
            }
            // 7. Invalid server data is refused and never stored.
            {
                var cases = new Dictionary<string, Action<Server>>
                {
                    { "model id not a uuid", s => s.BreakCatalog = d => ((Dictionary<string, object>[])d["models"])[0]["id"] = "../x" },
                    { "model without a name", s => s.BreakCatalog = d => ((Dictionary<string, object>[])d["models"])[0]["name"] = "" },
                    { "duplicate model id", s => s.BreakCatalog = d => ((Dictionary<string, object>[])d["models"])[1]["id"] = ((Dictionary<string, object>[])d["models"])[0]["id"] },
                    { "preview url without its hash", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["url"] = "/previews/other.webp" },
                    { "preview url hash differs from sha256", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["url"] = "/previews/" + Hex("zzz") + ".webp" },
                    { "preview traversal", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["url"] = "/previews/../../etc/passwd" },
                    { "foreign preview host", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["url"] = "https://evil.test/previews/" + ((Dictionary<string, object>[])d["previews"])[0]["sha256"] + ".webp" },
                    { "unknown variant", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["variant"] = "xl" },
                    { "sha256 not hex", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["sha256"] = "zz" },
                    { "negative size", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["fileSize"] = -1 },
                    { "oversized preview", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["fileSize"] = 50 * 1024 * 1024 },
                    { "preview for unknown model", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[0]["modelId"] = Uuid(77) },
                    { "duplicate preview variant", s => s.BreakManifest = d => ((Dictionary<string, object>[])d["previews"])[1]["variant"] = ((Dictionary<string, object>[])d["previews"])[0]["variant"] },
                    { "catalog without models", s => s.BreakCatalog = d => d.Remove("models") },
                };
                foreach (var entry in cases)
                {
                    var dir = Path.Combine(root, "t7-" + Math.Abs(entry.Key.GetHashCode())); var server = new Server(); var fake = new Fake { Reply = server.Handle };
                    var cache = new CatalogCacheService(dir, new BackendApi(Api, new HttpClient(fake)));
                    await cache.UpdateAsync(CancellationToken.None);
                    server.Version = 2; entry.Value(server);
                    var code = await CodeOf(() => cache.UpdateAsync(CancellationToken.None));
                    Check(code == "SERVER_UNAVAILABLE" && cache.Load().CatalogVersion == 1, "invalid data '" + entry.Key + "' is refused and the old cache stays");
                }
            }
            // 8. Cancellation.
            {
                var server = new Server(); var cache = new CatalogCacheService(Path.Combine(root, "t8"), new BackendApi(Api, new HttpClient(new Fake { Reply = server.Handle })));
                using (var cts = new CancellationTokenSource())
                {
                    cts.Cancel();
                    try { await cache.UpdateAsync(cts.Token); throw new Exception("cancelled update succeeded"); } catch (OperationCanceledException) { Check(true, "cancellation is honoured"); }
                }
                Check(cache.Load() == null, "a cancelled update stores nothing");
            }
        }
        finally { try { Directory.Delete(root, true); } catch (IOException) { } }
        Console.WriteLine("Catalog cache tests passed");
    }
}
