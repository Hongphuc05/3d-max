using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class CachedModel
    {
        public string Directory { get; set; }
        public string EntryPath { get; set; }
        public long PackageSize { get; set; }
    }

    /// <summary>Models kept on the customer's disk: Models\&lt;modelId&gt;\{content\, manifest.json}. A model is "downloaded" when its manifest
    /// is readable and its entry file exists, so a later import needs no network. New content is built in .staging\ and moved in with one rename
    /// (temp -> verify -> atomic move). The folder must stay inside PlatformAgent.CacheRoot: the import pipe only accepts paths below it.</summary>
    internal sealed class ModelCacheService
    {
        private static readonly Regex Id = new Regex("^[A-Za-z0-9-]{1,64}$", RegexOptions.CultureInvariant);
        private readonly string root;
        private readonly string stagingRoot;

        public ModelCacheService(string root)
        {
            if (string.IsNullOrWhiteSpace(root)) throw new ArgumentNullException("root");
            this.root = Path.GetFullPath(root);
            stagingRoot = Path.Combine(this.root, ".staging");
        }

        /// <summary>An empty folder for one import: put content\ in it, then Commit it.</summary>
        public string NewStaging()
        {
            var path = Path.Combine(stagingRoot, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(path);
            return path;
        }

        /// <param name="expectedPackageSize">What the catalog says the package weighs now; a different stored size means the zip was replaced. Null = unknown, do not judge.</param>
        public CachedModel TryGet(string modelId, long? expectedPackageSize)
        {
            if (modelId == null || !Id.IsMatch(modelId)) return null;
            var directory = Path.Combine(root, modelId.ToLowerInvariant());
            try
            {
                var manifestPath = Path.Combine(directory, "manifest.json");
                if (!File.Exists(manifestPath)) return null;
                var manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath));
                var entryName = manifest["entry"] as string;
                var size = Convert.ToInt64(manifest["packageSize"]);
                if (string.IsNullOrEmpty(entryName)) return null;
                if (expectedPackageSize.HasValue && expectedPackageSize.Value != size) return null;
                var content = Path.GetFullPath(Path.Combine(directory, "content")) + Path.DirectorySeparatorChar;
                var entry = Path.GetFullPath(Path.Combine(content, entryName.Replace('/', Path.DirectorySeparatorChar)));
                // The manifest is data on disk, not trusted: the entry must stay inside this model's own content folder.
                if (!entry.StartsWith(content, StringComparison.OrdinalIgnoreCase) || !File.Exists(entry)) return null;
                return new CachedModel { Directory = directory, EntryPath = entry, PackageSize = size };
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is ArgumentException
                || e is InvalidOperationException || e is KeyNotFoundException || e is InvalidCastException || e is FormatException || e is OverflowException) { return null; }
        }

        /// <summary>Moves a staging folder (from NewStaging, holding content\) into place. Returns the stored model, or null when it could not be
        /// stored (e.g. an older copy is locked by an open scene): the caller then imports from the staging files, as before caching existed.</summary>
        public CachedModel Commit(string modelId, string stagingDirectory, string entryRelativePath, long packageSize)
        {
            if (modelId == null || !Id.IsMatch(modelId)) throw new ArgumentException("modelId");
            var id = modelId.ToLowerInvariant();
            var staging = Path.GetFullPath(stagingDirectory ?? "");
            if (!staging.StartsWith(stagingRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("stagingDirectory");
            var entryFile = Path.GetFullPath(Path.Combine(staging, "content", (entryRelativePath ?? "").Replace('/', Path.DirectorySeparatorChar)));
            if (!entryFile.StartsWith(Path.Combine(staging, "content") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(entryFile))
                throw new InvalidDataException("Entry file is missing from the staged model.");

            File.WriteAllText(Path.Combine(staging, "manifest.json"), new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                { "entry", entryRelativePath.Replace('\\', '/') }, { "packageSize", packageSize }, { "cachedAt", DateTime.UtcNow.ToString("o") }
            }));

            var final = Path.Combine(root, id);
            try
            {
                if (Directory.Exists(final))
                {
                    var old = Path.Combine(stagingRoot, Guid.NewGuid().ToString("N"));
                    Directory.Move(final, old);
                    try { Directory.Delete(old, true); } catch (IOException) { /* locked texture of an open scene: leave it in .staging */ }
                }
                Directory.Move(staging, final);
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                // Another Max process stored it first, or the old copy is in use: use theirs if it is valid, else let the caller use staging.
                return TryGet(id, packageSize);
            }
            return TryGet(id, null);
        }

        public string[] ListDownloaded()
        {
            if (!Directory.Exists(root)) return new string[0];
            try
            {
                return Directory.GetDirectories(root).Select(path => Path.GetFileName(path)).Where(name => Id.IsMatch(name) && TryGet(name, null) != null).ToArray();
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { return new string[0]; }
        }

        /// <summary>sizeBytes of a model in the catalog JSON served at /api/v1/catalog ({"models":[{"id","sizeBytes"}]}); null when unknown.</summary>
        public static long? SizeInCatalog(byte[] catalogJson, string modelId)
        {
            if (catalogJson == null || modelId == null) return null;
            try
            {
                var document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(catalogJson));
                foreach (var item in (IEnumerable)document["models"])
                {
                    var model = item as Dictionary<string, object>;
                    if (model != null && string.Equals(model["id"] as string, modelId, StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(model["sizeBytes"]);
                }
            }
            catch (Exception e) when (e is ArgumentException || e is InvalidOperationException || e is KeyNotFoundException || e is InvalidCastException
                || e is FormatException || e is OverflowException || e is NullReferenceException) { }
            return null;
        }
    }
}
