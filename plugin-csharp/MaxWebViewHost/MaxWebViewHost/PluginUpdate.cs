using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class UpdateStatus
    {
        public string Current { get; set; }
        public string Latest { get; set; }
        public string Sha256 { get; set; }
        public long Size { get; set; }
        public bool UpdateAvailable { get; set; }
        /// <summary>This release (or a newer one) is already installed but the running Max still has the old DLL loaded.</summary>
        public bool RestartRequired { get; set; }
    }

    /// <summary>Update check + verified download of the release MZP. No Max types here: the install itself is done by Max (install.ms),
    /// this class only fetches, verifies and unpacks the package. Max is never closed or restarted from here.</summary>
    internal sealed class PluginUpdateService
    {
        internal const string PackagePath = "/download/3dsmood-library.mzp";
        private const long MaxPackageBytes = 500L * 1024 * 1024;   // same cap as release.yml
        private const long MaxExtractedBytes = 2L * 1024 * 1024 * 1024;
        private static readonly Regex Version = new Regex(@"^\d+\.\d+\.\d+([-.][A-Za-z0-9.-]+)?$", RegexOptions.CultureInvariant);
        private static readonly Regex Hex64 = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        // Static: survives closing and reopening the panel. The loaded DLL (and so InstalledVersion) stays old until Max restarts.
        private static string pendingRestartVersion;
        internal static void MarkInstalled(string version) { pendingRestartVersion = version; }
        internal static void ClearPendingRestart() { pendingRestartVersion = null; }
        private readonly BackendApi api, bulkApi;
        private readonly string installDirectory, workRoot;

        /// <param name="installDirectory">Folder of the running MaxWebViewHost.dll (holds version.txt).</param>
        /// <param name="workRoot">Writable folder for downloads, e.g. %LOCALAPPDATA%\3dMood\Update.</param>
        public PluginUpdateService(BackendApi api, BackendApi bulkApi, string installDirectory, string workRoot)
        {
            if (api == null || bulkApi == null || installDirectory == null || workRoot == null) throw new ArgumentNullException();
            this.api = api; this.bulkApi = bulkApi; this.installDirectory = installDirectory; this.workRoot = workRoot;
        }

        /// <summary>payload\version.txt (written by make-release-mzp.ps1), else the DLL's file version without the 4th part.</summary>
        public string InstalledVersion()
        {
            try
            {
                var file = Path.Combine(installDirectory, "version.txt");
                if (File.Exists(file))
                {
                    var text = File.ReadAllText(file).Trim();
                    if (Version.IsMatch(text)) return text;
                }
                var dll = Path.Combine(installDirectory, "MaxWebViewHost.dll");
                var fileVersion = File.Exists(dll) ? FileVersionInfo.GetVersionInfo(dll) : null;
                return fileVersion == null ? null : fileVersion.FileMajorPart + "." + fileVersion.FileMinorPart + "." + fileVersion.FileBuildPart;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { return null; }
        }

        /// <summary>True when latest is strictly newer than current. shortcut: numeric major.minor.patch only; a suffix only
        /// ranks a pre-release below the same plain version — upgrade if pre-release ordering matters.</summary>
        internal static bool IsNewer(string current, string latest)
        {
            if (!Version.IsMatch(latest ?? "")) return false;
            if (!Version.IsMatch(current ?? "")) return true;
            Func<string, int[]> core = v => v.Split('-', '.').Take(3).Select(int.Parse).ToArray();
            var a = core(current); var b = core(latest);
            for (var i = 0; i < 3; i++) if (a[i] != b[i]) return b[i] > a[i];
            return current.Length > 0 && Regex.IsMatch(current, @"^\d+\.\d+\.\d+[-]") && !Regex.IsMatch(latest, @"^\d+\.\d+\.\d+[-]");
        }

        public async Task<UpdateStatus> CheckAsync(CancellationToken ct)
        {
            var body = (await api.SendAsync(HttpMethod.Get, "/api/v1/plugin/latest", null, null, null, 4096, ct).ConfigureAwait(false)).Object();
            object version, sha, size;
            if (!body.TryGetValue("version", out version) || !(version is string) || !Version.IsMatch((string)version)
                || !body.TryGetValue("sha256", out sha) || !(sha is string) || !Hex64.IsMatch(((string)sha).ToLowerInvariant())
                || !body.TryGetValue("size", out size) || !(size is int || size is long))
                throw ApiException.Unavailable();
            var current = InstalledVersion();
            var installedAlready = pendingRestartVersion != null && !IsNewer(pendingRestartVersion, (string)version);
            return new UpdateStatus { Current = current, Latest = (string)version, Sha256 = ((string)sha).ToLowerInvariant(), Size = Convert.ToInt64(size),
                RestartRequired = installedAlready, UpdateAvailable = !installedAlready && IsNewer(current, (string)version) };
        }

        /// <summary>Downloads the MZP, verifies size + SHA256 against the API, unpacks it into a fresh folder and returns that folder
        /// (with trailing separator). Anything not matching throws InvalidDataException; nothing is installed here.</summary>
        public async Task<string> PrepareAsync(UpdateStatus status, Action<long, long?> progress, CancellationToken ct)
        {
            if (status == null || !status.UpdateAvailable || status.Size <= 0 || status.Size > MaxPackageBytes) throw new InvalidDataException("Gói cập nhật không hợp lệ.");
            CleanOld();
            var root = Path.Combine(workRoot, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            var part = Path.Combine(root, "package.mzp.part");
            string hash;
            using (var response = await bulkApi.OpenStreamAsync(PackagePath, null, ct).ConfigureAwait(false))
            using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var output = new FileStream(part, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
            {
                var buffer = new byte[81920]; long total = 0; int read;
                while ((read = await input.ReadAsync(buffer, 0, buffer.Length, ct).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > status.Size) throw new InvalidDataException("Gói cập nhật lớn hơn khai báo.");
                    sha.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer, 0, read, ct).ConfigureAwait(false);
                    if (progress != null) progress(total, status.Size);
                }
                if (total != status.Size) throw new InvalidDataException("Gói cập nhật tải về không đủ dung lượng.");
                hash = BitConverter.ToString(sha.GetHashAndReset()).Replace("-", "").ToLowerInvariant();
            }
            if (hash != status.Sha256) throw new InvalidDataException("Gói cập nhật không khớp SHA256.");
            var package = Path.Combine(root, "package.mzp");
            File.Move(part, package);   // temp -> verify -> atomic move
            var extracted = Path.Combine(root, "x") + Path.DirectorySeparatorChar;
            Extract(package, extracted);
            foreach (var required in new[] { "install.ms", "payload-id.txt", "version.txt", @"payload\MaxWebViewHost.dll" })
                if (!File.Exists(extracted + required)) throw new InvalidDataException("Gói cập nhật thiếu tệp.");
            if (File.ReadAllText(extracted + "version.txt").Trim() != status.Latest) throw new InvalidDataException("Phiên bản trong gói không khớp.");
            return extracted;
        }

        /// <summary>Zip-slip safe: every entry must resolve under destination; absolute, drive, UNC and .. names are rejected.</summary>
        internal static void Extract(string package, string destination)
        {
            var root = Path.GetFullPath(destination);
            if (!root.EndsWith(Path.DirectorySeparatorChar.ToString())) root += Path.DirectorySeparatorChar;
            Directory.CreateDirectory(root);
            long total = 0;
            using (var zip = ZipFile.OpenRead(package))
                foreach (var entry in zip.Entries)
                {
                    var name = entry.FullName;
                    if (name.Length == 0 || name.StartsWith("/") || name.Contains("\\") || name.Contains(":") || name.Split('/').Any(p => p == ".."))
                        throw new InvalidDataException("Gói cập nhật chứa đường dẫn không an toàn.");
                    var target = Path.GetFullPath(Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Gói cập nhật chứa đường dẫn không an toàn.");
                    if (name.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    total += entry.Length;
                    if (total > MaxExtractedBytes) throw new InvalidDataException("Gói cập nhật quá lớn.");
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, false);
                }
        }

        private void CleanOld()
        {
            try
            {
                if (!Directory.Exists(workRoot)) return;
                foreach (var dir in Directory.GetDirectories(workRoot))
                    try { Directory.Delete(dir, true); } catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
        }
    }
}
