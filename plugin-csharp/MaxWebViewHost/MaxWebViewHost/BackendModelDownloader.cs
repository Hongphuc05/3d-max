using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace MaxWebViewHost
{
    internal sealed class ModelDownloadInfo
    {
        public string SessionId { get; set; }
        public long SizeBytes { get; set; }
        public string Md5 { get; set; }
        public string Sha256 { get; set; }
        public string FileType { get; set; }
        public string EntryFile { get; set; }
    }

    /// <summary>Replaces GoogleDriveDownloader: the plugin only ever talks to the 3DS Mood API. import-session -> verified stream to disk.
    /// The Drive link/ID never reaches the plugin, so there is no Google host allowlist here.</summary>
    internal sealed class BackendModelDownloader
    {
        private const long MaximumBytes = 4L * 1024 * 1024 * 1024;
        private const int BusyAttempts = 3;
        private static readonly Regex Uuid = new Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", RegexOptions.CultureInvariant);
        private static readonly Regex SessionPattern = new Regex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant);
        private static readonly Regex Md5Pattern = new Regex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant);
        private static readonly Regex Sha256Pattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        private static readonly string[] FileTypes = { "zip", "rar", "7z", "max", "fbx", "obj" };
        private readonly BackendApi api;
        private readonly IDeviceTokenSource tokens;
        private readonly Func<int, TimeSpan> backoff;

        public BackendModelDownloader(BackendApi api, IDeviceTokenSource tokens, Func<int, TimeSpan> backoff = null)
        {
            if (api == null || tokens == null) throw new ArgumentNullException();
            this.api = api; this.tokens = tokens;
            this.backoff = backoff ?? (attempt => TimeSpan.FromSeconds(2 * attempt));
        }

        public async Task<ModelDownloadInfo> DownloadAsync(string modelId, string destination, CancellationToken ct, Action<long, long?> progress)
        {
            if (string.IsNullOrEmpty(destination)) throw new ArgumentNullException("destination");
            if (modelId == null || !Uuid.IsMatch(modelId)) throw ApiException.Unavailable();
            var info = await CreateSessionAsync(modelId.ToLowerInvariant(), ct).ConfigureAwait(false);
            await StreamAsync(info, destination, ct, progress).ConfigureAwait(false);
            return info;
        }

        private async Task<ModelDownloadInfo> CreateSessionAsync(string modelId, CancellationToken ct)
        {
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    var token = await tokens.GetTokenAsync(ct).ConfigureAwait(false);
                    var response = await api.SendAsync(HttpMethod.Post, "/api/v1/models/" + modelId + "/import-session", null, token, null, 65536, ct).ConfigureAwait(false);
                    return ParseInfo(response.Object());
                }
                catch (ApiException e) when (e.Code == "UNAUTHENTICATED" && attempt == 0) { tokens.Invalidate(); }
            }
        }

        private async Task StreamAsync(ModelDownloadInfo info, string destination, CancellationToken ct, Action<long, long?> progress)
        {
            var reauthenticated = false;
            for (var busy = 0; ; )
            {
                try
                {
                    var token = await tokens.GetTokenAsync(ct).ConfigureAwait(false);
                    using (var response = await api.OpenStreamAsync("/api/v1/model-downloads/" + info.SessionId, token, ct).ConfigureAwait(false))
                    {
                        await SaveVerifiedAsync(response, info, destination, ct, progress).ConfigureAwait(false);
                        return;
                    }
                }
                // The token check runs before the session is claimed, so an unspent session survives a renewed token.
                catch (ApiException e) when (e.Code == "UNAUTHENTICATED" && !reauthenticated) { reauthenticated = true; tokens.Invalidate(); }
                // DOWNLOAD_BUSY is answered before the session is claimed too: wait and ask again with the same session.
                catch (ApiException e) when (e.Code == "DOWNLOAD_BUSY" && ++busy < BusyAttempts) { await Task.Delay(backoff(busy), ct).ConfigureAwait(false); }
            }
        }

        private static async Task SaveVerifiedAsync(HttpResponseMessage response, ModelDownloadInfo info, string destination, CancellationToken ct, Action<long, long?> progress)
        {
            var type = response.Content != null && response.Content.Headers.ContentType != null ? response.Content.Headers.ContentType.MediaType : null;
            var length = response.Content != null ? response.Content.Headers.ContentLength : null;
            if (type == "text/html" || type == "application/xhtml+xml" || (length.HasValue && length.Value != info.SizeBytes)) throw Mismatch();
            var directory = Path.GetDirectoryName(Path.GetFullPath(destination));
            Directory.CreateDirectory(directory);
            var part = Path.Combine(directory, Path.GetFileName(destination) + "." + Guid.NewGuid().ToString("N") + ".part");
            try
            {
                using (var md5 = MD5.Create())
                using (var sha = SHA256.Create())
                {
                    long total = 0;
                    using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var output = new FileStream(part, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
                    {
                        var buffer = new byte[65536]; int read;
                        while ((read = await source.ReadAsync(buffer, 0, buffer.Length, ct).ConfigureAwait(false)) > 0)
                        {
                            total += read;
                            if (total > info.SizeBytes) throw Mismatch(); // never write more than the server announced
                            md5.TransformBlock(buffer, 0, read, null, 0);
                            sha.TransformBlock(buffer, 0, read, null, 0);
                            await output.WriteAsync(buffer, 0, read, ct).ConfigureAwait(false);
                            if (progress != null) progress(total, info.SizeBytes);
                        }
                    }
                    md5.TransformFinalBlock(new byte[0], 0, 0); sha.TransformFinalBlock(new byte[0], 0, 0);
                    if (total != info.SizeBytes || total == 0
                        || (info.Md5 != null && Hex(md5.Hash) != info.Md5) || (info.Sha256 != null && Hex(sha.Hash) != info.Sha256)) throw Mismatch();
                }
                ct.ThrowIfCancellationRequested();
                if (File.Exists(destination)) File.Delete(destination);
                File.Move(part, destination);
            }
            catch (Exception e) when (e is HttpRequestException || e is IOException && !(e is FileNotFoundException))
            { throw ApiException.Unavailable(); }
            finally { if (File.Exists(part)) File.Delete(part); }
        }

        private static ApiException Mismatch()
        { return new ApiException("DOWNLOAD_VERIFICATION_FAILED", 0, "File tải về không khớp thông tin của máy chủ. Hãy thử Import lại."); }

        internal static ModelDownloadInfo ParseInfo(System.Collections.Generic.Dictionary<string, object> source)
        {
            object value;
            string session = Field(source, "sessionId") as string, md5 = Field(source, "md5") as string, sha = Field(source, "sha256") as string,
                type = Field(source, "fileType") as string, entry = Field(source, "entryFile") as string;
            value = Field(source, "sizeBytes");
            long size;
            if (value is int) size = (int)value; else if (value is long) size = (long)value;
            else if (value is decimal && decimal.Truncate((decimal)value) == (decimal)value) size = (long)(decimal)value;
            else if (value is double && Math.Truncate((double)value) == (double)value && Math.Abs((double)value) < 1e15) size = (long)(double)value;
            else throw ApiException.Unavailable();
            if (session == null || !SessionPattern.IsMatch(session) || size < 1 || size > MaximumBytes
                || (md5 != null && !Md5Pattern.IsMatch(md5)) || (sha != null && !Sha256Pattern.IsMatch(sha))
                || type == null || !FileTypes.Contains(type) || (entry != null && !SafeRelative(entry)))
                throw ApiException.Unavailable();
            return new ModelDownloadInfo { SessionId = session, SizeBytes = size, Md5 = md5, Sha256 = sha, FileType = type, EntryFile = entry };
        }

        private static object Field(System.Collections.Generic.Dictionary<string, object> source, string name)
        { object value; return source != null && source.TryGetValue(name, out value) ? value : null; }

        private static bool SafeRelative(string path)
        {
            if (string.IsNullOrEmpty(path) || path.Length > 512 || path.IndexOfAny(new[] { '\\', ':', '%', '?', '#' }) >= 0 || path.Any(char.IsControl)) return false;
            return path.Split('/').All(p => p.Length > 0 && p != "." && p != ".." && !p.EndsWith(".") && !p.EndsWith(" ") && p.IndexOfAny(Path.GetInvalidFileNameChars()) < 0);
        }

        private static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
    }
}
