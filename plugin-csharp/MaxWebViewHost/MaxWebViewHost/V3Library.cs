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
        public bool Offline { get; private set; }

        /// <summary>Events for the web UI (library.updated, library.offline, library.previewProgress). Raised on a worker thread.</summary>
        public event Action<string, object> HostEvent;

        private V3Library() { }

        /// <param name="dataRoot">%LOCALAPPDATA%\3dMood — Catalog\ and Previews\ live below it.</param>
        /// <param name="legacyLicensePath">license.txt of the old offline plugin; its MXL1 token is offered to the server once per session.</param>
        public static V3Library Create(PluginConfiguration configuration, IDeviceSigner signer, string machineCode, string dataRoot, string legacyLicensePath)
        {
            if (configuration == null || configuration.ApiBaseUri == null || signer == null) throw new ArgumentNullException();
            var library = new V3Library { MachineCode = machineCode };
            var apiClient = SecureHttpTransport.CreateClient(false, false, TimeSpan.FromSeconds(20));
            var bulkClient = SecureHttpTransport.CreateClient(false, false, TimeSpan.FromMinutes(30)); // the server fills its copy before the first byte
            var downloadApi = new BackendApi(configuration.ApiBaseUri, bulkClient);
            var api = new BackendApi(configuration.ApiBaseUri, apiClient);
            library.Session = new DeviceSessionService(configuration.ApiBaseUri, signer, machineCode, () => ReadLegacyLicense(legacyLicensePath),
                SecureHttpTransport.CreateClient(false, false, TimeSpan.FromSeconds(20)), () => DateTime.UtcNow);
            library.Catalog = new CatalogCacheService(Path.Combine(dataRoot, "Catalog"), api);
            library.Previews = new PreviewCacheService(Path.Combine(dataRoot, "Previews"), configuration.SeedDirectory, api);
            library.Watcher = new CatalogUpdateWatcher(library.Catalog, library.Previews, api, TimeSpan.FromMinutes(5));
            library.Downloader = new BackendModelDownloader(downloadApi, library.Session);
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

        /// <summary>First run: copy the installer's seed before the UI asks for images, so the grid is never empty on a slow network.</summary>
        public void Start()
        {
            try { Previews.SeedFromInstall(); } catch (Exception e) { System.Diagnostics.Debug.WriteLine("[v3] seed failed: " + e.GetType().Name); }
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
                try { await Watcher.CheckNowAsync(deadline.Token).ConfigureAwait(false); }
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
            // Always ask the server (rights can change within the 15-minute token life: a purchase, an admin grant or revoke);
            // only when it cannot be reached fall back to what the last verify returned.
            try { return await Session.RefreshEntitlementsAsync(ct).ConfigureAwait(false); }
            catch (ApiException e) when (e.Code == "SERVER_UNAVAILABLE" && Session.Current != null) { return Session.Current.Entitlements; }
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
                { "allModels", session != null && session.Entitlements.AllModels },
                { "modelIds", session == null ? new string[0] : session.Entitlements.ModelIds },
            };
        }

        // Old offline plugin stored the owner-signed token here; it is read, never modified, and only offered to the server.
        internal static string ReadLegacyLicense(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path) || new FileInfo(path).Length > 16384) return null;
                var token = File.ReadAllText(path, Encoding.UTF8).Trim();
                return token.StartsWith("MXL1.", StringComparison.Ordinal) && token.Length <= 8192 && !token.Any(char.IsControl) ? token : null;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { return null; }
        }

        public void Dispose()
        {
            Watcher.Dispose();
            Session.Dispose();
        }
    }
}
