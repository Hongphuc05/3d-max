using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    /// <summary>Composition root of the v3 online library: device session, catalog + preview caches, update watcher and downloader,
    /// all talking to the single configured API host. The web UI only ever sees local, already-verified data.</summary>
    internal sealed class V3Library : IDisposable
    {
        private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(250);
        private readonly DateTime started = DateTime.UtcNow;
        private DateTime lastProgress = DateTime.MinValue;
        private readonly object progressGate = new object();

        public string MachineCode { get; private set; }
        public DeviceSessionService Session { get; private set; }
        public CatalogCacheService Catalog { get; private set; }
        public PreviewCacheService Previews { get; private set; }
        public CatalogUpdateWatcher Watcher { get; private set; }
        public BackendModelDownloader Downloader { get; private set; }
        public OrdersClient Orders { get; private set; }
        public DownloadedLibrary Downloads { get; private set; }
        private string deviceBinding;
        private readonly SemaphoreSlim downloadGate = new SemaphoreSlim(1, 1);
        private int refreshingRights;
        public bool Offline { get; private set; }

        /// <summary>Events for the web UI (library.updated, library.offline, library.previewProgress). Raised on a worker thread.</summary>
        public event Action<string, object> HostEvent;

        private V3Library() { }

        /// <param name="dataRoot">%LOCALAPPDATA%\3dMood — Catalog\ and Previews\ live below it.</param>
        public static V3Library Create(PluginConfiguration configuration, IDeviceSigner signer, string machineCode, string dataRoot)
        {
            if (configuration == null || configuration.ApiBaseUri == null || signer == null) throw new ArgumentNullException();
            var library = new V3Library { MachineCode = machineCode };
            library.Downloads = new DownloadedLibrary();
            library.deviceBinding = configuration.ApiBaseUri.AbsoluteUri + "|" + machineCode + "|" + signer.GetIdentity().deviceId;
            var apiClient = SecureHttpTransport.CreateClient(false, false, TimeSpan.FromSeconds(20));
            var bulkClient = SecureHttpTransport.CreateClient(false, false, TimeSpan.FromMinutes(30)); // the server fills its copy before the first byte
            var downloadApi = new BackendApi(configuration.ApiBaseUri, bulkClient);
            var api = new BackendApi(configuration.ApiBaseUri, apiClient);
            library.Session = new DeviceSessionService(configuration.ApiBaseUri, signer, machineCode,
                SecureHttpTransport.CreateClient(false, false, TimeSpan.FromSeconds(20)), () => DateTime.UtcNow);
            library.Catalog = new CatalogCacheService(Path.Combine(dataRoot, "Catalog"), api);
            library.Previews = new PreviewCacheService(Path.Combine(dataRoot, "Previews"), api);
            library.Watcher = new CatalogUpdateWatcher(library.Catalog, library.Previews, api, TimeSpan.FromMinutes(5));
            library.Downloader = new BackendModelDownloader(downloadApi, library.Session);
            library.Orders = new OrdersClient(api, library.Session);
            library.Watcher.Updated += c => library.Raise("library.updated", new Dictionary<string, object> { { "catalogVersion", c.CatalogVersion } });
            library.Watcher.OfflineChanged += offline => { library.Offline = offline; library.Raise("library.offline", new Dictionary<string, object> { { "offline", offline } }); };
            library.Previews.Progress += (done, total) =>
            {
                lock (library.progressGate)
                {
                    if (done < total && DateTime.UtcNow - library.lastProgress < ProgressInterval) return;
                    library.lastProgress = DateTime.UtcNow;
                }
                library.Raise("library.previewProgress", new Dictionary<string, object> { { "done", done }, { "total", total } });
            };
            return library;
        }

        private void Raise(string type, object payload)
        {
            var handler = HostEvent;
            if (handler == null) return;
            try { handler(type, payload); } catch (Exception e) { System.Diagnostics.Debug.WriteLine("[v3] event handler failed: " + e.GetType().Name); }
        }

        public void SetPanelOpen(bool open) { Watcher.SetActive(open); }

        public CachedCatalog GetCached() { return Watcher.Current ?? Catalog.Load(); }

        /// <summary>The cached catalog, fetching it once (bounded) when the cache is still empty. Null when neither works.</summary>
        public async Task<CachedCatalog> EnsureCatalogAsync(CancellationToken ct)
        {
            var cached = GetCached();
            if (cached != null) return cached;
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                deadline.CancelAfter(TimeSpan.FromSeconds(15));
                try
                {
                    // FetchCatalogAsync, not CheckNowAsync: never wait for the preview download; start it in the background instead
                    // (otherwise it would only begin at the next 5-minute poll after an offline first run).
                    await Watcher.FetchCatalogAsync(deadline.Token).ConfigureAwait(false);
                    if (GetCached() != null) Watcher.CheckInBackground();
                }
                catch (Exception e) when (e is ApiException || (e is OperationCanceledException && !ct.IsCancellationRequested)) { }
            }
            return GetCached();
        }

        public PreviewEntry FindPreview(string sha)
        {
            var catalog = GetCached();
            return catalog == null ? null : catalog.Previews.FirstOrDefault(p => p.Sha256 == sha);
        }

        public async Task<Entitlements> GetEntitlementsAsync(CancellationToken ct)
        {
            // Cached rights are available immediately after restart, including offline startup.
            // Refresh in the background: local import never waits for an unavailable server.
            if (Downloads.HasRights(deviceBinding))
            {
                var allowed = Downloads.Allows(deviceBinding);
                if (Interlocked.CompareExchange(ref refreshingRights, 1, 0) == 0)
                {
                    var ignored = Task.Run(async () => {
                        try
                        {
                            await RefreshRightsAsync(ct).ConfigureAwait(false);
                        }
                        catch (Exception e) { System.Diagnostics.Debug.WriteLine("[rights] " + e.GetType().Name); }
                        finally
                        {
                            try { if (Downloads.Allows(deviceBinding) != allowed) Raise("library.updated", new { catalogVersion = GetCached()?.CatalogVersion }); } catch (IOException) { }
                            Interlocked.Exchange(ref refreshingRights, 0);
                        }
                    });
                }
                return new Entitlements { AllModels = allowed, ModelIds = new string[0] };
            }
            return await RefreshRightsAsync(ct).ConfigureAwait(false);
        }

        private async Task<Entitlements> RefreshRightsAsync(CancellationToken ct)
        {
            try
            {
                var rights = await Session.RefreshEntitlementsAsync(ct).ConfigureAwait(false);
                Downloads.RecordRights(deviceBinding, rights.AllModels);
                return rights;
            }
            catch (ApiException e) when (e.Code == "DEVICE_BLOCKED" || e.Code == "NOT_ENTITLED")
            { Downloads.RecordRights(deviceBinding, false); throw; }
            catch (ApiException e) when (e.Code == "SERVER_UNAVAILABLE")
            { return new Entitlements { AllModels = Downloads.Allows(deviceBinding), ModelIds = new string[0] }; }
        }

        public string LocalEntry(string modelId, string optionId = null)
        {
            if (!Downloads.Allows(deviceBinding)) throw new ApiException("NOT_ENTITLED", 403, "Thiết bị chưa có quyền dùng thư viện hoặc quyền đã bị thu hồi.");
            return Downloads.EntryPath(modelId, optionId);
        }

        public void DownloadsChanged() { Raise("library.downloadsChanged", null); }

        public async Task<object> DownloadModelAsync(string modelId, CancellationToken ct, Action<long, long?> progress)
        {
            await downloadGate.WaitAsync(ct).ConfigureAwait(false);
            string work = null;
            try
            {
                // An existing model is returned immediately, with no network or extraction.
                var existing = Downloads.Find(modelId);
                if (existing != null) return existing.PublicView();
                var rights = await RefreshRightsAsync(ct).ConfigureAwait(false);
                if (!rights.AllModels) throw new ApiException("NOT_ENTITLED", 403, "Thiết bị chưa có license thư viện.");
                var root = Downloads.DirectoryFor(DownloadDomain(modelId));
                Directory.CreateDirectory(root);
                DownloadedLibrary.RejectReparse(root);
                work = Path.Combine(root, ".3dsmood-" + Guid.NewGuid().ToString("N"));
                var content = Path.Combine(work, "content");
                Directory.CreateDirectory(content);
                var package = Path.Combine(work, "package.bin");
                ModelDownloadInfo info;
                try { info = await Downloader.DownloadAsync(modelId, package, ct, progress).ConfigureAwait(false); }
                catch (ApiException e) when (e.Code == "DEVICE_BLOCKED" || e.Code == "NOT_ENTITLED")
                { Downloads.RecordRights(deviceBinding, false); throw; }
                string[] files;
                if (new[] { "max", "fbx", "obj" }.Contains(info.FileType))
                {
                    var direct = Path.Combine(content, "model." + info.FileType);
                    File.Move(package, direct); files = new[] { direct };
                }
                else files = ArchivePackage.Extract(package, content, ct, null);
                string entry = null;
                if (!string.IsNullOrEmpty(info.EntryFile))
                {
                    var specified = Path.GetFullPath(Path.Combine(content, info.EntryFile.Replace('/', Path.DirectorySeparatorChar)));
                    entry = files.FirstOrDefault(f => string.Equals(f, specified, StringComparison.OrdinalIgnoreCase));
                    if (entry == null) throw new InvalidDataException("File import khai báo không có trong gói model.");
                }
                else foreach (var extension in new[] { ".fbx", ".obj", ".max" })
                {
                    entry = files.Where(f => f.EndsWith(extension, StringComparison.OrdinalIgnoreCase)).OrderBy(f => f.Length).ThenBy(f => f, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
                    if (entry != null) break;
                }
                if (entry == null) throw new ApiException("ASSET_NO_IMPORTABLE_FILE", 422, "Gói model không có file .max/.fbx/.obj.");
                if (File.Exists(package)) File.Delete(package);
                ct.ThrowIfCancellationRequested();
                var record = new DownloadedModel { modelId = modelId, directory = content, entryFile = entry.Substring(content.Length + 1),
                    downloadedAt = DateTime.UtcNow.ToString("o"), sizeBytes = info.SizeBytes, name = modelId, product = ProductSnapshot(modelId, info) };
                object name; if (record.product.TryGetValue("name", out name)) record.name = name as string ?? modelId;
                record.importOptions = DownloadedLibrary.BuildOptions(modelId, content, files);
                Downloads.Add(record);
                work = null; // the indexed contents and textures now have a permanent stable location
                DownloadsChanged();
                return record.PublicView();
            }
            finally
            {
                if (work != null && Directory.Exists(work))
                {
                    try { DownloadedLibrary.RejectReparse(work); Directory.Delete(work, true); } catch (IOException) { }
                }
                downloadGate.Release();
            }
        }

        private string DownloadDomain(string modelId)
        {
            var cached = GetCached();
            if (cached == null) return "3dmodels";
            var catalog = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 }
                .Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(cached.CatalogJson));
            var models = ((System.Collections.IEnumerable)catalog["models"]).Cast<Dictionary<string, object>>();
            var model = models.FirstOrDefault(m => Equals(m["id"], modelId));
            object domain;
            return model != null && model.TryGetValue("contentDomain", out domain) && domain != null ? Convert.ToString(domain) : "3dmodels";
        }

        private Dictionary<string, object> ProductSnapshot(string modelId, ModelDownloadInfo info)
        {
            var result = new Dictionary<string, object> { { "id", modelId }, { "slug", modelId }, { "name", modelId },
                { "contentDomain", "3dmodels" }, { "categoryId", null }, { "categoryIds", new string[0] },
                { "category", "Khác" }, { "subcategory", "" }, { "folderPath", "" }, { "folderIds", new string[0] },
                { "thumb", null }, { "image", null }, { "downloadable", true }, { "status", "ready" },
                { "info", new { sizeMB = Math.Round(info.SizeBytes / 1048576.0, 1), renderers = new string[0], formats = new[] { info.FileType }, hasTextures = false } } };
            var cached = GetCached();
            if (cached == null) return result;
            var serializer = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
            var catalog = serializer.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(cached.CatalogJson));
            var models = ((System.Collections.IEnumerable)catalog["models"]).Cast<object>();
            var model = models.Cast<Dictionary<string, object>>().FirstOrDefault(m => Equals(m["id"], modelId));
            if (model != null)
            {
                result["name"] = model["name"];
                object domain, primary, aliases;
                if (model.TryGetValue("contentDomain", out domain) && domain != null) result["contentDomain"] = domain;
                model.TryGetValue("categoryId", out primary);
                result["categoryId"] = primary;
                var categoryIds = model.TryGetValue("categoryIds", out aliases) && aliases is System.Collections.IEnumerable && !(aliases is string)
                    ? ((System.Collections.IEnumerable)aliases).Cast<object>().Select(Convert.ToString).Where(id => !string.IsNullOrEmpty(id)).ToList()
                    : new List<string>();
                if (primary != null && !categoryIds.Contains(Convert.ToString(primary))) categoryIds.Insert(0, Convert.ToString(primary));
                result["categoryIds"] = categoryIds.ToArray();
                var categories = serializer.Deserialize<Dictionary<string, object>[]>(Encoding.UTF8.GetString(cached.CategoriesJson));
                var cat = categories.FirstOrDefault(c => Equals(c["id"], primary));
                if (cat != null)
                {
                    result["folderPath"] = cat["fullPath"]; result["subcategory"] = cat["name"];
                    result["category"] = Convert.ToString(cat["fullPath"]).Split(new[] { " / " }, StringSplitOptions.None)[0];
                    var ancestors = new List<string>(); var seen = new HashSet<string>();
                    while (cat != null && seen.Add(Convert.ToString(cat["id"])))
                    {
                        ancestors.Add(Convert.ToString(cat["id"])); object parent; cat.TryGetValue("parentId", out parent);
                        cat = parent == null ? null : categories.FirstOrDefault(c => Equals(c["id"], parent));
                    }
                    result["folderIds"] = ancestors.ToArray();
                }
                // Include every alias and its ancestors so downloaded Scenes retain all placements offline.
                var folders = new HashSet<string>((string[])result["folderIds"]);
                foreach (var categoryId in categoryIds)
                {
                    var placement = categories.FirstOrDefault(c => Equals(c["id"], categoryId));
                    var visited = new HashSet<string>();
                    while (placement != null && visited.Add(Convert.ToString(placement["id"])))
                    {
                        folders.Add(Convert.ToString(placement["id"])); object parent; placement.TryGetValue("parentId", out parent);
                        placement = parent == null ? null : categories.FirstOrDefault(c => Equals(c["id"], parent));
                    }
                }
                result["folderIds"] = folders.ToArray();
            }
            var sm = cached.Previews.FirstOrDefault(p => p.ModelId == modelId && p.Variant == "sm");
            var lg = cached.Previews.FirstOrDefault(p => p.ModelId == modelId && p.Variant == "lg");
            result["thumb"] = (sm ?? lg)?.Url; result["image"] = (lg ?? sm)?.Url;
            return result;
        }

        public static string EntitlementsJson(Entitlements e)
        { return new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "allModels", e.AllModels }, { "modelIds", e.ModelIds } }); }

        public object Status()
        {
            var cached = GetCached();
            var session = Session.Current;
            return new Dictionary<string, object>
            {
                { "mode", "online" }, { "machineCode", MachineCode }, { "offline", Offline },
                { "catalogVersion", cached == null ? (object)null : cached.CatalogVersion },
                { "allModels", Downloads.Allows(deviceBinding) },
                { "modelIds", new string[0] },
            };
        }

        public void Dispose()
        {
            Watcher.Dispose();
            Session.Dispose();
        }
    }
}
