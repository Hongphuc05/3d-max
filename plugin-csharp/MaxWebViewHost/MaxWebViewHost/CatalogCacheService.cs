using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class PreviewEntry
    {
        public string ModelId { get; set; }
        public string Variant { get; set; }
        public string Sha256 { get; set; }
        public long FileSize { get; set; }
        private string url;
        public string Url { get { return url ?? "/previews/" + Sha256 + ".webp"; } set { url = value; } }
        // Only exact content-addressed paths are accepted, never arbitrary manifest URLs.
        internal static bool IsAllowedUrl(string value, string sha)
        {
            return value == "/previews/" + sha + ".webp"
                || value == "/previews/3dmodels/" + sha + ".webp"
                || value == "/previews/3dscenes/" + sha + ".webp";
        }
    }

    internal sealed class CachedCatalog
    {
        public int CatalogVersion { get; set; }
        public byte[] CatalogJson { get; set; }
        public byte[] CategoriesJson { get; set; }
        public byte[] ManifestJson { get; set; }
        public string[] ModelIds { get; set; }
        public PreviewEntry[] Previews { get; set; }
    }

    internal sealed class CatalogUpdateResult
    {
        public bool Changed { get; set; }
        public bool Offline { get; set; }
        public CachedCatalog Catalog { get; set; }
    }

    /// <summary>Keeps catalog.json / categories.json / manifest.json under one directory as a consistent set.
    /// meta.json is written last and carries the sha256 of the three files: any mismatch means "no cache" (never a half-updated one).</summary>
    internal sealed class CatalogCacheService
    {
        private static readonly string[] Files = { "catalog.json", "categories.json", "manifest.json" };
        private static readonly Regex Uuid = new Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", RegexOptions.CultureInvariant);
        private static readonly Regex Hex64 = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        private const int MaxModels = 20000;
        private const long MaxPreviewBytes = 8 * 1024 * 1024;
        private readonly string directory;
        private readonly BackendApi api;
        private readonly object diskLock = new object();

        private sealed class Meta { public int catalogVersion { get; set; } public string etag { get; set; } public Dictionary<string, string> files { get; set; } }

        public CatalogCacheService(string directory, BackendApi api)
        {
            if (string.IsNullOrWhiteSpace(directory) || api == null) throw new ArgumentNullException();
            this.directory = Path.GetFullPath(directory);
            this.api = api;
        }

        /// <summary>The cached set, or null when it is absent, partial or does not match meta.json.</summary>
        public CachedCatalog Load()
        {
            lock (diskLock) { Meta meta; return Read(out meta); }
        }

        private CachedCatalog Read(out Meta meta)
        {
            meta = null;
            try
            {
                var metaPath = Path.Combine(directory, "meta.json");
                if (!File.Exists(metaPath) || new FileInfo(metaPath).Length > 16384) return null;
                meta = new JavaScriptSerializer { MaxJsonLength = 16384 }.Deserialize<Meta>(File.ReadAllText(metaPath, Encoding.UTF8));
                if (meta == null || meta.files == null) return null;
                var bytes = new Dictionary<string, byte[]>();
                foreach (var name in Files)
                {
                    var path = Path.Combine(directory, name);
                    string expected;
                    if (!meta.files.TryGetValue(name, out expected) || !File.Exists(path) || new FileInfo(path).Length > BackendApi.JsonLimit) return null;
                    var content = File.ReadAllBytes(path);
                    if (!string.Equals(Sha(content), expected, StringComparison.Ordinal)) return null;
                    bytes[name] = content;
                }
                return Parse(bytes["catalog.json"], bytes["categories.json"], bytes["manifest.json"]);
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is ArgumentException || e is InvalidOperationException || e is InvalidDataException)
            { meta = null; return null; }
        }

        public async Task<CatalogUpdateResult> UpdateAsync(CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Meta meta; CachedCatalog cached;
            lock (diskLock) { CleanTemporary(); cached = Read(out meta); }
            byte[] catalog = null, categories = null, manifest = null; string etag = null;
            try
            {
                var version = await api.SendAsync(HttpMethod.Get, "/api/v1/catalog/version", null, null, cached != null ? meta.etag : null, 65536, ct).ConfigureAwait(false);
                if (version.NotModified && cached != null) return new CatalogUpdateResult { Changed = false, Catalog = cached };
                etag = version.ETag;
                for (var attempt = 0; attempt < 3 && catalog == null; attempt++)
                {
                    var c = (await api.SendAsync(HttpMethod.Get, "/api/v1/catalog", null, null, null, BackendApi.JsonLimit, ct).ConfigureAwait(false)).Body;
                    var k = (await api.SendAsync(HttpMethod.Get, "/api/v1/categories", null, null, null, BackendApi.JsonLimit, ct).ConfigureAwait(false)).Body;
                    var m = (await api.SendAsync(HttpMethod.Get, "/api/v1/previews/manifest", null, null, null, BackendApi.JsonLimit, ct).ConfigureAwait(false)).Body;
                    // A publish between the requests makes catalog and manifest disagree; fetch the set again.
                    // (Versions first: documents of different versions legitimately disagree about which models exist.)
                    if (VersionOf(c) != VersionOf(m)) continue;
                    Parse(c, k, m);
                    catalog = c; categories = k; manifest = m;
                }
            }
            catch (ApiException e) when (e.Code == "SERVER_UNAVAILABLE" || e.Code == "RATE_LIMITED")
            { return new CatalogUpdateResult { Offline = true, Changed = false, Catalog = cached }; }
            catch (InvalidDataException) { throw ApiException.Unavailable(); } // the server answered, but with data we refuse
            if (catalog == null) throw ApiException.Unavailable();

            CachedCatalog parsed;
            try { parsed = Parse(catalog, categories, manifest); } catch (InvalidDataException) { throw ApiException.Unavailable(); }
            lock (diskLock) Write(parsed, catalog, categories, manifest, etag);
            return new CatalogUpdateResult { Changed = true, Catalog = parsed };
        }

        private void CleanTemporary()
        {
            try { if (Directory.Exists(directory)) foreach (var file in Directory.GetFiles(directory, "*.tmp")) File.Delete(file); }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
        }

        private void Write(CachedCatalog parsed, byte[] catalog, byte[] categories, byte[] manifest, string etag)
        {
            Directory.CreateDirectory(directory);
            var contents = new Dictionary<string, byte[]> { { "catalog.json", catalog }, { "categories.json", categories }, { "manifest.json", manifest } };
            foreach (var pair in contents) Publish(Path.Combine(directory, pair.Key), pair.Value);
            var meta = new Meta { catalogVersion = parsed.CatalogVersion, etag = etag, files = contents.ToDictionary(p => p.Key, p => Sha(p.Value)) };
            Publish(Path.Combine(directory, "meta.json"), Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(meta)));
        }

        private static void Publish(string path, byte[] content)
        {
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, content);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static int VersionOf(byte[] json)
        {
            var d = Deserialize<Dictionary<string, object>>(json);
            object v;
            if (d == null || !d.TryGetValue("catalogVersion", out v) || !(v is int) || (int)v < 0) throw new InvalidDataException();
            return (int)v;
        }

        private static T Deserialize<T>(byte[] json)
        {
            try { return new JavaScriptSerializer { MaxJsonLength = BackendApi.JsonLimit, RecursionLimit = 16 }.Deserialize<T>(Encoding.UTF8.GetString(json)); }
            catch (Exception e) when (e is ArgumentException || e is InvalidOperationException) { throw new InvalidDataException(); }
        }

        private sealed class ModelDto { public string id { get; set; } public string name { get; set; } }
        private sealed class CatalogDto { public int? catalogVersion { get; set; } public ModelDto[] models { get; set; } }
        private sealed class CategoryDto { public string id { get; set; } public string name { get; set; } }
        private sealed class PreviewDto { public string modelId { get; set; } public string variant { get; set; } public string url { get; set; } public string sha256 { get; set; } public long? fileSize { get; set; } }
        private sealed class ManifestDto { public int? catalogVersion { get; set; } public PreviewDto[] previews { get; set; } }

        /// <summary>Strict validation of the three documents as one set. Throws ApiException(SERVER_UNAVAILABLE) for anything unexpected.</summary>
        internal static CachedCatalog Parse(byte[] catalogJson, byte[] categoriesJson, byte[] manifestJson)
        {
            var catalog = Deserialize<CatalogDto>(catalogJson);
            var categories = Deserialize<CategoryDto[]>(categoriesJson);
            var manifest = Deserialize<ManifestDto>(manifestJson);
            if (catalog == null || !catalog.catalogVersion.HasValue || catalog.catalogVersion < 0 || catalog.models == null || catalog.models.Length > MaxModels
                || categories == null || categories.Length > MaxModels || manifest == null || !manifest.catalogVersion.HasValue || manifest.previews == null || manifest.previews.Length > MaxModels * 2)
                throw new InvalidDataException();
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var model in catalog.models)
                if (model == null || !Uuid.IsMatch(model.id ?? "") || !ids.Add(model.id) || string.IsNullOrWhiteSpace(model.name) || model.name.Length > 300 || model.name.Any(char.IsControl))
                    throw new InvalidDataException();
            foreach (var category in categories)
                if (category == null || !Uuid.IsMatch(category.id ?? "") || string.IsNullOrWhiteSpace(category.name)) throw new InvalidDataException();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var previews = new List<PreviewEntry>();
            foreach (var p in manifest.previews)
            {
                if (p == null || !ids.Contains(p.modelId ?? "") || (p.variant != "sm" && p.variant != "lg") || !Hex64.IsMatch(p.sha256 ?? "")
                    || !PreviewEntry.IsAllowedUrl(p.url, p.sha256) || !p.fileSize.HasValue || p.fileSize < 1 || p.fileSize > MaxPreviewBytes
                    || !seen.Add(p.modelId + "|" + p.variant)) throw new InvalidDataException();
                previews.Add(new PreviewEntry { ModelId = p.modelId.ToLowerInvariant(), Variant = p.variant, Sha256 = p.sha256, FileSize = p.fileSize.Value, Url = p.url });
            }
            return new CachedCatalog { CatalogVersion = catalog.catalogVersion.Value, CatalogJson = catalogJson, CategoriesJson = categoriesJson, ManifestJson = manifestJson,
                ModelIds = ids.Select(i => i.ToLowerInvariant()).ToArray(), Previews = previews.ToArray() };
        }

        private static string Sha(byte[] data)
        { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(data)).Replace("-", "").ToLowerInvariant(); }
    }
}
