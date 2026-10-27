using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MaxWebViewHost
{
    public class SceneRequestEventArgs : EventArgs
    {
        public string Id { get; set; }
        public string Method { get; set; }
        public string ParamsJson { get; set; }

        internal Dictionary<string, object> Params;

        /// <summary>Lấy 1 param dạng chuỗi, invariant culture. Thiếu param thì trả về null.
        /// Có cái này để MAXScript khỏi phải tự parse JSON.</summary>
        public string Param(string name)
        {
            object v;
            if (Params == null || !Params.TryGetValue(name, out v) || v == null) return null;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }
    }

    public class MaxWebViewForm : Form
    {
        // Phase 4: host nạp website thật qua URL, không còn nạp file HTML cố định.
        // Set từ MAXScript trước khi gọi ShowWindow().
        public static string StartUrl = "https://app.3dsmood.local/";
        public static bool UsePackagedApp = true;

        /// <summary>Danh sách origin được tin, phân tách bằng dấu phẩy (kiểu string thay vì string[]
        /// để MAXScript gán trực tiếp được, không cần dựng .NET array).</summary>
        public static string TrustedOrigins = "https://app.3dsmood.local";

        public static string EnvironmentName = "3DsMood";
        public static string HostVersion = "unknown";

        /// <summary>Method allowlist. Web gọi method ngoài danh sách này thì bị từ chối ngay tại native,
        /// không tới được MAXScript. MAXScript có thể .Add thêm khi implement handler mới.</summary>
        public static readonly List<string> AllowedMethods = new List<string>
        {
            "host.ping", "host.getInfo",
            "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create",
            "asset.import", "device.getIdentity", "device.signChallenge",
            "library.status", "library.activate", "library.refresh"
        };

        /// <summary>Origin của backend 3DS Mood, nơi host tải asset. Phải nằm trong TrustedOrigins.
        /// Web chỉ gửi asset ID + ticket, không bao giờ gửi URL (spec §5.5).</summary>
        public static string ApiBase = "";

        // Bounded streaming download; single-use tickets intentionally do not resume.
        private const long MaxPackageBytes = 2L * 1024 * 1024 * 1024;
        private static readonly string[] ImportExtensions = { ".fbx", ".obj", ".max" };
        private static readonly HttpClient Http = SecureHttpTransport.CreateClient(false, true, TimeSpan.FromMinutes(30));
        private readonly System.Threading.CancellationTokenSource _lifetime = new System.Threading.CancellationTokenSource();

        private static MaxWebViewForm _instance;

        private readonly ImportTargetSelection _targetSelection = new ImportTargetSelection();
        private readonly ComboBox _targetPicker = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, DropDownWidth = 1000 };
        private bool _updatingTargets;
        private Task _targetRefreshTask = Task.CompletedTask;
        private readonly Func<ImportTarget[]> _discoverTargets;
        private readonly Func<ImportTarget, Task<ImportTarget>> _readTarget;
        private readonly Func<GoogleDriveDownloader> _createDownloader;
        private string _targetSignature;
        private readonly Timer _focusTimer = new Timer { Interval = 1000 };
        private readonly Label _target = new Label
        {
            Dock = DockStyle.Left, Width = 95, Text = "Merge vào scene:", TextAlign = System.Drawing.ContentAlignment.MiddleLeft, Padding = new Padding(6, 0, 0, 0)
        };

        // Trang chẩn đoán cũ (frontend/index.html), đóng gói cùng thư mục với DLL.
        // Luôn được tin, để khoanh vùng bridge khi website thật không load được (spec Phase 4.3).
        private static readonly string DiagnosticPagePath = Path.Combine(
            Path.GetDirectoryName(typeof(MaxWebViewForm).Assembly.Location) ?? ".",
            "frontend", "index.html");

        private Uri[] _trustedOrigins;
        private string _diagnosticBaseUri;
        private bool _navigating = true;
        private ulong _allowedNavigationId;
        private readonly Dictionary<string, string> _requestDocuments = new Dictionary<string, string>();
        private readonly DeviceIdentityService _deviceIdentity = new DeviceIdentityService();

        private readonly WebView2 _web = new WebView2 { Dock = DockStyle.Fill };
        private PackagedAppRuntime _packagedApp;
        private OfflineLicenseService _offlineLicense;
        private StaticCatalogService _catalog;
        private readonly Timer _connectionTimer = new Timer { Interval = 15000 };
        private bool _checkingConnection;
        private bool _appLoaded;
        private readonly Panel _connectionPanel = new Panel { Dock = DockStyle.Fill, BackColor = System.Drawing.Color.FromArgb(17, 21, 23) };
        private readonly Label _connectionMessage = new Label { Dock = DockStyle.Fill, ForeColor = System.Drawing.Color.White,
            TextAlign = System.Drawing.ContentAlignment.MiddleCenter, Font = new System.Drawing.Font("Segoe UI", 12), Padding = new Padding(30) };
        private readonly Button _connectionRetry = new Button { Dock = DockStyle.Bottom, Height = 44, Text = "Thử lại kết nối" };
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        private readonly Label _status = new Label
        {
            Dock = DockStyle.Top, Height = 22, TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
            Padding = new Padding(6, 0, 0, 0), BackColor = System.Drawing.Color.Firebrick,
            ForeColor = System.Drawing.Color.White, Visible = false
        };
        private readonly Button _retryButton = new Button { Text = "Thử lại", Dock = DockStyle.Right, Width = 70 };
        private readonly Button _diagButton = new Button { Text = "Trang chẩn đoán", Dock = DockStyle.Right, Width = 110 };

        /// <summary>Mọi method không phải "host.*" được đẩy ra đây cho MAXScript xử lý.</summary>
        public event EventHandler<SceneRequestEventArgs> SceneRequestReceived;

        public MaxWebViewForm() : this(ImportTargetDiscovery.Discover, PlatformAgent.ReadSceneTargetAsync) { }

        internal MaxWebViewForm(Func<ImportTarget[]> discoverTargets, Func<ImportTarget, Task<ImportTarget>> readTarget)
            : this(discoverTargets, readTarget, () => new GoogleDriveDownloader()) { }

        internal MaxWebViewForm(Func<ImportTarget[]> discoverTargets, Func<ImportTarget, Task<ImportTarget>> readTarget,
            Func<GoogleDriveDownloader> createDownloader)
        {
            _discoverTargets = discoverTargets ?? throw new ArgumentNullException(nameof(discoverTargets));
            _readTarget = readTarget ?? throw new ArgumentNullException(nameof(readTarget));
            _createDownloader = createDownloader ?? throw new ArgumentNullException(nameof(createDownloader));
            FormClosed += (sender, args) => _lifetime.Cancel();
            Text = "3ds Max Platform — " + EnvironmentName;
            Width = 1100;
            Height = 800;

            var toolbar = new Panel { Dock = DockStyle.Top, Height = 28 };
            _retryButton.Click += async (s, e) => { if (UsePackagedApp) await LoadPackagedAppAsync(); else Navigate(StartUrl); };
            _diagButton.Click += (s, e) => OpenDiagnosticPage();
            toolbar.Controls.Add(_targetPicker);
            toolbar.Controls.Add(_target);
            toolbar.Controls.Add(_retryButton);
            toolbar.Controls.Add(_diagButton);
            _targetPicker.SelectedIndexChanged += (s, e) =>
            {
                if (!_updatingTargets) _targetSelection.Select(_targetPicker.SelectedItem as ImportTarget);
            };
            _targetPicker.DropDown += (s, e) => RefreshTargets();
            _focusTimer.Tick += (s, e) => RefreshTargets();
            _focusTimer.Start();
            FormClosed += (s, e) => _focusTimer.Dispose();
            Shown += (s, e) => RefreshTargets();

            Controls.Add(_web);
            _connectionPanel.Controls.Add(_connectionMessage);
            _connectionPanel.Controls.Add(_connectionRetry);
            _connectionPanel.Visible = UsePackagedApp;
            _connectionRetry.Click += async (s, e) => await LoadPackagedAppAsync();
            Controls.Add(_connectionPanel);
            Controls.Add(toolbar);
            Controls.Add(_status);
            _connectionTimer.Tick += async (s, e) => await MonitorConnectionAsync();
            FormClosed += (s, e) => { _connectionTimer.Dispose(); _packagedApp?.Dispose(); _catalog?.Dispose(); };
            Load += async (s, e) => await InitAsync();
        }

        private async void RefreshTargets()
        {
            try { await RefreshTargetsAsync(); }
            catch (Exception ex) { Debug.WriteLine("[targets] refresh: " + ex.GetType().Name); }
        }

        internal Task RefreshTargetsAsync()
        {
            if (IsDisposed || Disposing) return Task.CompletedTask;
            var discovered = ObserveTargetProcessPresence();
            // Timer, dropdown and import callers must all await the same pending metadata query.
            if (!_targetRefreshTask.IsCompleted) return _targetRefreshTask;
            return _targetRefreshTask = RefreshTargetsCoreAsync(discovered);
        }

        private ImportTarget[] ObserveTargetProcessPresence()
        {
            var discovered = _discoverTargets();
            var known = _targetSelection.Targets;
            // Process presence is synchronous: a newly opened second Max immediately invalidates
            // implicit single-scene selection, even if an older one-process IPC refresh is pending.
            _targetSelection.Refresh(discovered.Select(process => known.FirstOrDefault(t => t.IsSameProcess(process)) ?? process));
            return discovered;
        }

        internal async Task<ImportTarget> CaptureImportTargetAsync()
        {
            try
            {
                await RefreshTargetsAsync();
                if (IsDisposed || Disposing) return null;
                ObserveTargetProcessPresence();
                return _targetSelection.Current;
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[targets] snapshot: " + ex.GetType().Name);
                _targetSelection.Select(null);
                return null;
            }
        }

        private async Task RefreshTargetsCoreAsync(ImportTarget[] discovered)
        {
            try
            {
                var resolved = await Task.WhenAll(discovered.Select(ReadAvailableTargetAsync));
                if (IsDisposed || Disposing) return;
                _targetSelection.Refresh(resolved);
                var targets = _targetSelection.Targets;
                var current = _targetSelection.Current;
                var signature = string.Join("|", targets.Select(t => t.ToString() + ":" + t.StartedTicks + ":" + t.DocumentToken))
                    + "#" + (current == null ? "none" : current.ProcessId.ToString()) + _targetSelection.SelectedUnavailable;
                if (_targetSignature == signature || _targetPicker.DroppedDown) return;
                _targetSignature = signature;
                _updatingTargets = true;
                try
                {
                    _targetPicker.Items.Clear();
                    _targetPicker.Items.Add(_targetSelection.SelectedUnavailable ? "Scene đã chọn đã đóng hoặc đổi file — chọn lại" : "Chọn scene 3ds Max để merge…");
                    foreach (var target in targets) _targetPicker.Items.Add(target);
                    _targetPicker.SelectedIndex = current == null ? 0 : Array.FindIndex(targets, t => t.IsSameProcess(current)) + 1;
                }
                finally { _updatingTargets = false; }
            }
            catch (Exception ex) { Debug.WriteLine("[targets] discovery: " + ex.GetType().Name); }
        }

        private async Task<ImportTarget> ReadAvailableTargetAsync(ImportTarget target)
        {
            try { return await _readTarget(target).ConfigureAwait(false); }
            catch (Exception ex) { Debug.WriteLine("[targets] agent unavailable: " + ex.GetType().Name); return target; }
        }

        private async Task InitAsync()
        {
            PluginConfiguration configuration = null;
            if (UsePackagedApp)
            {
                try
                {
                    configuration = PluginConfiguration.Load(Path.GetDirectoryName(typeof(MaxWebViewForm).Assembly.Location));
                    StartUrl = PackagedAppRuntime.StartUrl;
                    if (configuration.IsOfflineLibrary)
                    {
                        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaxWebViewHost", "OfflineLibrary");
                        _offlineLicense = new OfflineLicenseService(configuration.LicensePublicKeyXml, Path.Combine(data, "License"));
                        _catalog = new StaticCatalogService(configuration.LibraryDirectory);
                    }
                    else ApiBase = configuration.ApiBaseUri.AbsoluteUri.TrimEnd('/');
                    TrustedOrigins = PackagedAppRuntime.AppOrigin;
                    _diagButton.Visible = false;
                }
                catch (Exception)
                {
                    SetConnectionMessage("Bộ cài thiếu cấu hình catalog, khóa công khai hoặc giao diện. Liên hệ nhà cung cấp để nhận bộ cài đầy đủ.");
                    _connectionRetry.Enabled = false;
                    return;
                }
            }
            _trustedOrigins = (TrustedOrigins ?? "")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(o => { Uri u; return Uri.TryCreate(o.Trim(), UriKind.Absolute, out u) ? u : null; })
                .Where(u => u != null)
                .ToArray();

            if (File.Exists(DiagnosticPagePath))
                _diagnosticBaseUri = new Uri(Path.GetFullPath(DiagnosticPagePath)).AbsoluteUri;

            try
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MaxWebViewHost", "WebView2UserData");
                Directory.CreateDirectory(userData);

                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await _web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this,
                    "Không khởi tạo được WebView2 Runtime.\r\n\r\n" + ex.Message,
                    "MaxWebViewHost", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            _web.CoreWebView2.WebMessageReceived += OnWebMessage;

            // Điều hướng: chỉ origin trong allowlist (hoặc trang chẩn đoán cục bộ) được hiển thị
            // và có bridge privilege. Link ra ngoài (OAuth, target=_blank...) mở ở browser hệ thống,
            // không load bên trong panel Max (spec Phase 4.2).
            _web.CoreWebView2.NavigationStarting += (s, e) =>
            {
                if (IsTrusted(e.Uri))
                {
                    _navigating = true;
                    _allowedNavigationId = e.NavigationId;
                    _requestDocuments.Clear();
                    return;
                }
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            _web.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            _web.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                // A cancelled external navigation must not disable the still-active trusted page.
                if (e.NavigationId != _allowedNavigationId) return;
                _navigating = !e.IsSuccess || !IsTrusted(_web.CoreWebView2.Source);
                ShowStatus(e.IsSuccess ? null : StartUrl);
            };

            if (UsePackagedApp)
            {
                try
                {
                    _packagedApp = new PackagedAppRuntime(configuration, _web.CoreWebView2);
                    if (_catalog != null) _packagedApp.PreviewLoader = _catalog.GetPreviewAsync;
                    await _packagedApp.ConfigureAsync();
                    await LoadPackagedAppAsync();
                    if (!IsDisposed && !configuration.IsOfflineLibrary) _connectionTimer.Start();
                }
                catch (Exception) { if (!IsDisposed) SetConnectionMessage("Không mở được dữ liệu của ứng dụng. Vui lòng mở lại 3ds Max rồi thử lại."); }
            }
            else Navigate(StartUrl);
        }

        private void SetConnectionMessage(string message)
        {
            _connectionMessage.Text = message;
            _connectionPanel.Visible = true;
            _connectionPanel.BringToFront();
            _web.Visible = false;
        }

        private async Task LoadPackagedAppAsync()
        {
            if (_packagedApp == null || IsDisposed) return;
            _connectionRetry.Enabled = false;
            SetConnectionMessage("Đang kết nối máy chủ 3DsMood…");
            try
            {
                var connected = await _packagedApp.CheckConnectionAsync(_lifetime.Token);
                if (IsDisposed || Disposing) return;
                if (!connected)
                {
                    SetConnectionMessage("Không thể kết nối máy chủ 3DsMood. Vui lòng kết nối Internet rồi bấm Thử lại kết nối.");
                    return;
                }
                if (IsDisposed) return;
                _connectionPanel.Visible = false;
                _web.Visible = true;
                if (!_appLoaded) { _appLoaded = true; Navigate(StartUrl); }
            }
            catch (OperationCanceledException) { }
            catch (Exception) { if (!IsDisposed) SetConnectionMessage("Không thể kết nối máy chủ 3DsMood. Vui lòng kiểm tra Internet rồi thử lại."); }
            finally { if (!IsDisposed) _connectionRetry.Enabled = true; }
        }

        private async Task MonitorConnectionAsync()
        {
            if (_checkingConnection || _packagedApp == null || IsDisposed) return;
            _checkingConnection = true;
            try
            {
                var connected = await _packagedApp.CheckConnectionAsync(_lifetime.Token);
                if (IsDisposed) return;
                if (!connected) SetConnectionMessage("Mất kết nối máy chủ 3DsMood. Vui lòng kết nối Internet rồi thử lại.");
                else if (_connectionPanel.Visible) await LoadPackagedAppAsync();
            }
            catch (Exception) { /* The next bounded connection check retries after panel or network changes. */ }
            finally { _checkingConnection = false; }
        }

        private void Navigate(string url)
        {
            if (_web.CoreWebView2 == null || !IsTrusted(url)) return;
            ShowStatus(null);
            _web.CoreWebView2.Navigate(url);
        }

        private void OpenDiagnosticPage()
        {
            if (!File.Exists(DiagnosticPagePath))
            {
                MessageBox.Show(this, "Không thấy trang chẩn đoán: " + DiagnosticPagePath,
                    "MaxWebViewHost", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Navigate(new Uri(DiagnosticPagePath).AbsoluteUri);
        }

        private static void OpenExternal(string uri)
        {
            if (!BridgePolicy.CanOpenExternal(uri)) return;
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
            catch { /* URL bất thường từ web input untrusted — bỏ qua, không crash host */ }
        }

        private void ShowStatus(string failedUrl)
        {
            _status.Visible = failedUrl != null;
            if (failedUrl != null)
                _status.Text = "Không tải được " + failedUrl + " — kiểm tra server rồi bấm Thử lại.";
        }

        /// <summary>True nếu uri khớp đúng scheme+host+port với một origin trong allowlist,
        /// hoặc nằm trong thư mục trang chẩn đoán cục bộ. Không suy diễn theo prefix chuỗi (spec Phase 4.2).</summary>
        private bool IsTrusted(string uri)
        {
            return BridgePolicy.IsTrusted(uri, _trustedOrigins, _diagnosticBaseUri);
        }

        private async void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (_navigating || !IsTrusted(e.Source) || !IsTrusted(_web.CoreWebView2.Source)
                || !BridgePolicy.SameDocument(e.Source, _web.CoreWebView2.Source)) return;

            Dictionary<string, object> msg;
            string code;
            try
            {
                if (!BridgePolicy.TryParse(e.WebMessageAsJson, out msg, out code))
                {
                    var responseId = BridgePolicy.ResponseId(msg);
                    if (responseId != null && !_requestDocuments.ContainsKey(responseId) && _requestDocuments.Count < 100)
                    {
                        _requestDocuments.Add(responseId, e.Source);
                        PostError(responseId, code, "Bridge request không hợp lệ hoặc không được hỗ trợ.");
                    }
                    return;
                }
            }
            catch
            {
                return; // web input là untrusted: JSON hỏng thì bỏ qua
            }
            if (msg == null) return;

            object idObj, methodObj, paramsObj;
            msg.TryGetValue("id", out idObj);
            msg.TryGetValue("method", out methodObj);
            msg.TryGetValue("params", out paramsObj);

            var id = idObj as string;
            var method = methodObj as string;
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(method)) return;
            if (_requestDocuments.ContainsKey(id) || _requestDocuments.Count >= 100) return;
            _requestDocuments.Add(id, e.Source);

            if (!AllowedMethods.Contains(method))
            {
                PostError(id, "UNKNOWN_METHOD", "Method not allowed: " + method);
                return;
            }

            if (method.StartsWith("host.", StringComparison.Ordinal))
            {
                HandleHostMethod(id, method);
                return;
            }

            if (method.StartsWith("library.", StringComparison.Ordinal))
            {
                _ = HandleLibraryMethodAsync(id, method, (Dictionary<string, object>)paramsObj);
                return;
            }
            if (method.StartsWith("device.", StringComparison.Ordinal))
            {
                var parameters = (Dictionary<string, object>)paramsObj;
                _ = RunDeviceOperation(() => HandleDeviceMethod(id, method, parameters));
                return;
            }

            if (method == "asset.import")
            {
                var target = await CaptureImportTargetAsync();
                if (IsDisposed || Disposing || !_requestDocuments.ContainsKey(id)) return;
                if (target == null)
                {
                    PostError(id, _targetSelection.SelectedUnavailable ? "TARGET_UNAVAILABLE" : "TARGET_SELECTION_REQUIRED",
                        "Chọn scene 3ds Max ở thanh Merge vào scene, rồi bấm Download lại.");
                    _targetPicker.Focus();
                    _targetPicker.DroppedDown = true;
                    return;
                }
                var p = paramsObj as Dictionary<string, object> ?? new Dictionary<string, object>();
                _ = Task.Run(() => ImportAssetAsync(id, p, target));
                return;
            }

            Dispatch(id, method, paramsObj as Dictionary<string, object>);
        }

        private async Task HandleLibraryMethodAsync(string id, string method, Dictionary<string, object> parameters)
        {
            try
            {
                if (_offlineLicense == null || _catalog == null)
                { PostError(id, "LIBRARY_NOT_CONFIGURED", "Cài bộ plugin thư viện offline để sử dụng chức năng này."); return; }
                if (method == "library.refresh")
                    PostResponse(id, true, await _catalog.RefreshAsync(_lifetime.Token), null);
                else if (method == "library.activate")
                    await RunDeviceOperation(() => PostResponse(id, true, _offlineLicense.Activate((string)parameters["license"]), null));
                else await RunDeviceOperation(() => PostResponse(id, true, _offlineLicense.GetStatus(), null));
            }
            catch (InvalidDataException error) { PostError(id, "LIBRARY_INVALID", error.Message); }
            catch (OperationCanceledException) { PostError(id, "LIBRARY_CANCELLED", "Đã hủy thao tác thư viện. Vui lòng thử lại."); }
            catch (Exception error)
            {
                Debug.WriteLine("[library] " + error);
                PostError(id, "LIBRARY_UNAVAILABLE", "Không đọc hoặc lưu được thư viện. Kiểm tra quyền ghi dữ liệu và thử lại.");
            }
        }
        private void HandleDeviceMethod(string id, string method, Dictionary<string, object> parameters)
        {
            try
            {
                if (method == "device.getIdentity") PostResponse(id, true, _deviceIdentity.GetIdentity(), null);
                else if (method == "device.signChallenge")
                    PostResponse(id, true, new { signature = _deviceIdentity.SignChallenge(
                        (string)parameters["challengeId"], (string)parameters["message"]) }, null);
            }
            catch (DeviceIdentityException ex) { PostError(id, ex.Code, ex.Message); }
            catch (Exception) { PostError(id, "DEVICE_IDENTITY_UNAVAILABLE", "Không truy cập được khóa thiết bị an toàn trên Windows."); }
        }

        internal static Task RunDeviceOperation(Action operation)
        {
            if (operation == null) throw new ArgumentNullException(nameof(operation));
            if (System.Threading.ExecutionContext.IsFlowSuppressed()) return Task.Run(operation);
            using (System.Threading.ExecutionContext.SuppressFlow()) return Task.Run(operation);
        }

        private void Dispatch(string id, string method, Dictionary<string, object> p)
        {
            var handler = SceneRequestReceived;
            if (handler == null)
            {
                PostError(id, "HOST_NOT_READY", "No handler subscribed for " + method);
                return;
            }
            handler(this, new SceneRequestEventArgs
            {
                Id = id,
                Method = method,
                ParamsJson = _json.Serialize((object)p ?? new Dictionary<string, object>()),
                Params = p
            });
        }

        // ---------- asset.import: tải -> giải nén an toàn -> import trên main thread ----------

        private async Task ImportAssetAsync(string id, Dictionary<string, object> p, ImportTarget selectedTarget)
        {
            string workDir = null;
            bool retainContent = false;
            using (var cancellation = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token))
            {
            cancellation.CancelAfter(TimeSpan.FromMinutes(30));
            var token = cancellation.Token;
            try
            {
                if (_offlineLicense == null || _catalog == null)
                { PostError(id, "LIBRARY_NOT_CONFIGURED", "Bộ cài chưa cấu hình thư viện offline."); return; }
                try { _offlineLicense.EnsureLicensed(); }
                catch (InvalidDataException error) { PostError(id, "LICENSE_REQUIRED", error.Message); return; }
                var assetId = (string)p["assetId"];
                var model = _catalog.Find(assetId);
                if (!await ValidateSelectedTargetAsync(id, selectedTarget).ConfigureAwait(false)) return;
                // A catalog ID is not necessarily a valid Windows directory name (e.g. CON).
                // Use an independently generated directory under the agent's trusted cache root.
                workDir = Path.Combine(PlatformAgent.CacheRoot, Guid.NewGuid().ToString("N"));
                var extractDir = Path.Combine(workDir, "content");
                Directory.CreateDirectory(extractDir);
                var pkg = Path.Combine(workDir, "package.bin");
                try
                {
                    var progressClock = Stopwatch.StartNew();
                    long lastReceived = 0;
                    long? lastTotal = null;
                    using (var downloader = _createDownloader())
                        await downloader.DownloadAsync(model, pkg, token, (received, total) => {
                            lastReceived = received; lastTotal = total;
                            if (progressClock.ElapsedMilliseconds < 200) return;
                            progressClock.Restart();
                            PostProgress(id, received, total);
                        }).ConfigureAwait(false);
                    PostProgress(id, lastReceived, lastTotal);
                }
                catch (Exception error) when (error is InvalidDataException || error is IOException || error is HttpRequestException || error is OperationCanceledException)
                {
                    Debug.WriteLine("[asset.download] " + error);
                    PostError(id, "ASSET_DOWNLOAD_FAILED", error is InvalidDataException ? error.Message : "Không tải được model từ Google Drive. Kiểm tra Internet, quyền chia sẻ hoặc thử lại sau.");
                    return;
                }
                string[] files;
                if (ImportExtensions.Contains(Path.GetExtension(model.fileName).ToLowerInvariant()))
                {
                    var direct = Path.Combine(extractDir, model.fileName);
                    File.Move(pkg, direct);
                    files = new[] { direct };
                }
                else files = ArchivePackage.Extract(pkg, extractDir, token, null).ToArray();

                string entry = null;
                if (!string.IsNullOrEmpty(model.entryFile))
                {
                    var specified = Path.GetFullPath(Path.Combine(extractDir, model.entryFile.Replace('/', Path.DirectorySeparatorChar)));
                    entry = files.FirstOrDefault(f => string.Equals(f, specified, StringComparison.OrdinalIgnoreCase));
                    if (entry == null) { PostError(id, "ASSET_ENTRY_MISSING", "File import khai báo trong catalog không có trong gói model."); return; }
                }
                else foreach (var ext in ImportExtensions)
                {
                    entry = files.Where(f => f.EndsWith(ext, StringComparison.OrdinalIgnoreCase)).OrderBy(f => f.Length).FirstOrDefault();
                    if (entry != null) break;
                }
                if (entry == null) { PostError(id, "ASSET_NO_IMPORTABLE_FILE", "Gói không có file .fbx/.obj/.max"); return; }
                _offlineLicense.EnsureLicensed();
                // 4) giao cho adapter (MAXScript) chạy trên UI thread. Method này KHÔNG nằm trong allowlist
                //    nên web không gọi trực tiếp được; đường dẫn do host tự tính.
                token.ThrowIfCancellationRequested();
                if (!await ValidateSelectedTargetAsync(id, selectedTarget).ConfigureAwait(false)) return;
                var target = selectedTarget.ProcessId;
                if (target == Process.GetCurrentProcess().Id)
                {
                    var args = new Dictionary<string, object> { { "path", entry }, { "assetId", assetId },
                        { "expectedScenePath", selectedTarget.ScenePath }, { "expectedDocumentToken", selectedTarget.DocumentToken } };
                    retainContent = true; // scene textures may refer to this owned cache directory.
                    BeginInvoke(new Action(() => Dispatch(id, "asset.importFile", args)));
                    return;
                }

                // Max đích là process khác: chuyển lệnh qua pipe. Không import nhầm sang scene khác khi đích không với tới được.
                string replyJson;
                // A lost reply does not prove that the target failed to merge. Preserve
                // the files from the moment the command can reach another Max scene.
                retainContent = true;
                try { replyJson = await PlatformAgent.SendImportAsync(target, id, entry, selectedTarget.StartedTicks, selectedTarget.ScenePath, selectedTarget.DocumentToken).ConfigureAwait(false); }
                catch (Exception ex)
                {
                    Debug.WriteLine("[asset.import] pipe: " + ex);
                    PostError(id, "TARGET_UNAVAILABLE", "Không kết nối được Max đích (" + ex.GetType().Name + "): đã đóng, chưa có agent, hoặc chạy khác quyền");
                    return;
                }
                var reply = _json.Deserialize<Dictionary<string, object>>(replyJson);
                object ok, res, er;
                reply.TryGetValue("ok", out ok);
                reply.TryGetValue("result", out res);
                reply.TryGetValue("error", out er);
                PostResponse(id, ok is bool && (bool)ok, res, er);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[asset.import] " + ex);
                if (IsArchiveDependencyFailure(ex))
                    PostError(id, "ARCHIVE_DEPENDENCY_MISSING", "Plugin thiếu thư viện giải nén. Cài lại gói plugin đầy đủ rồi khởi động lại 3ds Max.");
                else PostError(id, "ASSET_IMPORT_FAILED", ex is InvalidDataException ? ex.Message : "Import thất bại. Kiểm tra gói model và scene đã chọn.");
            }
            finally
            {
                if (workDir != null)
                {
                    try {
                        var package = Path.Combine(workDir, "package.bin");
                        if (File.Exists(package)) File.Delete(package);
                        // workDir is a fresh GUID under a validated asset ID; never delete a scene's retained textures.
                        if (!retainContent && Directory.Exists(workDir)) Directory.Delete(workDir, true);
                    } catch (IOException) { Debug.WriteLine("[asset.import] cleanup deferred"); }
                }
            }
            }
        }

        internal static bool IsArchiveDependencyFailure(Exception error)
        {
            if (error == null) return false;
            var missing = error as FileNotFoundException;
            var unloadable = error as FileLoadException;
            var name = missing != null ? missing.FileName : unloadable != null ? unloadable.FileName : null;
            return name != null && (name.IndexOf(", Version=", StringComparison.OrdinalIgnoreCase) >= 0
                || name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) || IsArchiveDependencyFailure(error.InnerException);
        }

        private async Task<bool> ValidateSelectedTargetAsync(string id, ImportTarget selected)
        {
            try
            {
                var current = await _readTarget(selected).ConfigureAwait(false);
                if (selected.IsSameScene(current)) return true;
                PostError(id, "TARGET_SCENE_CHANGED", "Scene đã chọn đã đóng hoặc đổi file. Chọn scene và thử lại.");
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[targets] validation: " + ex.GetType().Name);
                PostError(id, "TARGET_UNAVAILABLE", "Không đọc được scene đã chọn. Mở lại 3ds Max với plugin mới rồi chọn scene và thử lại.");
            }
            return false;
        }

        private void PostProgress(string id, long receivedBytes, long? totalBytes)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired) { BeginInvoke(new Action(() => PostProgress(id, receivedBytes, totalBytes))); return; }
            string document;
            if (_web.CoreWebView2 == null || _navigating || !_requestDocuments.TryGetValue(id, out document)
                || !IsTrusted(_web.CoreWebView2.Source) || !BridgePolicy.SameDocument(document, _web.CoreWebView2.Source)) return;
            _web.CoreWebView2.PostWebMessageAsJson(_json.Serialize(new { id, type = "asset.progress", receivedBytes, totalBytes }));
        }

        private void HandleHostMethod(string id, string method)
        {
            switch (method)
            {
                case "host.ping":
                    PostResponse(id, true, new Dictionary<string, object>
                    {
                        { "pong", true },
                        { "time", DateTime.UtcNow.ToString("o") }
                    }, null);
                    break;

                case "host.getInfo":
                    string webviewVersion;
                    try { webviewVersion = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                    catch (Exception ex) { webviewVersion = "unavailable: " + ex.Message; }

                    PostResponse(id, true, new Dictionary<string, object>
                    {
                        { "host", "3dsmax" },
                        { "hostVersion", HostVersion },
                        { "plugin", "MaxWebViewHost" },
                        { "pluginVersion", GetType().Assembly.GetName().Version.ToString() },
                        { "webview2Version", webviewVersion },
                        { "protocolVersion", 1 }
                    }, null);
                    break;

                default:
                    PostError(id, "UNKNOWN_METHOD", "Unknown method: " + method);
                    break;
            }
        }

        /// <summary>Trả response về JS. result/error là object bất kỳ, sẽ được serialize thành JSON.</summary>
        public void PostResponse(string id, bool ok, object result, object error)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => PostResponse(id, ok, result, error)));
                return;
            }
            if (ok) PostRaw(id, true, "result", _json.Serialize(result ?? new Dictionary<string, object>()));
            else PostRaw(id, false, "error", _json.Serialize(error ?? MakeError("MAX_OPERATION_FAILED", "Unspecified error")));
        }

        /// <summary>Dành cho MAXScript: truyền thẳng chuỗi JSON làm result, khỏi phải dựng .NET Dictionary.</summary>
        public void PostResultJson(string id, string resultJson)
        {
            PostRaw(id, true, "result", string.IsNullOrEmpty(resultJson) ? "{}" : resultJson);
        }

        /// <summary>Dành cho MAXScript: trả lỗi theo error model trong spec.</summary>
        public void PostError(string id, string code, string message)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => PostError(id, code, message)));
                return;
            }
            PostRaw(id, false, "error", _json.Serialize(MakeError(code, message)));
        }

        private static Dictionary<string, object> MakeError(string code, string message)
        {
            return new Dictionary<string, object> { { "code", code }, { "message", message } };
        }

        private void PostRaw(string id, bool ok, string payloadKey, string payloadJson)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => PostRaw(id, ok, payloadKey, payloadJson)));
                return;
            }
            string document;
            if (_web.CoreWebView2 == null || _navigating || !_requestDocuments.TryGetValue(id, out document)) return;
            _requestDocuments.Remove(id);
            if (!IsTrusted(_web.CoreWebView2.Source) || !BridgePolicy.SameDocument(document, _web.CoreWebView2.Source)) return;

            var envelope = "{\"id\":" + _json.Serialize(id)
                         + ",\"ok\":" + (ok ? "true" : "false")
                         + ",\"" + payloadKey + "\":" + payloadJson + "}";
            _web.CoreWebView2.PostWebMessageAsJson(envelope);
        }

        /// <summary>Singleton: mở form, hoặc đưa form đang mở lên trước. Trả về instance để MAXScript subscribe event.</summary>
        public static MaxWebViewForm ShowWindow()
        {
            if (_instance == null || _instance.IsDisposed)
            {
                _instance = new MaxWebViewForm();
                _instance.FormClosed += (s, e) => _instance = null;
            }
            _instance.Show();
            if (_instance.WindowState == FormWindowState.Minimized)
                _instance.WindowState = FormWindowState.Normal;
            _instance.Activate();
            return _instance;
        }
    }
}
