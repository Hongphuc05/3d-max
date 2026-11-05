// D30: ModelCacheService - models stored on the customer's disk (Models\<modelId>\{content\, manifest.json}).
using System;
using System.IO;
using System.Linq;
using System.Text;
using MaxWebViewHost;

class ModelCacheTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Uuid(int n) { return "00000000-0000-4000-8000-" + n.ToString("D12"); }

    /// <summary>A staged import exactly as ImportAssetAsync leaves it: staging\content\<rel> holding the entry file.</summary>
    static string Stage(ModelCacheService cache, string rel, string body)
    {
        var staging = cache.NewStaging();
        var file = Path.Combine(staging, "content", rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        File.WriteAllText(file, body);
        return staging;
    }

    static bool Throws<T>(Action action) where T : Exception { try { action(); return false; } catch (T) { return true; } }

    static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "model-cache-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var cache = new ModelCacheService(root);

            // 1. commit -> the model is found again under its own folder, content intact, staging gone
            var staging = Stage(cache, "lamp/lamp.max", "v1");
            var stored = cache.Commit(Uuid(1), staging, "lamp/lamp.max", 111);
            Check(stored != null && File.Exists(stored.EntryPath) && File.ReadAllText(stored.EntryPath) == "v1", "commit stores the model and returns its entry file");
            Check(stored.EntryPath.StartsWith(Path.Combine(root, Uuid(1), "content"), StringComparison.OrdinalIgnoreCase), "entry file lives under Models\\<modelId>\\content");
            Check(!Directory.Exists(staging), "staging folder was moved, not copied");
            var again = cache.TryGet(Uuid(1), 111);
            Check(again != null && again.EntryPath == stored.EntryPath && again.PackageSize == 111, "TryGet finds the committed model (no network involved)");

            // 2. same id in another case is the same model (Windows paths are case-insensitive; the web sends lower-case ids)
            var lower = "abcdef12-0000-4000-8000-00000000000a";
            var stagingCase = Stage(cache, "c.max", "c"); cache.Commit(lower.ToUpperInvariant(), stagingCase, "c.max", 3);
            Check(cache.TryGet(lower, 3) != null && cache.ListDownloaded().Contains(lower), "model id is case-insensitive and stored in lower case");
            Directory.Delete(Path.Combine(root, lower), true);

            // 3. staleness: the catalog says the package changed size -> not a hit (host downloads again)
            Check(cache.TryGet(Uuid(1), 222) == null, "a different package size is a miss");
            Check(cache.TryGet(Uuid(1), null) != null, "unknown catalog size is not a reason to miss");

            // 4. replacing an older version
            var staging2 = Stage(cache, "lamp/lamp.max", "v2");
            var replaced = cache.Commit(Uuid(1), staging2, "lamp/lamp.max", 222);
            Check(replaced != null && File.ReadAllText(replaced.EntryPath) == "v2" && cache.TryGet(Uuid(1), 222) != null && cache.TryGet(Uuid(1), 111) == null, "a new commit replaces the older version");

            // 5. list = committed models only
            Directory.CreateDirectory(Path.Combine(root, Uuid(9)));                       // no manifest
            var staging3 = Stage(cache, "a.fbx", "x"); cache.Commit(Uuid(2), staging3, "a.fbx", 5);
            Stage(cache, "pending.max", "half-written");                                   // still in staging
            var listed = cache.ListDownloaded().OrderBy(s => s).ToArray();
            Check(listed.SequenceEqual(new[] { Uuid(1), Uuid(2) }), "ListDownloaded returns committed models only (no empty folder, no staging)");

            // 6. damaged cache is a miss, never an exception
            File.Delete(cache.TryGet(Uuid(2), null).EntryPath);
            Check(cache.TryGet(Uuid(2), null) == null && !cache.ListDownloaded().Contains(Uuid(2)), "a deleted entry file turns the model into a miss and drops it from the list");
            File.WriteAllText(Path.Combine(root, Uuid(1), "manifest.json"), "not json");
            Check(cache.TryGet(Uuid(1), null) == null, "a corrupt manifest is a miss");

            // 7. a manifest may not point outside its own content folder
            var staging4 = Stage(cache, "ok.max", "ok"); cache.Commit(Uuid(3), staging4, "ok.max", 1);
            File.WriteAllText(Path.Combine(root, Uuid(3), "manifest.json"), "{\"entry\":\"../../outside.max\",\"packageSize\":1}");
            File.WriteAllText(Path.Combine(root, "outside.max"), "secret");
            Check(cache.TryGet(Uuid(3), null) == null, "manifest entry with .. is rejected");

            // 8. trust boundary: ids and staging folders are validated
            foreach (var bad in new[] { null, "", "..", "..\\x", "a/b", "a b", new string('a', 65) })
                Check(cache.TryGet(bad, null) == null, "invalid model id is a miss: " + (bad ?? "null"));
            Check(Throws<ArgumentException>(() => cache.Commit("..\\x", Stage(cache, "a.max", "x"), "a.max", 1)), "commit rejects an invalid model id");
            var outside = Path.Combine(Path.GetTempPath(), "outside-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(outside, "content")); File.WriteAllText(Path.Combine(outside, "content", "a.max"), "x");
            Check(Throws<ArgumentException>(() => cache.Commit(Uuid(4), outside, "a.max", 1)), "commit only accepts folders made by NewStaging");
            Directory.Delete(outside, true);
            Check(Throws<InvalidDataException>(() => cache.Commit(Uuid(5), Stage(cache, "a.max", "x"), "missing.max", 1)), "commit requires the declared entry file to exist");
            Check(cache.TryGet(Uuid(5), null) == null, "a rejected commit leaves nothing behind");

            // 9. staging folders are distinct and live inside the cache root
            var s1 = cache.NewStaging(); var s2 = cache.NewStaging();
            Check(s1 != s2 && s1.StartsWith(root, StringComparison.OrdinalIgnoreCase), "NewStaging gives distinct folders inside the cache root");

            // 10. catalog size lookup (catalog JSON as /api/v1/catalog serves it)
            var catalog = Encoding.UTF8.GetBytes("{\"catalogVersion\":3,\"models\":[{\"id\":\"" + Uuid(1) + "\",\"name\":\"Lamp\",\"sizeBytes\":222,\"fileType\":\"zip\"},{\"id\":\"" + Uuid(2) + "\",\"sizeBytes\":9007199254}]}");
            Check(ModelCacheService.SizeInCatalog(catalog, Uuid(1)) == 222, "catalog size is read by model id");
            Check(ModelCacheService.SizeInCatalog(catalog, Uuid(2)) == 9007199254L, "catalog size handles values beyond int range");
            Check(ModelCacheService.SizeInCatalog(catalog, Uuid(7)) == null, "unknown model has no catalog size");
            Check(ModelCacheService.SizeInCatalog(null, Uuid(1)) == null && ModelCacheService.SizeInCatalog(Encoding.UTF8.GetBytes("garbage"), Uuid(1)) == null, "missing or garbage catalog has no size, never throws");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (IOException) { }
            try { File.Delete(Path.Combine(Path.GetTempPath(), "outside.max")); } catch (IOException) { }
        }
        Console.WriteLine("ALL PASS");
    }
}
