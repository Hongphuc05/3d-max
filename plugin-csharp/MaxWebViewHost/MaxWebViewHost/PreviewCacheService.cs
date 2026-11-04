using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class PreviewSyncSummary
    {
        public int Total { get; set; }
        public int Done { get; set; }
        public int Failed { get; set; }
    }

    /// <summary>Preview images, content-addressed: Previews\&lt;sha256&gt;.webp. Everything stored has been size- and hash-verified,
    /// so a file's name is a promise about its content. The installer's seed is copied once (first run), then differences stream in.</summary>
    internal sealed class PreviewCacheService
    {
        private static readonly Regex Hex64 = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        private const int Parallel = 4, Attempts = 3;
        private const long MaxPreviewBytes = 8 * 1024 * 1024;
        private readonly string cacheDirectory, seedDirectory;
        private readonly BackendApi api;
        private readonly Func<int, TimeSpan> backoff;
        private readonly ConcurrentDictionary<string, Task<byte[]>> inflight = new ConcurrentDictionary<string, Task<byte[]>>();
        private volatile bool paused;
        private HashSet<string> priority = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public event Action<int, int> Progress;

        public PreviewCacheService(string cacheDirectory, string seedDirectory, BackendApi api, Func<int, TimeSpan> backoff = null)
        {
            if (string.IsNullOrWhiteSpace(cacheDirectory) || api == null) throw new ArgumentNullException();
            this.cacheDirectory = Path.GetFullPath(cacheDirectory);
            this.seedDirectory = string.IsNullOrWhiteSpace(seedDirectory) ? null : Path.GetFullPath(seedDirectory);
            this.api = api;
            this.backoff = backoff ?? (attempt => TimeSpan.FromSeconds(Math.Min(30, 2 << attempt)));
        }

        private string PathOf(string sha) { return Path.Combine(cacheDirectory, sha + ".webp"); }
        public static bool IsHash(string value) { return value != null && Hex64.IsMatch(value); }

        public PreviewSyncSummary GetSummary(IEnumerable<PreviewEntry> wanted)
        {
            var unique = new HashSet<string>((wanted ?? new PreviewEntry[0]).Where(e => e != null && IsHash(e.Sha256)).Select(e => e.Sha256));
            var done = unique.Count(sha => File.Exists(PathOf(sha)));
            return new PreviewSyncSummary { Total = unique.Count, Done = done, Failed = 0 };
        }

        public void Prioritize(IEnumerable<string> modelIds) { priority = new HashSet<string>(modelIds ?? new string[0], StringComparer.OrdinalIgnoreCase); }
        public void Pause() { paused = true; }
        public void Resume() { paused = false; }

        /// <summary>Copies the installer's seed on the first run only. Each file is verified against its own sha256; bad or missing files are skipped.</summary>
        public int SeedFromInstall()
        {
            try
            {
                var marker = Path.Combine(cacheDirectory, "seed.done");
                if (seedDirectory == null || File.Exists(marker)) return 0;
                var manifestPath = Path.Combine(seedDirectory, "seed-manifest.json");
                if (!File.Exists(manifestPath) || new FileInfo(manifestPath).Length > 4 * 1024 * 1024) return 0;
                var manifest = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024, RecursionLimit = 8 }.Deserialize<SeedManifest>(File.ReadAllText(manifestPath));
                if (manifest == null || manifest.version != 1 || manifest.files == null || manifest.files.Length > 100000) return 0;
                Directory.CreateDirectory(cacheDirectory);
                var copied = 0;
                foreach (var file in manifest.files)
                {
                    if (file == null || !IsHash(file.sha256)) continue;
                    var source = Path.Combine(seedDirectory, file.sha256 + ".webp");
                    try
                    {
                        if (File.Exists(PathOf(file.sha256))) continue;
                        if (!File.Exists(source) || new FileInfo(source).Length > MaxPreviewBytes) continue;
                        var bytes = File.ReadAllBytes(source);
                        if (Sha(bytes) != file.sha256) continue;
                        Publish(file.sha256, bytes);
                        copied++;
                    }
                    catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
                }
                File.WriteAllText(marker, "1");
                return copied;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is ArgumentException || e is InvalidOperationException) { return 0; }
        }

        private sealed class SeedFile { public string sha256 { get; set; } }
        private sealed class SeedManifest { public int version { get; set; } public SeedFile[] files { get; set; } }

        public byte[] TryRead(string sha)
        {
            try
            {
                if (!IsHash(sha)) return null;
                var path = PathOf(sha);
                return File.Exists(path) && new FileInfo(path).Length <= MaxPreviewBytes ? File.ReadAllBytes(path) : null;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { return null; }
        }

        /// <summary>Cached bytes, or one verified download (parallel callers for the same file share it).</summary>
        public async Task<byte[]> GetAsync(PreviewEntry entry, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            if (entry == null || !IsHash(entry.Sha256)) throw ApiException.Unavailable();
            var cached = TryRead(entry.Sha256);
            if (cached != null) return cached;
            var shared = inflight.GetOrAdd(entry.Sha256, _ => Task.Run(async () =>
            {
                try { await DownloadAsync(entry, CancellationToken.None).ConfigureAwait(false); return TryRead(entry.Sha256); }
                finally { Task<byte[]> finished; inflight.TryRemove(entry.Sha256, out finished); }
            }));
            var bytes = await shared.ConfigureAwait(false);
            if (bytes == null) throw ApiException.Unavailable();
            return bytes;
        }

        public async Task<PreviewSyncSummary> SyncAsync(IEnumerable<PreviewEntry> wanted, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            var unique = new List<PreviewEntry>(); var seen = new HashSet<string>(StringComparer.Ordinal); var invalid = 0;
            foreach (var entry in wanted ?? new PreviewEntry[0])
            {
                if (entry == null || !IsHash(entry.Sha256)) { invalid++; continue; }
                if (seen.Add(entry.Sha256)) unique.Add(entry);
            }
            var first = priority;
            var queue = new Queue<PreviewEntry>(unique.OrderBy(e => first.Contains(e.ModelId) ? 0 : 1).ThenBy(e => e.Variant == "sm" ? 0 : 1));
            var summary = new PreviewSyncSummary { Total = unique.Count + invalid, Failed = invalid };
            var gate = new object();
            summary.Done = unique.Count(e => File.Exists(PathOf(e.Sha256)));
            var present = new HashSet<string>(unique.Where(e => File.Exists(PathOf(e.Sha256))).Select(e => e.Sha256));
            Raise(summary.Done, summary.Total);

            async Task Worker()
            {
                while (true)
                {
                    while (paused) { ct.ThrowIfCancellationRequested(); await Task.Delay(25, ct).ConfigureAwait(false); }
                    ct.ThrowIfCancellationRequested();
                    PreviewEntry entry;
                    lock (gate) { if (queue.Count == 0) return; entry = queue.Dequeue(); }
                    if (present.Contains(entry.Sha256)) continue;
                    var ok = false;
                    for (var attempt = 0; attempt < Attempts && !ok; attempt++)
                    {
                        if (attempt > 0) await Task.Delay(backoff(attempt), ct).ConfigureAwait(false);
                        try { await DownloadAsync(entry, ct).ConfigureAwait(false); ok = true; }
                        catch (Exception e) when (e is ApiException || e is InvalidDataException || e is IOException || e is UnauthorizedAccessException) { }
                    }
                    int done, total;
                    lock (gate) { if (ok) summary.Done++; else summary.Failed++; done = summary.Done; total = summary.Total; }
                    if (ok) Raise(done, total);
                }
            }
            await Task.WhenAll(Enumerable.Range(0, Parallel).Select(_ => Task.Run(Worker))).ConfigureAwait(false);
            Raise(summary.Done, summary.Total);
            return summary;
        }

        private void Raise(int done, int total)
        {
            var handler = Progress;
            if (handler != null) lock (this) handler(done, total);
        }

        // One verified attempt: bounded stream -> .part -> size + sha256 -> publish. Anything else throws and leaves nothing behind.
        private async Task DownloadAsync(PreviewEntry entry, CancellationToken ct)
        {
            if (!IsHash(entry.Sha256) || entry.FileSize < 1 || entry.FileSize > MaxPreviewBytes) throw new InvalidDataException();
            if (File.Exists(PathOf(entry.Sha256))) return;
            using (var response = await api.OpenStreamAsync("/previews/" + entry.Sha256 + ".webp", null, ct).ConfigureAwait(false))
            {
                var type = response.Content != null && response.Content.Headers.ContentType != null ? response.Content.Headers.ContentType.MediaType : null;
                if (type == "text/html" || type == "application/xhtml+xml") throw new InvalidDataException();
                byte[] bytes;
                try { bytes = await BackendApi.ReadBoundedAsync(await response.Content.ReadAsStreamAsync().ConfigureAwait(false), (int)entry.FileSize, ct).ConfigureAwait(false); }
                catch (HttpRequestException) { throw ApiException.Unavailable(); }
                if (bytes.Length != entry.FileSize || Sha(bytes) != entry.Sha256) throw new InvalidDataException();
                Publish(entry.Sha256, bytes);
            }
        }

        // Written through a unique .part so parallel downloads of the same hash never interleave; the final name only ever holds verified bytes.
        private void Publish(string sha, byte[] bytes)
        {
            Directory.CreateDirectory(cacheDirectory);
            var part = Path.Combine(cacheDirectory, sha + "." + Guid.NewGuid().ToString("N") + ".part");
            try
            {
                File.WriteAllBytes(part, bytes);
                try { File.Move(part, PathOf(sha)); }
                catch (IOException) when (File.Exists(PathOf(sha))) { } // another caller finished first: same content by construction
            }
            finally { if (File.Exists(part)) File.Delete(part); }
        }

        /// <summary>Removes previews no longer referenced by the catalog and abandoned .part files. Foreign files are left alone.</summary>
        public int Prune(IEnumerable<PreviewEntry> wanted)
        {
            var keep = new HashSet<string>((wanted ?? new PreviewEntry[0]).Where(e => e != null && IsHash(e.Sha256)).Select(e => e.Sha256), StringComparer.Ordinal);
            var removed = 0;
            if (!Directory.Exists(cacheDirectory)) return 0;
            foreach (var file in Directory.GetFiles(cacheDirectory))
            {
                var name = Path.GetFileName(file);
                var stale = name.EndsWith(".part", StringComparison.Ordinal)
                    || (name.EndsWith(".webp", StringComparison.Ordinal) && IsHash(name.Substring(0, name.Length - 5)) && !keep.Contains(name.Substring(0, name.Length - 5)));
                if (!stale) continue;
                try { File.Delete(file); removed++; } catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
            }
            return removed;
        }

        private static string Sha(byte[] data)
        { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(data)).Replace("-", "").ToLowerInvariant(); }
    }
}
