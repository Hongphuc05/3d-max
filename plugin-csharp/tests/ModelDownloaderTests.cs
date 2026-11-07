// P4.3 step 6: BackendModelDownloader â€” import-session, verified stream to disk, retry rules.
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

class ModelDownloaderTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Reply;
        public List<string> Calls = new List<string>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            lock (Calls) Calls.Add(r.Method + " " + r.RequestUri.AbsolutePath + (r.Headers.Authorization != null ? " [" + r.Headers.Authorization.Parameter + "]" : ""));
            return Task.FromResult(Reply(r));
        }
    }
    sealed class Tokens : IDeviceTokenSource
    {
        public int Invalidations; public int Issued = 1; public string Current = new string('a', 43);
        public Task<string> GetTokenAsync(CancellationToken ct) { return Task.FromResult(Current); }
        public void Invalidate() { Invalidations++; Current = new string((char)('a' + ++Issued), 43); }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly Uri Api = new Uri("https://api.example.test/");
    static readonly string ModelId = "11111111-1111-4111-8111-111111111111";
    static readonly string SessionId = new string('S', 43);
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Md5(byte[] d) { using (var h = MD5.Create()) return BitConverter.ToString(h.ComputeHash(d)).Replace("-", "").ToLowerInvariant(); }
    static string Sha(byte[] d) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(d)).Replace("-", "").ToLowerInvariant(); }
    static HttpResponseMessage Err(int status, string code)
    { return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent("{\"error\":{\"code\":\"" + code + "\",\"message\":\"x\",\"requestId\":\"r\"}}", Encoding.UTF8, "application/json") }; }
    static Dictionary<string, object> Info(byte[] data, Action<Dictionary<string, object>> tweak = null)
    {
        var d = new Dictionary<string, object> { { "sessionId", SessionId }, { "expiresAt", DateTime.UtcNow.AddMinutes(5).ToString("o") }, { "sizeBytes", data.Length },
            { "md5", Md5(data) }, { "sha256", Sha(data) }, { "fileType", "rar" }, { "entryFile", null } };
        if (tweak != null) tweak(d);
        return d;
    }
    static HttpResponseMessage Created(Dictionary<string, object> info)
    { return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent(Json.Serialize(info), Encoding.UTF8, "application/json") }; }
    static HttpResponseMessage Stream(byte[] data) { return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(data) }; }
    static BackendModelDownloader Make(Fake fake, Tokens tokens) { return new BackendModelDownloader(new BackendApi(Api, new HttpClient(fake)), tokens, attempt => TimeSpan.Zero); }
    static string[] Parts(string dir) { return Directory.GetFiles(dir, "*.part"); }
    static async Task<string> CodeOf(Func<Task> action)
    {
        try { await action(); } catch (ApiException e) { return e.Code; }
        return null;
    }
    static byte[] Bytes(int n) { var b = new byte[n]; new Random(n).NextBytes(b); return b; }
    static void Main() { Run().GetAwaiter().GetResult(); }

    static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "downloader-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            var data = Bytes(300000); var dest = Path.Combine(root, "package.bin");
            // 1. Happy path.
            {
                var fake = new Fake(); var tokens = new Tokens(); var progress = new List<long>();
                fake.Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, d => { d["entryFile"] = "scene/main.max"; d["filename"] = "1106880206.rar"; })) : Stream(data);
                var info = await Make(fake, tokens).DownloadAsync(ModelId, dest, CancellationToken.None, (received, total) => progress.Add(received));
                Check(File.ReadAllBytes(dest).SequenceEqual(data) && Parts(root).Length == 0, "the verified file is published and no .part is left");
                Check(fake.Calls.SequenceEqual(new[] { "POST /api/v1/models/" + ModelId + "/import-session [" + tokens.Current + "]", "GET /api/v1/model-downloads/" + SessionId + " [" + tokens.Current + "]" }),
                    "one import-session then one stream, both with the device token");
                Check(info.FileType == "rar" && info.EntryFile == "scene/main.max" && info.SizeBytes == data.Length, "session info (type, entry file, size) is returned to the caller");
                Check(info.FileName == "1106880206.rar" && BackendModelDownloader.ParseInfo(Info(data)).FileName == null, "source filename is carried to the library and remains optional for older APIs");
                Check(progress.Count > 0 && progress.Zip(progress.Skip(1), (a, b) => b >= a).All(x => x) && progress.Last() == data.Length, "progress is monotonic and ends at the file size");
            }
            // 2. Verification uses whatever the server announced: sha256, else md5, else size only.
            {
                foreach (var drop in new[] { new[] { "sha256" }, new[] { "sha256", "md5" } })
                {
                    var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, d => { foreach (var k in drop) d[k] = null; })) : Stream(data) };
                    File.Delete(dest);
                    await Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null);
                    Check(File.Exists(dest), "downloads verified without " + string.Join("+", drop));
                }
                foreach (var bad in new Dictionary<string, Action<Dictionary<string, object>>> {
                    { "wrong sha256", d => d["sha256"] = Sha(Bytes(5)) }, { "wrong md5", d => d["md5"] = Md5(Bytes(5)) }, { "size larger than the stream", d => d["sizeBytes"] = data.Length + 1 }, { "size smaller than the stream", d => d["sizeBytes"] = data.Length - 1 } })
                {
                    File.Delete(dest);
                    var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, bad.Value)) : Stream(data) };
                    var code = await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null));
                    Check(code == "DOWNLOAD_VERIFICATION_FAILED" && !File.Exists(dest) && Parts(root).Length == 0, bad.Key + ": rejected, nothing published, no .part");
                }
                var pageText = "<html>captive portal</html>"; var html = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, d => { d["sizeBytes"] = pageText.Length; d["md5"] = null; d["sha256"] = null; })) : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(pageText, Encoding.UTF8, "text/html") } };
                Check(await CodeOf(() => Make(html, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "DOWNLOAD_VERIFICATION_FAILED", "an HTML page in place of the file is refused even when only the size is known");
            var shortOnly = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, d => { d["md5"] = null; d["sha256"] = null; d["sizeBytes"] = data.Length + 100; })) : Stream(data) };
                Check(await CodeOf(() => Make(shortOnly, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "DOWNLOAD_VERIFICATION_FAILED", "with only a size announced, a shorter stream is still refused");
            }
            // 3. Server errors keep their code.
            {
                foreach (var pair in new[] { new[] { "NOT_ENTITLED", "403" }, new[] { "MODEL_NOT_AVAILABLE", "409" }, new[] { "MODEL_DOWNLOAD_RESTRICTED", "409" }, new[] { "RATE_LIMITED", "429" } })
                {
                    var fake = new Fake { Reply = r => Err(int.Parse(pair[1]), pair[0]) };
                    Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == pair[0] && fake.Calls.Count == 1, "import-session error " + pair[0] + " is surfaced, no stream attempted");
                }
                foreach (var pair in new[] { new[] { "SESSION_INVALID", "404" }, new[] { "STORAGE_DOWNLOAD_FAILED", "502" }, new[] { "NOT_ENTITLED", "403" } })
                {
                    var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data)) : Err(int.Parse(pair[1]), pair[0]) };
                    Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == pair[0] && !File.Exists(dest), "stream error " + pair[0] + " is surfaced");
                }
            }
            // 4. A rejected token re-authenticates once (create), or once with the same unspent session (stream).
            {
                var tokens = new Tokens(); var fake = new Fake(); int posts = 0;
                fake.Reply = r => r.Method == HttpMethod.Post ? (++posts == 1 ? Err(401, "UNAUTHENTICATED") : Created(Info(data))) : Stream(data);
                await Make(fake, tokens).DownloadAsync(ModelId, dest, CancellationToken.None, null);
                Check(tokens.Invalidations == 1 && posts == 2, "401 on import-session: token renewed once, then succeeds");
                tokens = new Tokens(); fake = new Fake(); int gets = 0; posts = 0;
                fake.Reply = r => r.Method == HttpMethod.Post ? (++posts, Created(Info(data))).Item2 : (++gets == 1 ? Err(401, "UNAUTHENTICATED") : Stream(data));
                File.Delete(dest);
                await Make(fake, tokens).DownloadAsync(ModelId, dest, CancellationToken.None, null);
                Check(tokens.Invalidations == 1 && posts == 1 && gets == 2, "401 on the stream: token renewed and the same session reused (it was never claimed)");
                tokens = new Tokens(); fake = new Fake { Reply = r => Err(401, "UNAUTHENTICATED") };
                Check(await CodeOf(() => Make(fake, tokens).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "UNAUTHENTICATED" && fake.Calls.Count == 2, "persistent 401 stops after one retry");
            }
            // 5. DOWNLOAD_BUSY: the session is not consumed, so retry a few times, then give up with the same code.
            {
                var fake = new Fake(); int gets = 0;
                fake.Reply = r => r.Method == HttpMethod.Post ? Created(Info(data)) : (++gets < 3 ? Err(503, "DOWNLOAD_BUSY") : Stream(data));
                File.Delete(dest);
                await Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null);
                Check(gets == 3 && File.Exists(dest) && fake.Calls.Count(c => c.StartsWith("POST")) == 1, "busy twice then success: the same session is retried");
                fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data)) : Err(503, "DOWNLOAD_BUSY") };
                Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "DOWNLOAD_BUSY" && fake.Calls.Count(c => c.StartsWith("GET")) == 3, "always busy: three attempts, then DOWNLOAD_BUSY");
            }
            // 6. Malformed or hostile session info is refused before any stream request.
            {
                var cases = new Dictionary<string, Action<Dictionary<string, object>>>
                {
                    { "session id too short", d => d["sessionId"] = "abc" }, { "session id with slash", d => d["sessionId"] = new string('a', 42) + "/" },
                    { "negative size", d => d["sizeBytes"] = -1 }, { "size over the 4 GB limit", d => d["sizeBytes"] = 5L * 1024 * 1024 * 1024 },
                    { "md5 not hex", d => d["md5"] = "zz" }, { "sha256 not hex", d => d["sha256"] = "zz" },
                    { "unknown file type", d => d["fileType"] = "exe" }, { "entry file traversal", d => d["entryFile"] = "../evil.max" }, { "entry file absolute", d => d["entryFile"] = "C:/evil.max" },
                    { "missing size", d => d.Remove("sizeBytes") },
                    { "filename wrong type", d => d["filename"] = 123 }, { "filename too long", d => d["filename"] = new string('x', 1001) },
                };
                foreach (var entry in cases)
                {
                    var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data, entry.Value)) : Stream(data) };
                    Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "SERVER_UNAVAILABLE" && fake.Calls.Count == 1, "session info '" + entry.Key + "' is refused before downloading");
                }
                foreach (var bad in new[] { "", "not-a-uuid", "../x", ModelId + "/x", "11111111-1111-4111-8111-11111111111g" })
                {
                    var fake = new Fake { Reply = r => Created(Info(data)) };
                    Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(bad, dest, CancellationToken.None, null)) == "SERVER_UNAVAILABLE" && fake.Calls.Count == 0, "model id '" + bad + "' never reaches the network");
                }
            }
            // 7. A stream longer than announced is cut off early; cancellation leaves nothing.
            {
                File.Delete(dest);
                var big = Bytes(2 * 1024 * 1024);
                var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data)) : Stream(big) };
                Check(await CodeOf(() => Make(fake, new Tokens()).DownloadAsync(ModelId, dest, CancellationToken.None, null)) == "DOWNLOAD_VERIFICATION_FAILED" && Parts(root).Length == 0, "an over-long stream is rejected and cleaned up");
                var slow = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(big)) : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new SlowStream(big)) } };
                using (var cts = new CancellationTokenSource())
                {
                    var run = Make(slow, new Tokens()).DownloadAsync(ModelId, dest, cts.Token, (received, total) => { if (received > 100000) cts.Cancel(); });
                    try { await run; throw new Exception("cancelled download completed"); } catch (OperationCanceledException) { Check(true, "cancellation stops the download"); }
                    Check(!File.Exists(dest) && Parts(root).Length == 0, "after cancellation neither the file nor a .part exists");
                }
            }
            // 8. Replacing an existing destination is allowed (verified content wins); the model id is lower-cased in the URL.
            {
                File.WriteAllText(dest, "old");
                var fake = new Fake { Reply = r => r.Method == HttpMethod.Post ? Created(Info(data)) : Stream(data) };
                await Make(fake, new Tokens()).DownloadAsync(ModelId.ToUpperInvariant(), dest, CancellationToken.None, null);
                Check(File.ReadAllBytes(dest).SequenceEqual(data) && fake.Calls[0].Contains(ModelId + "/import-session"), "an existing destination is replaced and the model id is normalised");
            }
        }
        finally { try { Directory.Delete(root, true); } catch (IOException) { } }
        Console.WriteLine("Model downloader tests passed");
    }

    // Delivers 64 KB per read with a tiny delay so cancellation can land mid-stream.
    sealed class SlowStream : Stream
    {
        readonly byte[] data; int position;
        public SlowStream(byte[] data) { this.data = data; }
        public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct)
        {
            await Task.Delay(5, ct);
            var n = Math.Min(Math.Min(count, 65536), data.Length - position);
            Array.Copy(data, position, buffer, offset, n); position += n; return n;
        }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return data.Length; } }
        public override long Position { get { return position; } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) { throw new NotSupportedException(); }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
    }
}

