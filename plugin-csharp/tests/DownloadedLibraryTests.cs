using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using MaxWebViewHost;

class DownloadedLibraryTests
{
    const string Model = "3f2a8a9e-1c1b-4c1e-9f1e-0123456789ab";
    const string Binding = "https://test.example/|MAX-MACHINE|device-1";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static int checks;
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks++; Console.WriteLine("PASS " + name); }
    static void Set(object target, string property, object value) { target.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance).SetValue(target, value); }
    sealed class Tokens : IDeviceTokenSource
    {
        public Task<string> GetTokenAsync(CancellationToken ct) { return Task.FromResult(new string('a', 43)); }
        public void Invalidate() { }
    }
    sealed class Server : HttpMessageHandler
    {
        public int Calls, Sessions, Downloads;
        public bool Offline, Allowed = true;
        public string DownloadError;
        public string FileName;
        public byte[] Package;
        static HttpResponseMessage Reply(object value, int status = 200) { return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(Json.Serialize(value), Encoding.UTF8, "application/json") }; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            if (Offline) throw new HttpRequestException("offline");
            var path = request.RequestUri.AbsolutePath;
            if (path.EndsWith("/entitlements")) return Task.FromResult(Reply(new { allModels = Allowed, modelIds = new string[0] }));
            if (path.EndsWith("/import-session"))
            {
                Sessions++;
                if (DownloadError != null) return Task.FromResult(Reply(new { error = new { code = DownloadError, message = "Denied" } }, 403));
                return Task.FromResult(Reply(new { sessionId = new string('x', 43), sizeBytes = Package.Length,
                    fileType = "zip", filename = FileName, md5 = Hex(MD5.Create().ComputeHash(Package)), sha256 = Hex(SHA256.Create().ComputeHash(Package)), entryFile = (string)null }));
            }
            if (path.Contains("/model-downloads/"))
            {
                Downloads++;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Package) });
            }
            throw new Exception("Unexpected endpoint " + path);
        }
    }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    static byte[] MakePackage(params string[] paths)
    {
        using (var memory = new MemoryStream())
        {
            using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
                foreach (var path in paths.Length == 0 ? new[] { "scene.fbx", "textures/map.jpg" } : paths)
                    using (var writer = new StreamWriter(zip.CreateEntry(path).Open())) writer.Write("test " + path);
            return memory.ToArray();
        }
    }
    static V3Library Fixture(DownloadedLibrary store, Server server, string temp, bool scene = false, string modelId = Model)
    {
        var library = (V3Library)Activator.CreateInstance(typeof(V3Library), true);
        var api = new BackendApi(new Uri("https://test.example/"), new HttpClient(server));
        var session = new DeviceSessionService(new Uri("https://test.example/"), new DummySigner(), "MAX-" + new string('A', 64), new HttpClient(server), () => DateTime.UtcNow);
        typeof(DeviceSessionService).GetField("current", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(session, new DeviceSession { Token = new string('a', 43), ExpiresUtc = DateTime.UtcNow.AddMinutes(15), Entitlements = new Entitlements { AllModels = true, ModelIds = new string[0] } });
        var catalog = new CatalogCacheService(Path.Combine(temp, "catalog"), api);
        var previews = new PreviewCacheService(Path.Combine(temp, "previews"), api);
        var watcher = new CatalogUpdateWatcher(catalog, previews, api, TimeSpan.FromMinutes(5));
        var categoryId = Guid.NewGuid().ToString();
        var aliasId = Guid.NewGuid().ToString();
        var cached = new CachedCatalog { CatalogVersion = 1,
            CatalogJson = Encoding.UTF8.GetBytes(Json.Serialize(new { catalogVersion = 1, models = new[] { new { id = modelId, name = "My chair", categoryId, contentDomain = scene ? "3dscenes" : null, categoryIds = scene ? new[] { categoryId, aliasId } : null } } })),
            CategoriesJson = Encoding.UTF8.GetBytes(Json.Serialize(new[] { new { id = categoryId, name = "Chairs", fullPath = "Furniture / Chairs", parentId = (string)null }, new { id = aliasId, name = "Living", fullPath = "Living", parentId = (string)null } })),
            Previews = new[] { new PreviewEntry { ModelId = modelId, Variant = "sm", Sha256 = new string('f', 64), Url = scene ? "/previews/3dscenes/" + new string('f', 64) + ".webp" : null } } };
        typeof(CatalogUpdateWatcher).GetField("current", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(watcher, cached);
        Set(library, "Downloads", store); Set(library, "Session", session); Set(library, "Catalog", catalog); Set(library, "Watcher", watcher);
        Set(library, "Previews", previews); Set(library, "Downloader", new BackendModelDownloader(api, new Tokens()));
        typeof(V3Library).GetField("deviceBinding", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(library, Binding);
        return library;
    }
    sealed class DummySigner : IDeviceSigner
    {
        public PublicDeviceIdentity GetIdentity() { throw new Exception("Test session should already be authenticated"); }
        public string SignChallenge(string id, string message) { throw new Exception("Test session should already be authenticated"); }
    }
    sealed class OptionsResult
    {
        public ImportOption[] options { get; set; }
        public string defaultOptionId { get; set; }
    }
    static OptionsResult ReadOptions(DownloadedLibrary store, string modelId)
    { return Json.Deserialize<OptionsResult>(Json.Serialize(store.ImportOptions(modelId))); }

    static async Task MultiOptions(string root)
    {
        var directory = Path.Combine(root, "multi"); Directory.CreateDirectory(directory);
        var store = new DownloadedLibrary(Path.Combine(directory, "state"), Path.Combine(directory, "models"));
        var names = new[] {
            "Blue/light_signal_corona_2020.max", "Blue/light_signal_vray_2018.max",
            "Red/light_signal_corona_2020.max", "Red/light_signal_vray_2018.max",
            "Yellow/light_signal_corona_2020.max", "Yellow/light_signal_vray_2018.max", "light_signal.FBX" };
        var server = new Server { Package = MakePackage(names) };
        using (var library = Fixture(store, server, directory))
        {
            await library.DownloadModelAsync(Model, CancellationToken.None, null);
            var calls = server.Calls;
            var result = ReadOptions(store, Model);
            Check(result.options.Length == 6 && store.Find(Model).importOptions.Length == 7, "only the six .max candidates are offered while all seven stay indexed at download");
            Check(result.options.Any(o => o.relativePath == names[0] && o.format == "max" && o.renderer == "corona" && o.maxVersion == 2020), "option metadata preserves variant subfolders and explicit filename hints");
            Check(result.options.All(o => o.format == "max") && !result.options.Any(o => o.relativePath.EndsWith(".FBX")), "the picker lists .max only, even when a mixed-case .FBX sits beside them");
            Check(result.options.All(o => o.optionId.Length == 64 && !Path.IsPathRooted(o.relativePath)) && result.options.Select(o => o.optionId).Distinct().Count() == 6, "public options expose opaque unique IDs and relative paths only");
            Check(result.defaultOptionId == null || result.options.Any(o => o.optionId == result.defaultOptionId), "the advisory default is never a hidden .fbx: it is null here because the preferred file is the .FBX");
            try { library.LocalEntry(Model); throw new Exception("Expected selection required"); }
            catch (ApiException e) { Check(e.Code == "IMPORT_SELECTION_REQUIRED", "multiple candidates never auto-import an arbitrary preferred file"); }
            server.Offline = true;
            foreach (var option in result.options)
            {
                var entry = library.LocalEntry(Model, option.optionId);
                Check(entry.EndsWith(option.relativePath.Replace('/', Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) && store.OwnsEntry(entry), "explicit candidate resolves exact local file and is permitted by agent index");
            }
            Check(server.Calls == calls, "choice listing and importing any variant perform no network or extraction");
            try { library.LocalEntry(Model, new string('0', 64)); throw new Exception("Expected invalid choice"); }
            catch (ApiException e) { Check(e.Code == "IMPORT_OPTION_INVALID", "unknown opaque option cannot select another filesystem file"); }
            var restored = new DownloadedLibrary(Path.Combine(directory, "state"), Path.Combine(directory, "models"));
            Check(ReadOptions(restored, Model).options.Select(o => o.optionId).SequenceEqual(result.options.Select(o => o.optionId)), "all candidate choices and stable IDs survive process restart");
            var model = restored.Find(Model);
            File.WriteAllText(Path.Combine(model.directory, "late-added.max"), "unindexed");
            Check(ReadOptions(restored, Model).options.Length == 6 && !restored.OwnsEntry(Path.Combine(model.directory, "late-added.max")), "already indexed model does not rescan or grant newly inserted files");
            var preferred = result.options[0];
            File.Delete(library.LocalEntry(Model, preferred.optionId));
            Check(restored.List().Length == 1 && ReadOptions(restored, Model).options.Length == 5, "missing offered file keeps model visible when other candidates exist");
            try { library.LocalEntry(Model, preferred.optionId); throw new Exception("Expected missing file"); }
            catch (ApiException e) { Check(e.Code == "MODEL_NOT_DOWNLOADED", "explicit missing candidate fails instead of falling back to another color or renderer"); }
            Check(server.Calls == calls, "missing and unknown choices never trigger silent downloads");
        }
        var legacyId = Guid.NewGuid().ToString();
        var legacyDirectory = Path.Combine(directory, "legacy"); Directory.CreateDirectory(legacyDirectory);
        var legacyEntry = Path.Combine(legacyDirectory, "first.fbx"); File.WriteAllText(legacyEntry, "one");
        Directory.CreateDirectory(Path.Combine(legacyDirectory, "lowpoly")); File.WriteAllText(Path.Combine(legacyDirectory, "lowpoly", "second.max"), "two");
        store.Add(new DownloadedModel { modelId = legacyId, directory = legacyDirectory, entryFile = "first.fbx" });
        Check(store.Find(legacyId).importOptions == null, "older protected records remain readable before options migration");
        Check(Equals(store.Find(legacyId).product["contentDomain"], "3dmodels"), "older downloaded records without product metadata default to Models after reload");
        var migrated = ReadOptions(store, legacyId);
        Check(migrated.options.Length == 1 && migrated.options[0].relativePath == "lowpoly/second.max" && new DownloadedLibrary(Path.Combine(directory, "state"), directory).Find(legacyId).importOptions.Length == 2, "legacy extracted folders are scanned once and persist; one .max beside an .fbx is the only offer (web imports it directly)");
        File.WriteAllText(Path.Combine(legacyDirectory, "third.obj"), "three");
        Check(ReadOptions(store, legacyId).options.Length == 1 && store.Find(legacyId).importOptions.Length == 2, "legacy migration does not rescan on later option requests");
        var fbxOnlyId = Guid.NewGuid().ToString(); var fbxOnlyDirectory = Path.Combine(directory, "fbxonly"); Directory.CreateDirectory(fbxOnlyDirectory);
        File.WriteAllText(Path.Combine(fbxOnlyDirectory, "a.fbx"), "1"); File.WriteAllText(Path.Combine(fbxOnlyDirectory, "b.obj"), "2");
        store.Add(new DownloadedModel { modelId = fbxOnlyId, directory = fbxOnlyDirectory, entryFile = "a.fbx" });
        Check(ReadOptions(store, fbxOnlyId).options.Select(o => o.format).OrderBy(x => x).SequenceEqual(new[] { "fbx", "obj" }), "a package with no .max still offers its .fbx and .obj files");
        try { DownloadedLibrary.ScanOptions(store.Find(legacyId), 2); throw new Exception("Expected bounded scan rejection"); }
        catch (InvalidDataException) { Check(true, "legacy scan enforces entry count budget"); }
        var outside = Path.Combine(directory, "outside.max"); File.WriteAllText(outside, "bad");
        try { DownloadedLibrary.BuildOptions(legacyId, legacyDirectory, new[] { outside }); throw new Exception("Expected outside root rejection"); }
        catch (InvalidDataException) { Check(true, "candidate index rejects importable file outside model-owned directory"); }
        var singleId = Guid.NewGuid().ToString();
        var singleDirectory = Path.Combine(directory, "single"); Directory.CreateDirectory(singleDirectory); File.WriteAllText(Path.Combine(singleDirectory, "only.obj"), "one");
        store.Add(new DownloadedModel { modelId = singleId, directory = singleDirectory, entryFile = "only.obj" });
        Check(store.EntryPath(singleId).EndsWith("only.obj"), "single-candidate legacy imports remain backward compatible without option ID");
        Dictionary<string, object> parsed; string code;
        var optionRequest = Json.Serialize(new { id = "options-1", version = 1, method = "library.importOptions", @params = new { modelId = Model } });
        Check(BridgePolicy.TryParse(optionRequest, out parsed, out code), "options bridge accepts model ID only");
        var importRequest = Json.Serialize(new { id = "import-1", version = 1, method = "asset.import", @params = new { modelId = Model, optionId = new string('a', 64) } });
        Check(BridgePolicy.TryParse(importRequest, out parsed, out code), "import bridge accepts opaque option ID");
        Check(!BridgePolicy.TryParse(importRequest.Replace(new string('a', 64), "C:/Models/chair.max"), out parsed, out code), "import bridge rejects path disguised as option ID");
        var pathRequest = Json.Serialize(new { id = "import-2", version = 1, method = "asset.import", @params = new { modelId = Model, relativePath = "chair.max" } });
        Check(!BridgePolicy.TryParse(pathRequest, out parsed, out code), "import bridge rejects caller-selected relative paths");
        var downloadRequest = Json.Serialize(new { id = "download-2", version = 1, method = "asset.download", @params = new { modelId = Model, optionId = new string('a', 64) } });
        Check(!BridgePolicy.TryParse(downloadRequest, out parsed, out code), "download bridge remains model-only and cannot smuggle import options");
    }

    static async Task Run(string root)
    {
        await MultiOptions(root);
        Check(V3Library.DownloadFolderName("1106880206.rar", root) == "1106880206", "download folder preserves the Drive archive stem");
        Check(V3Library.DownloadFolderName("Phòng khách & Sofa.zip", root) == "Phòng khách & Sofa", "readable Unicode names and spaces are retained");
        Check(V3Library.DownloadFolderName("Bad:Name?.rar", root) == "Bad_Name_" && V3Library.DownloadFolderName("CON.zip", root) == "_CON", "Windows-invalid characters and reserved device names are made safe");
        Check(V3Library.DownloadFolderName("..", root) == "Model" && V3Library.DownloadFolderName(new string('x', 500) + ".rar", root).Length <= 120, "empty or oversized archive stems cannot escape the root or exceed the folder budget");
        var legacySettings = Path.Combine(root, "legacy-settings"); Directory.CreateDirectory(legacySettings);
        var legacyModelDirectory = Path.Combine(root, "legacy-model-location");
        var defaultScenes = Path.Combine(root, "default-scenes");
        var oldSettings = Json.Serialize(new { downloadDirectory = legacyModelDirectory, models = new object[0], rights = new Dictionary<string, bool>() });
        File.WriteAllBytes(Path.Combine(legacySettings, "index.dat"), ProtectedData.Protect(Encoding.UTF8.GetBytes(oldSettings), Encoding.UTF8.GetBytes("3DsMood.DownloadedLibrary.v1"), DataProtectionScope.CurrentUser));
        var migratedSettings = new DownloadedLibrary(legacySettings, Path.Combine(root, "unused-default"), defaultScenes);
        Check(migratedSettings.DownloadDirectory == legacyModelDirectory && migratedSettings.SceneDownloadDirectory == defaultScenes, "legacy protected settings retain the Models folder and initialize a separate Scenes default");
        var sceneRoot = Path.Combine(root, "scenes");
        var sceneState = Path.Combine(sceneRoot, "state");
        var sceneStore = new DownloadedLibrary(sceneState, Path.Combine(sceneRoot, "files"));
        var selectedScenes = Path.Combine(sceneRoot, "ssd-scenes");
        sceneStore.SetDownloadDirectory(selectedScenes, "3dscenes");
        var selectedModels = Path.Combine(sceneRoot, "ssd-models");
        sceneStore.SetDownloadDirectory(selectedModels);
        Check(sceneStore.SceneDownloadDirectory == selectedScenes && sceneStore.DownloadDirectory == selectedModels, "Models and Scenes directory choices are independent");
        var sceneServer = new Server { Package = MakePackage(), FileName = "1106880206.rar" };
        using (var library = Fixture(sceneStore, sceneServer, sceneRoot, true))
        {
            await library.DownloadModelAsync(Model, CancellationToken.None, null);
            var record = new DownloadedLibrary(sceneState, Path.Combine(sceneRoot, "files")).Find(Model);
            Check(record.directory.StartsWith(selectedScenes + Path.DirectorySeparatorChar) && !record.directory.StartsWith(selectedModels + Path.DirectorySeparatorChar), "Scene download extracts into its selected Scenes folder based on native catalog metadata");
            Check(Directory.GetParent(record.directory).Name == "1106880206", "completed Scene folder uses its exact Drive stem instead of the temporary GUID");
            Check(Directory.GetDirectories(selectedScenes, ".3dsmood-*").Length == 0, "completed download leaves no temporary GUID folder behind");
            var siblingId = Guid.NewGuid().ToString();
            using (var sibling = Fixture(sceneStore, sceneServer, sceneRoot, true, siblingId))
            {
                await sibling.DownloadModelAsync(siblingId, CancellationToken.None, null);
                Check(Directory.GetParent(sceneStore.Find(siblingId).directory).Name == "1106880206 (2)" && File.Exists(Path.Combine(record.directory, record.entryFile)), "same-named downloads receive a numeric suffix without modifying the existing Scene");
            }
            var fileCollision = Path.Combine(selectedScenes, "Occupied"); File.WriteAllText(fileCollision, "keep");
            var thirdId = Guid.NewGuid().ToString(); sceneServer.FileName = "Occupied.zip";
            using (var third = Fixture(sceneStore, sceneServer, sceneRoot, true, thirdId))
            {
                await third.DownloadModelAsync(thirdId, CancellationToken.None, null);
                Check(Directory.GetParent(sceneStore.Find(thirdId).directory).Name == "Occupied (2)" && File.ReadAllText(fileCollision) == "keep", "a colliding user file is not overwritten or treated as a download directory");
            }
            var savedEntry = library.LocalEntry(Model);
            var calls = sceneServer.Calls;
            var nextScenes = Path.Combine(sceneRoot, "next-scenes");
            sceneStore.SetDownloadDirectory(nextScenes, "3dscenes");
            await library.DownloadModelAsync(Model, CancellationToken.None, null);
            Check(library.LocalEntry(Model) == savedEntry && sceneServer.Calls == calls, "changing the Scenes folder preserves existing imports and never redownloads a local Scene");
            Check(new DownloadedLibrary(sceneState, Path.Combine(sceneRoot, "files")).SceneDownloadDirectory == nextScenes, "Scenes folder choice survives protected index reload");
            Check(Equals(record.product["contentDomain"], "3dscenes") && ((System.Collections.IEnumerable)record.product["categoryIds"]).Cast<object>().Count() == 2,
                "Scene domain and category aliases survive encrypted downloaded snapshot reload");
            Check(Convert.ToString(record.product["thumb"]).StartsWith("/previews/3dscenes/") && ((System.Collections.IEnumerable)record.product["folderIds"]).Cast<object>().Count() == 2,
                "Scene scoped preview and every category placement survive offline snapshot");
        }
        var state = Path.Combine(root, "state"); var first = Path.Combine(root, "first"); var second = Path.Combine(root, "second");
        var store = new DownloadedLibrary(state, first);
        Check(!store.Allows(Binding), "new devices fail closed without verified rights");
        var server = new Server { Package = MakePackage(), FileName = "Drive model.zip" };
        using (var library = Fixture(store, server, root))
        {
            var changes = 0; library.HostEvent += (type, data) => { if (type == "library.downloadsChanged") changes++; };
            var result = await library.DownloadModelAsync(Model, CancellationToken.None, null);
            Check(result != null && server.Sessions == 1 && server.Downloads == 1, "download fetches exactly one archive without scene or import dependencies");
            var model = store.Find(Model);
            Check(model.directory.StartsWith(first + Path.DirectorySeparatorChar), "legacy Models download still uses its original Models folder");
            Check(Directory.GetParent(model.directory).Name == "Drive model", "Models folder uses the Drive filename even when catalog display name differs");
            Check(model != null && model.name == "My chair" && Equals(model.product["folderPath"], "Furniture / Chairs"), "catalog dictionary arrays produce persistent name and category snapshot");
            Check(Equals(model.product["contentDomain"], "3dmodels"), "legacy catalog records default to Models");
            Check(File.Exists(Path.Combine(model.directory, "textures", "map.jpg")), "extracted textures remain beside local model");
            Check(Directory.GetFiles(first, "package.bin", SearchOption.AllDirectories).Length == 0, "no temporary package.bin is left after extraction and indexing");
            Check(File.Exists(Path.Combine(Directory.GetParent(model.directory).FullName, "Drive model.zip")), "original archive is kept beside content/ under its Drive name");
            Check(changes == 1, "completed download publishes downloaded-library event");
            var calls = server.Calls;
            await library.DownloadModelAsync(Model, CancellationToken.None, null);
            Check(server.Calls == calls, "downloading an indexed model performs no network or extraction again");
            server.Offline = true;
            var entry = library.LocalEntry(Model);
            Check(File.Exists(entry) && server.Calls == calls, "local import resolves directly without any network calls");
            Check(store.RootForEntry(entry) == Path.GetFullPath(model.directory), "texture lookup uses the indexed model root rather than the FBX parent folder");
            Check(new TexturePathResolver(store.RootForEntry(entry), entry).Resolve("map.jpg") == Path.Combine(model.directory, "textures", "map.jpg"), "downloaded texture becomes an absolute local path without network access");
            try { store.RootForEntry(Path.Combine(model.directory, "textures", "map.jpg")); throw new Exception("Expected unindexed entry rejection"); }
            catch (InvalidDataException) { Check(true, "a texture path cannot masquerade as an indexed import entry"); }
            store.SetDownloadDirectory(second);
            Check(store.DownloadDirectory == Path.GetFullPath(second) && library.LocalEntry(Model) == entry, "changing root preserves old indexed model and texture paths");
            Check(store.RootForEntry(entry) == Path.GetFullPath(model.directory), "changing the default download folder preserves old texture lookup roots");
        }
        var restored = new DownloadedLibrary(state, first);
        Check(restored.List().Length == 1 && restored.DownloadDirectory == Path.GetFullPath(second), "download list and chosen root survive process restart");
        Check(restored.Allows(Binding) && !restored.Allows(Binding + "different-device"), "offline rights remain bound to verified device and API origin");
        using (var library = Fixture(restored, server, root))
        {
            var calls = server.Calls;
            Check(File.Exists(library.LocalEntry(Model)) && server.Calls == calls, "restart offline import stays local");
            restored.RecordRights(Binding, false);
            try { library.LocalEntry(Model); throw new Exception("Expected denial"); } catch (ApiException e) { Check(e.Code == "NOT_ENTITLED", "observed revocation blocks offline import"); }
            Check(!new DownloadedLibrary(state, first).Allows(Binding), "revocation remains denied after restart");
            server.Offline = false; server.Allowed = true; server.DownloadError = "NOT_ENTITLED";
            try { await library.DownloadModelAsync(Guid.NewGuid().ToString(), CancellationToken.None, null); throw new Exception("Expected denial"); }
            catch (ApiException e) { Check(e.Code == "NOT_ENTITLED" && !restored.Allows(Binding), "download server denial overrides previously allowed cached rights"); }
            Check(Directory.GetDirectories(second).Length == 0, "failed downloads leave no extracted partial model directory");
        }
        var indexed = restored.Find(Model); var path = Path.Combine(indexed.directory, indexed.entryFile);
        Check(restored.OwnsEntry(path) && !restored.OwnsEntry(Path.Combine(root, "unknown.max")), "custom-root agent accepts only exact indexed entry");
        indexed.entryFile = "..\\..\\outside.max"; File.WriteAllText(Path.Combine(root, "outside.max"), "bad");
        try { restored.Add(indexed); throw new Exception("Expected traversal rejection"); } catch (InvalidDataException) { Check(true, "index rejects paths escaping owned model directory"); }
        File.Delete(path);
        Check(restored.List().Length == 0, "missing local entry is excluded from downloaded list");
        try { restored.EntryPath(Model); throw new Exception("Expected missing model"); } catch (ApiException e) { Check(e.Code == "MODEL_NOT_DOWNLOADED", "missing local entry reports redownload requirement without silently downloading"); }
        var favoriteId = Guid.NewGuid().ToString(); var otherId = Guid.NewGuid().ToString();
        Check(restored.Favorites().Length == 0, "a library with no favorites starts empty");
        restored.SetFavorite(favoriteId.ToUpperInvariant(), true); restored.SetFavorite(favoriteId, true); restored.SetFavorite(otherId, true);
        Check(restored.Favorites().SequenceEqual(new[] { favoriteId, otherId }), "favorites are stored once, normalized to lowercase UUIDs");
        Check(new DownloadedLibrary(state, first).Favorites().Length == 2, "favorites survive reopening the protected index");
        Check(restored.SetFavorite(favoriteId, false).SequenceEqual(new[] { otherId }), "removing a favorite keeps the others");
        try { restored.SetFavorite("..\\evil", true); throw new Exception("Expected invalid id"); } catch (InvalidDataException) { Check(true, "favorite rejects a non-UUID id"); }
        // Favorite folders: a model sits in exactly one folder; "default" is built in; deleting a folder un-favorites its models.
        var js = new JavaScriptSerializer();
        Func<object, Dictionary<string, object>> view = o => js.Deserialize<Dictionary<string, object>>(js.Serialize(o));
        Func<Dictionary<string, object>, string[]> folderIds = v => ((System.Collections.ArrayList)v["folders"]).Cast<Dictionary<string, object>>().Select(f => (string)f["id"]).ToArray();
        Func<Dictionary<string, object>, Dictionary<string, object>> assigned = v => (Dictionary<string, object>)v["assignments"];
        Func<Action, bool> rejected = a => { try { a(); return false; } catch (InvalidDataException) { return true; } };
        var created = view(restored.CreateFavoriteFolder("  Phòng khách ", "3dmodels"));
        var folder = folderIds(created).Single();
        Check(((Dictionary<string, object>)((System.Collections.ArrayList)created["folders"])[0])["name"] as string == "Phòng khách", "folder name is trimmed");
        Check(rejected(() => restored.CreateFavoriteFolder("PHÒNG KHÁCH", "3dmodels")), "folder names are unique per domain, ignoring case");
        Check(folderIds(view(restored.CreateFavoriteFolder("Phòng khách", "3dscenes"))).Length == 2, "the same name is allowed in the other domain");
        Check(rejected(() => restored.CreateFavoriteFolder("Default", "3dmodels")) && rejected(() => restored.CreateFavoriteFolder("tất cả", "3dmodels")), "built-in folder names are reserved");
        Check(rejected(() => restored.CreateFavoriteFolder("   ", "3dmodels")) && rejected(() => restored.CreateFavoriteFolder(new string('x', 41), "3dmodels"))
            && rejected(() => restored.CreateFavoriteFolder("a\nb", "3dmodels")) && rejected(() => restored.CreateFavoriteFolder("ok", "other")), "empty, long, control-character names and unknown domains are rejected");
        var folderedId = Guid.NewGuid().ToString();
        var placed = view(restored.SetFavoriteFolder(folderedId.ToUpperInvariant(), folder));
        Check(((System.Collections.ArrayList)placed["favorites"]).Contains(folderedId) && (string)assigned(placed)[folderedId] == folder, "choosing a folder favorites the model into exactly that folder");
        Check(!assigned(view(restored.SetFavoriteFolder(folderedId, "default"))).ContainsKey(folderedId) && restored.Favorites().Contains(folderedId), "moving to default clears the assignment but keeps the favorite");
        Check(rejected(() => restored.SetFavoriteFolder(folderedId, Guid.NewGuid().ToString())) && rejected(() => restored.SetFavoriteFolder(folderedId, "..\\x")) && rejected(() => restored.SetFavoriteFolder("..\\x", "default")), "unknown folder and non-UUID ids are rejected");
        restored.SetFavoriteFolder(folderedId, folder);
        Check((string)assigned(view(new DownloadedLibrary(state, first).FavoriteState()))[folderedId] == folder, "folders and assignments survive reopening the protected index");
        Check(rejected(() => restored.RenameFavoriteFolder(folder, "phòng khách")) == false && rejected(() => restored.RenameFavoriteFolder(folder, "Default")), "renaming to its own name (any case) is fine, to a reserved name is not");
        var renamed = view(restored.RenameFavoriteFolder(folder, "Sảnh"));
        Check(((Dictionary<string, object>)((System.Collections.ArrayList)renamed["folders"])[0])["name"] as string == "Sảnh", "folder can be renamed");
        restored.SetFavorite(folderedId, false);
        Check(!assigned(view(restored.FavoriteState())).ContainsKey(folderedId), "un-favoriting drops the folder assignment");
        restored.SetFavoriteFolder(folderedId, folder);
        var afterDelete = view(restored.DeleteFavoriteFolder(folder));
        Check(!folderIds(afterDelete).Contains(folder) && !restored.Favorites().Contains(folderedId) && restored.Favorites().Contains(otherId) && assigned(afterDelete).Count == 0,
            "deleting a folder un-favorites its models and keeps the Default ones");
        Check(rejected(() => restored.DeleteFavoriteFolder(folder)), "deleting a missing folder is rejected");
        for (var n = 0; n < 50; n++) restored.CreateFavoriteFolder("Thu muc " + n, "3dmodels");
        Check(rejected(() => restored.CreateFavoriteFolder("One too many", "3dmodels")), "at most 50 folders per domain");
        var index = Path.Combine(state, "index.dat"); var bytes = File.ReadAllBytes(index); bytes[bytes.Length - 1] ^= 1; File.WriteAllBytes(index, bytes);
        try { restored.List(); throw new Exception("Expected tampered index rejection"); } catch (InvalidDataException) { Check(true, "tampered DPAPI index fails closed"); }
        Dictionary<string, object> parsed; string code;
        var envelope = "{\"id\":\"download-test\",\"version\":1,\"method\":\"asset.download\",\"params\":{\"modelId\":\"" + Model + "\"}}";
        Check(BridgePolicy.TryParse(envelope, out parsed, out code), "download bridge accepts only model ID");
        Check(!BridgePolicy.TryParse(envelope.Replace("modelId", "path"), out parsed, out code), "download bridge rejects arbitrary paths");
        var choose = "{\"id\":\"settings-test\",\"version\":1,\"method\":\"library.chooseDownloadDirectory\",\"params\":{}}";
        Check(BridgePolicy.TryParse(choose, out parsed, out code) && !BridgePolicy.TryParse(choose.Replace("\"params\":{}", "\"params\":{\"path\":\"C:/Windows\"}"), out parsed, out code), "folder chooser cannot accept paths from JavaScript");
        var chooseScene = choose.Replace("\"params\":{}", "\"params\":{\"contentDomain\":\"3dscenes\"}");
        Check(BridgePolicy.TryParse(chooseScene, out parsed, out code), "folder chooser accepts the Scenes domain without a caller-provided path");
        Check(!BridgePolicy.TryParse(chooseScene.Replace("3dscenes", "unknown"), out parsed, out code), "folder chooser rejects unknown domains");
        string Fav(string method, string parameters) { return "{\"id\":\"fav-test\",\"version\":1,\"method\":\"" + method + "\",\"params\":" + parameters + "}"; }
        Check(BridgePolicy.TryParse(Fav("library.favorites", "{}"), out parsed, out code) && !BridgePolicy.TryParse(Fav("library.favorites", "{\"x\":1}"), out parsed, out code), "favorites list takes no parameters");
        Check(BridgePolicy.TryParse(Fav("library.setFavoriteFolder", "{\"modelId\":\"" + Model + "\",\"folderId\":\"default\"}"), out parsed, out code)
            && BridgePolicy.TryParse(Fav("library.setFavoriteFolder", "{\"modelId\":\"" + Model + "\",\"folderId\":\"" + Model + "\"}"), out parsed, out code), "setFavoriteFolder accepts a model UUID with default or a folder UUID");
        Check(!BridgePolicy.TryParse(Fav("library.setFavoriteFolder", "{\"modelId\":\"" + Model + "\",\"folderId\":\"C:/x\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.setFavoriteFolder", "{\"modelId\":\"" + Model + "\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.setFavoriteFolder", "{\"modelId\":\"" + Model + "\",\"folderId\":\"default\",\"path\":\"x\"}"), out parsed, out code), "setFavoriteFolder rejects paths, missing and extra parameters");
        Check(BridgePolicy.TryParse(Fav("library.createFavoriteFolder", "{\"name\":\"Phòng khách\",\"contentDomain\":\"3dscenes\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.createFavoriteFolder", "{\"name\":\"x\",\"contentDomain\":\"other\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.createFavoriteFolder", "{\"name\":\"" + new string('x', 41) + "\",\"contentDomain\":\"3dmodels\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.createFavoriteFolder", "{\"name\":\"x\"}"), out parsed, out code), "createFavoriteFolder takes a bounded name and a known domain");
        Check(BridgePolicy.TryParse(Fav("library.renameFavoriteFolder", "{\"folderId\":\"" + Model + "\",\"name\":\"Mới\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.renameFavoriteFolder", "{\"folderId\":\"default\",\"name\":\"Mới\"}"), out parsed, out code), "the built-in default folder cannot be renamed through the bridge");
        Check(BridgePolicy.TryParse(Fav("library.deleteFavoriteFolder", "{\"folderId\":\"" + Model + "\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.deleteFavoriteFolder", "{\"folderId\":\"default\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.deleteFavoriteFolder", "{}"), out parsed, out code), "the built-in default folder cannot be deleted through the bridge");
        foreach (var update in new[] { "host.checkUpdate", "host.applyUpdate" })
            Check(BridgePolicy.TryParse(Fav(update, "{}"), out parsed, out code) && !BridgePolicy.TryParse(Fav(update, "{\"url\":\"https://evil.test/x.mzp\"}"), out parsed, out code), update + " takes no parameters (host picks the package, never the web)");
        Check(BridgePolicy.TryParse(Fav("library.setFavorite", "{\"modelId\":\"" + Model + "\",\"favorite\":true}"), out parsed, out code), "setFavorite accepts a model UUID and a boolean");
        Check(!BridgePolicy.TryParse(Fav("library.setFavorite", "{\"modelId\":\"" + Model + "\",\"favorite\":\"yes\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.setFavorite", "{\"modelId\":\"C:/x\",\"favorite\":true}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.setFavorite", "{\"modelId\":\"" + Model + "\"}"), out parsed, out code)
            && !BridgePolicy.TryParse(Fav("library.setFavorite", "{\"modelId\":\"" + Model + "\",\"favorite\":true,\"path\":\"C:/x\"}"), out parsed, out code), "setFavorite rejects non-boolean, non-UUID, missing or extra parameters");
    }
    static int Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "3dsmood-download-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try { Run(root).GetAwaiter().GetResult(); Console.WriteLine(checks + " checks passed"); return 0; }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
