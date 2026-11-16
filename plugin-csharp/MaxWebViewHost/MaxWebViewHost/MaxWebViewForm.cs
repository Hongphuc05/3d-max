using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
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

        public static string EnvironmentName = "3dsmood";
        public static string HostVersion = "unknown";

        private bool _updating;
        private string _updateVersion;

        /// <summary>Method allowlist. Web gọi method ngoài danh sách này thì bị từ chối ngay tại native,
        /// không tới được MAXScript. MAXScript có thể .Add thêm khi implement handler mới.</summary>
        public static readonly List<string> AllowedMethods = new List<string>
        {
            "host.ping", "host.getInfo", "host.checkUpdate", "host.applyUpdate", "host.listTargets", "host.selectTarget", "host.focusMax",
            "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create",
            "asset.download", "asset.import", "device.getIdentity", "device.signChallenge",
            "library.status", "library.refresh", "library.downloads", "library.importOptions", "library.settings", "library.chooseDownloadDirectory",
            "library.favorites", "library.setFavorite", "library.setFavoriteFolder", "library.createFavoriteFolder", "library.renameFavoriteFolder", "library.deleteFavoriteFolder", "library.beginDrag"
        };

        /// <summary>Origin của backend 3dsmood, nơi host tải asset. Phải nằm trong TrustedOrigins.
        /// Web chỉ gửi asset ID + ticket, không bao giờ gửi URL (spec §5.5).</summary>
        public static string ApiBase = "";

        // Bounded streaming download; single-use tickets intentionally do not resume.
        private const long MaxPackageBytes = 2L * 1024 * 1024 * 1024;
        private static readonly string[] ImportExtensions = { ".fbx", ".obj", ".max" };
        private static readonly HttpClient Http = SecureHttpTransport.CreateClient(false, true, TimeSpan.FromMinutes(30));
        private readonly System.Threading.CancellationTokenSource _lifetime = new System.Threading.CancellationTokenSource();

        private static MaxWebViewForm _instance;

        private readonly ImportTargetSelection _targetSelection = new ImportTargetSelection();
        private readonly ImportTarget _ownerProcess;
        private Task _targetRefreshTask = Task.CompletedTask;
        private readonly Func<ImportTarget[]> _discoverTargets;
        private readonly Func<ImportTarget, Task<ImportTarget>> _readTarget;
        private readonly Timer _focusTimer = new Timer { Interval = 1000 };
        private Uri[] _trustedOrigins;
        private bool _navigating = true;
        private ulong _allowedNavigationId;
        private readonly Dictionary<string, string> _requestDocuments = new Dictionary<string, string>();
        private readonly DeviceIdentityService _deviceIdentity = new DeviceIdentityService();

        private readonly WebView2 _web = new WebView2 { Dock = DockStyle.Fill };
        private PackagedAppRuntime _packagedApp;
        private V3Library _v3; // device session + local catalog/preview caches + backend downloads
        private readonly Timer _connectionTimer = new Timer { Interval = 15000 };
        private bool _checkingConnection;
        private bool _appLoaded;
        private readonly Panel _connectionPanel = new Panel { Dock = DockStyle.Fill, BackColor = System.Drawing.Color.FromArgb(12, 12, 12) };
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

        /// <summary>Mọi method không phải "host.*" được đẩy ra đây cho MAXScript xử lý.</summary>
        public event EventHandler<SceneRequestEventArgs> SceneRequestReceived;

        public MaxWebViewForm() : this(ImportTargetDiscovery.Discover, PlatformAgent.ReadSceneTargetAsync) { }

        internal MaxWebViewForm(Func<ImportTarget[]> discoverTargets, Func<ImportTarget, Task<ImportTarget>> readTarget, ImportTarget ownerProcess = null)
        {
            _discoverTargets = discoverTargets ?? throw new ArgumentNullException(nameof(discoverTargets));
            _readTarget = readTarget ?? throw new ArgumentNullException(nameof(readTarget));
            FormClosed += (sender, args) => _lifetime.Cancel();
            _ownerProcess = ownerProcess ?? CurrentOwnerProcess();
            LoadWindowIcon();
            UpdateOwnerDisplay(null);
            Width = 1100;
            Height = 800;

            // Nobody is choosing a window while the panel is minimized or hidden, so skip the scan then.
            _focusTimer.Tick += (s, e) => { if (Visible && WindowState != FormWindowState.Minimized) RefreshTargets(); };
            _focusTimer.Start();
            FormClosed += (s, e) => _focusTimer.Dispose();
            Shown += (s, e) => RefreshTargets();

            Controls.Add(_web);
            _connectionPanel.Controls.Add(_connectionMessage);
            _connectionPanel.Controls.Add(_connectionRetry);
            _connectionPanel.Visible = UsePackagedApp;
            _connectionRetry.Click += async (s, e) => await LoadPackagedAppAsync();
            Controls.Add(_connectionPanel);
            Controls.Add(_status);
            _connectionTimer.Tick += async (s, e) => await MonitorConnectionAsync();
            FormClosed += (s, e) => { _connectionTimer.Dispose(); _packagedApp?.Dispose(); _v3?.Dispose(); };
            Load += async (s, e) => await InitAsync();
        }

        // Brand icon embedded in the DLL (Resources/3dsmood.ico). Builds that compile the sources without the resource (tests) keep the default icon.
        private void LoadWindowIcon()
        {
            try
            {
                using (var stream = typeof(MaxWebViewForm).Assembly.GetManifestResourceStream("MaxWebViewHost.Resources.3dsmood.ico"))
                    if (stream != null) Icon = new Icon(stream);
            }
            catch (Exception e) when (e is ArgumentException || e is IOException) { Debug.WriteLine("[icon] " + e.GetType().Name); }
        }

        // Own taskbar button (icon M) instead of being grouped under 3dsmax.exe; set before the window is first shown.
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (!TaskbarIdentity.Apply(Handle, TaskbarIdentity.PanelId)) Debug.WriteLine("[taskbar] AppUserModelID not set; panel stays grouped with Max");
        }

        private static ImportTarget CurrentOwnerProcess()
        {
            using (var process = Process.GetCurrentProcess())
                return new ImportTarget(process.Id, process.StartTime.ToUniversalTime().Ticks, process.MainWindowTitle);
        }

        private void UpdateOwnerDisplay(ImportTarget current)
        {
            Text = current == null ? "3dsmood | Chọn cửa sổ 3ds Max" : "3dsmood | "
                + (string.IsNullOrEmpty(current.ScenePath) ? "Untitled" : Path.GetFileName(current.ScenePath))
                + " | Max PID " + current.ProcessId;
            // Push only when what the web list shows actually changed; the 1 s poll must not spam events.
            var signature = PickerSignature(current, _targetSelection.Targets);
            if (signature == _pickerSignature) return;
            _pickerSignature = signature;
            PostHostEvent("host.targetsChanged", TargetsSnapshot());
        }

        /// <summary>Opaque stable id of one Max scene: process + start time + document token.</summary>
        internal static string TargetId(ImportTarget target)
        {
            return target.ProcessId.ToString(CultureInfo.InvariantCulture) + ":" + target.StartedTicks.ToString(CultureInfo.InvariantCulture) + ":" + target.DocumentToken;
        }

        /// <summary>Shape shared by host.listTargets, host.selectTarget and the host.targetsChanged event.</summary>
        internal Dictionary<string, object> TargetsSnapshot()
        {
            var current = _targetSelection.Current;
            return new Dictionary<string, object>
            {
                { "targets", _targetSelection.Targets.Select(t => new Dictionary<string, object>
                    {
                        { "id", TargetId(t) },
                        { "label", t.DisplayName + (t.IsReady ? "" : " · chưa sẵn sàng") },
                        { "pid", t.ProcessId }
                    }).ToArray() },
                { "currentId", current == null ? null : TargetId(current) },
                { "focusEnabled", current != null }
            };
        }

        /// <summary>Same as choosing an entry in the old native picker; false for an unknown id.</summary>
        internal bool SelectTargetById(string id)
        {
            var target = _targetSelection.Targets.FirstOrDefault(t => TargetId(t) == id);
            if (target == null) return false;
            _targetSelection.Select(target);
            UpdateOwnerDisplay(_targetSelection.Current);
            return true;
        }

        private string _pickerSignature;

        // Everything the selector displays or later hands back on selection (name, readiness, document) plus the selected scene.
        private string PickerSignature(ImportTarget current, ImportTarget[] targets)
        {
            var text = new StringBuilder(_targetSelection.SelectedUnavailable ? "u|" : "n|");
            if (current != null) text.Append(current.ProcessId).Append(':').Append(current.StartedTicks).Append(':').Append(current.ScenePath).Append(':').Append(current.DocumentToken);
            foreach (var target in targets)
                text.Append(';').Append(target.ProcessId).Append(':').Append(target.StartedTicks).Append(':').Append(target.DisplayName).Append(':').Append(target.ScenePath).Append(':').Append(target.DocumentToken);
            return text.ToString();
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
            // Remove closed processes immediately, even while metadata work is pending.
            _targetSelection.Refresh(discovered.Select(process => known.FirstOrDefault(t => t.IsSameProcess(process)) ?? process));
            return discovered;
        }

        internal async Task<ImportTarget> CaptureImportTargetAsync()
        {
            // Capture at the click, before yielding to metadata work or another dropdown choice.
            var snapshot = _targetSelection.Current;
            try
            {
                await RefreshTargetsAsync();
                if (IsDisposed || Disposing) return null;
                ObserveTargetProcessPresence();
                return _targetSelection.Targets.FirstOrDefault(target => target.IsSameScene(snapshot));
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
                var present = _discoverTargets();
                _targetSelection.Refresh(resolved.Where(target => present.Any(process => process.IsSameProcess(target))));
                UpdateOwnerDisplay(_targetSelection.Current);
            }
            catch (Exception ex) { Debug.WriteLine("[targets] refresh: " + ex.GetType().Name); }
        }

        private async Task<ImportTarget> ReadAvailableTargetAsync(ImportTarget target)
        {
            try
            {
                var resolved = await _readTarget(target).ConfigureAwait(false);
                if (target.IsSameProcess(resolved)) return resolved;
            }
            catch (Exception ex) { Debug.WriteLine("[targets] agent unavailable: " + ex.GetType().Name); }
            return new ImportTarget(target.ProcessId, target.StartedTicks, target.SceneTitle);
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
                    ApiBase = configuration.ApiBaseUri.AbsoluteUri.TrimEnd('/');
                    _v3 = V3Library.Create(configuration, _deviceIdentity, MachineCode.Read(),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "3dMood"));
                    _v3.HostEvent += PostHostEvent;
                    TrustedOrigins = PackagedAppRuntime.AppOrigin;
                }
                catch (Exception)
                {
                    SetConnectionMessage("Bộ cài thiếu cấu hình máy chủ hoặc giao diện. Liên hệ nhà cung cấp để nhận bộ cài đầy đủ.");
                    _connectionRetry.Enabled = false;
                    return;
                }
            }
            _trustedOrigins = (TrustedOrigins ?? "")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(o => { Uri u; return Uri.TryCreate(o.Trim(), UriKind.Absolute, out u) ? u : null; })
                .Where(u => u != null)
                .ToArray();

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
                Debug.WriteLine("[webview.init] " + ex.GetType().Name);
                if (MessageBox.Show(this,
                    "Không khởi tạo được Microsoft Edge WebView2 Runtime. Cài hoặc sửa WebView2 Evergreen Runtime, rồi mở lại 3ds Max.\r\n\r\nMở trang tải chính thức của Microsoft?",
                    "3dsmood", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
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
                    if (_v3 != null) _packagedApp.V3 = _v3;
                    await _packagedApp.ConfigureAsync();
                    await LoadPackagedAppAsync();
                    // v3 keeps working from its local cache when the network is gone, so it has no blocking connection gate.
                    if (!IsDisposed && _v3 == null) _connectionTimer.Start();
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
            SetConnectionMessage("Đang kết nối máy chủ 3dsmood…");
            try
            {
                var connected = _v3 != null || await _packagedApp.CheckConnectionAsync(_lifetime.Token);
                if (IsDisposed || Disposing) return;
                if (!connected)
                {
                    SetConnectionMessage("Không thể kết nối máy chủ 3dsmood. Vui lòng kết nối Internet rồi bấm Thử lại kết nối.");
                    return;
                }
                if (IsDisposed) return;
                _connectionPanel.Visible = false;
                _web.Visible = true;
                if (!_appLoaded) { _appLoaded = true; Navigate(StartUrl); }
                if (_v3 != null) _v3.SetPanelOpen(true);
            }
            catch (OperationCanceledException) { }
            catch (Exception) { if (!IsDisposed) SetConnectionMessage("Không thể kết nối máy chủ 3dsmood. Vui lòng kiểm tra Internet rồi thử lại."); }
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
                if (!connected) SetConnectionMessage("Mất kết nối máy chủ 3dsmood. Vui lòng kết nối Internet rồi thử lại.");
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

        /// <summary>True nếu uri khớp đúng scheme+host+port với một origin trong allowlist.
        /// Không suy diễn theo prefix chuỗi.</summary>
        private bool IsTrusted(string uri)
        {
            return BridgePolicy.IsTrusted(uri, _trustedOrigins, null);
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

            if (method == "host.checkUpdate") { _ = CheckUpdateAsync(id); return; }
            if (method == "host.applyUpdate") { StartApplyUpdate(id); return; }

            if (method.StartsWith("host.", StringComparison.Ordinal))
            {
                HandleHostMethod(id, method, paramsObj as Dictionary<string, object>);
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

            if (method == "asset.download")
            {
                var parameters = (Dictionary<string, object>)paramsObj;
                _ = Task.Run(() => DownloadAssetAsync(id, (string)parameters["modelId"]));
                return;
            }
            if (method == "asset.import")
            {
                var target = await CaptureImportTargetAsync();
                if (IsDisposed || Disposing || !_requestDocuments.ContainsKey(id)) return;
                if (target == null)
                {
                    PostError(id, "TARGET_UNAVAILABLE", "Hãy chọn cửa sổ 3ds Max sẵn sàng trong danh sách phía trên để import.");
                    return;
                }
                var p = paramsObj as Dictionary<string, object> ?? new Dictionary<string, object>();
                _ = Task.Run(() => ImportAssetAsync(id, p, target));
                return;
            }

            Dispatch(id, method, paramsObj as Dictionary<string, object>);
        }

        private async Task CheckUpdateAsync(string id)
        {
            try
            {
                if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng. Mở lại panel rồi thử lại."); return; }
                using (var deadline = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token))
                {
                    deadline.CancelAfter(TimeSpan.FromSeconds(15));
                    var status = await _v3.Update.CheckAsync(deadline.Token).ConfigureAwait(false);
                    PostResponse(id, true, new { current = status.Current, latest = status.Latest, updateAvailable = status.UpdateAvailable, restartRequired = status.RestartRequired }, null);
                }
            }
            catch (ApiException e) { PostError(id, e.Code, e.Message); }
            catch (OperationCanceledException) { PostError(id, "UPDATE_UNAVAILABLE", "Không kiểm tra được bản cập nhật. Thử lại sau."); }
        }

        // The panel updates by itself (no confirmation); Max's own "Save changes?" prompt appears only after the install, before it restarts.
        private void StartApplyUpdate(string id)
        {
            if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng. Mở lại panel rồi thử lại."); return; }
            if (_updating) { PostError(id, "UPDATE_BUSY", "Đang cập nhật."); return; }
            _updating = true;
            _v3.Update.Log("apply update requested");
            _ = Task.Run(() => ApplyUpdateAsync(id));
        }

        // Download + verify + unpack here; Max itself runs install.ms (MAXScript "update.install") because it knows its own user folders.
        // A failure anywhere before the final pointer swap in install.ms leaves the running version active.
        private async Task ApplyUpdateAsync(string id)
        {
            var handedOver = false;
            try
            {
                using (var cancellation = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token))
                {
                    cancellation.CancelAfter(TimeSpan.FromMinutes(30));
                    var status = await _v3.Update.CheckAsync(cancellation.Token).ConfigureAwait(false);
                    if (status.RestartRequired) { PostError(id, "UPDATE_RESTART_REQUIRED", "Đã cài bản mới. Hãy đóng và mở lại 3ds Max để dùng."); return; }
                    if (!status.UpdateAvailable) { PostError(id, "UPDATE_NOT_NEEDED", "Phiên bản hiện tại là mới nhất."); return; }
                    var clock = Stopwatch.StartNew();
                    var directory = await _v3.Update.PrepareAsync(status, (received, total) =>
                    {
                        if (clock.ElapsedMilliseconds < 200 && received != total) return;
                        clock.Restart(); PostProgress(id, received, total);
                    }, cancellation.Token).ConfigureAwait(false);
                    _updateVersion = status.Latest;
                    _v3.Update.Log("downloaded and verified " + status.Latest + "; handing over to install.ms");
                    handedOver = true;
                    BeginInvoke(new Action(() =>
                    {
                        try { Dispatch(id, "update.install", new Dictionary<string, object> { { "dir", directory } }); }
                        finally { _updating = false; }
                    }));
                }
            }
            catch (ApiException e) { PostError(id, e.Code, e.Message); }
            catch (InvalidDataException e) { _v3.Update.Log("verify failed: " + e.Message); PostError(id, "UPDATE_VERIFY_FAILED", e.Message); }
            catch (OperationCanceledException) { PostError(id, "UPDATE_UNAVAILABLE", "Hết thời gian tải bản cập nhật. Thử lại sau."); }
            catch (Exception e)
            {
                Debug.WriteLine("[update] " + e.GetType().Name); _v3.Update.Log("update failed: " + e.GetType().Name);
                PostError(id, "UPDATE_UNAVAILABLE", "Không tải hoặc chuẩn bị được bản cập nhật. Kiểm tra dung lượng ổ đĩa và thử lại.");
            }
            finally { if (!handedOver) _updating = false; }
        }

        /// <summary>Called by MAXScript (update.install) AFTER install.ms succeeded. The new files only load when Max starts, so remember
        /// that (the panel then reports "restart required"). MAXScript then asks Max's own save prompt and calls RestartMaxForUpdate.</summary>
        public void NotifyUpdateInstalled()
        {
            if (_updateVersion == null) return;
            PluginUpdateService.MarkInstalled(_updateVersion);
            _v3.Update.Log("installed " + _updateVersion + "; asking Max to save before restarting");
        }

        /// <summary>Called by MAXScript after the user answered Max's save prompt (not cancelled). scenePath is the saved scene to reopen, or empty
        /// for a blank Max. Starts the detached restart script and asks every OTHER Max to close (each shows its own save prompt); returns
        /// true when MAXScript may now quit this Max. Nothing is closed here for this Max: MAXScript does that with quitMax.</summary>
        public bool RestartMaxForUpdate(string scenePath)
        {
            if (_v3 == null) return false;
            var update = _v3.Update;
            try
            {
                string maxExe; int selfPid; var others = new List<Process>();
                using (var self = Process.GetCurrentProcess())
                {
                    maxExe = self.MainModule.FileName; selfPid = self.Id;
                    foreach (var other in Process.GetProcessesByName(self.ProcessName)) { if (other.Id == selfPid) other.Dispose(); else others.Add(other); }
                }
                try
                {
                    var start = update.PrepareRestart(maxExe, selfPid, others.Select(o => o.Id).ToList(), scenePath);
                    update.Log("restart: self=" + selfPid + " others=" + others.Count + " scene=" + (string.IsNullOrEmpty(scenePath) ? "(blank)" : Path.GetFileName(scenePath)));
                    using (var script = Process.Start(start)) update.Log("restart script started, pid " + (script == null ? -1 : script.Id));
                    foreach (var other in others)
                    {
                        bool asked = false;
                        try { asked = other.CloseMainWindow(); }
                        catch (Exception e) when (e is InvalidOperationException || e is System.ComponentModel.Win32Exception) { }
                        update.Log("asked Max pid " + other.Id + " to close: " + asked);
                    }
                    return true;
                }
                finally { foreach (var other in others) other.Dispose(); }
            }
            catch (Exception e)
            {
                update.Log("restart failed: " + e.GetType().Name + " " + e.Message);
                return false;
            }
        }

        /// <summary>Called by the startup agent: true once if the restart script started this Max (reopen the 3dsMood panel).</summary>
        public static bool ConsumeReopenPanel() { return PluginUpdateService.ConsumeReopenPanel(); }

        // Max year of this process (3ds Max 2022 = file major 24, so year = major + 1998); falls back to the locked target when unreadable.
        private static int RunningMaxYear()
        {
            try
            {
                using (var self = Process.GetCurrentProcess())
                {
                    var year = FileVersionInfo.GetVersionInfo(self.MainModule.FileName).FileMajorPart + 1998;
                    if (year >= 2015 && year <= 2100) return year;
                }
            }
            catch (Exception e) when (e is InvalidOperationException || e is System.ComponentModel.Win32Exception || e is NotSupportedException) { }
            return 2022;
        }

        // Starts a real Windows file drag (CF_HDROP, like Explorer) of the model's .max so 3ds Max shows its own Open/Merge/XRef menu on drop.
        // The path never reaches the web: it only sent the model id.
        private void BeginModelDrag(string id, string modelId, string thumbnailDataUrl)
        {
            if (IsDisposed || Disposing || _v3 == null) return;
            var log = _v3.Update;
            try
            {
                if ((MouseButtons & MouseButtons.Left) == 0)
                {
                    log.Log("drag: left button already released, not started");
                    PostError(id, "DRAG_NOT_STARTED", "Hãy giữ chuột trái trên thẻ model rồi kéo ra cửa sổ 3ds Max.");
                    return;
                }
                var year = RunningMaxYear();
                var path = _v3.Downloads.DragFile(modelId, year);
                log.Log("drag: start " + Path.GetFileName(path) + " (Max " + year + ")");
                PostResponse(id, true, new { started = true }, null);
                // Private format, not a file drop: only our overlays accept it (no copies into Explorer, never Max's replace-the-scene Open).
                var data = new DataObject(DragDropOverlay.DragFormat, path);
                // Our own drop target over every Max window (only while dragging): Max's built-in menu would replace the scene on Open File.
                var overlays = new List<DragDropOverlay>();
                var model = _v3.Downloads.Find(modelId);
                // Card with thumbnail + name that follows the pointer for the whole drag (click-through, so it never takes the drop).
                var ghost = new DragGhost(model == null ? null : model.name, "3DSMOOD / " + Path.GetExtension(path).TrimStart('.').ToUpperInvariant(), DragGhost.DecodeThumbnail(thumbnailDataUrl));
                // Leaving the panel while dragging minimizes it so the Max window underneath is free to drop on; a cancelled drag brings it back.
                var stateBefore = WindowState;
                var collapsed = false;
                GiveFeedbackEventHandler follow = (s, e) =>
                {
                    var cursor = Cursor.Position;
                    ghost.Follow(cursor);
                    if (!DragDropOverlay.ShouldCollapse(WindowState == FormWindowState.Minimized ? (Rectangle?)null : Bounds, cursor, collapsed)) return;
                    collapsed = true;
                    WindowState = FormWindowState.Minimized;
                    foreach (var o in overlays) o.CoverWholeWindow();   // the panel no longer sits on Max: the whole Max window takes the drop
                    log.Log("drag: left the panel, panel minimized");
                };
                try
                {
                    int selfPid;
                    using (var self = Process.GetCurrentProcess()) selfPid = self.Id;
                    var hole = Visible && WindowState != FormWindowState.Minimized ? (Rectangle?)Bounds : null;
                    foreach (var w in DragDropOverlay.FindMaxWindows())
                    {
                        var o = new DragDropOverlay(w.Bounds, hole, path, w.ProcessId, w.ProcessId == selfPid);
                        overlays.Add(o);
                        o.Show();
                        log.Log("drag: covering Max pid " + w.ProcessId + (o.IsOwnerMax ? " (this Max)" : "") + " class " + w.ClassName + " at " + w.Bounds);
                    }
                    if (overlays.Count == 0) log.Log("drag: no visible Max window to cover; the drop will not be accepted anywhere");
                    ghost.Follow(Cursor.Position);
                    ghost.Show();
                    GiveFeedback += follow;
                    var effect = DoDragDrop(data, DragDropEffects.Copy);
                    GiveFeedback -= follow;
                    ghost.Hide();
                    var hit = overlays.FirstOrDefault(o => o.Dropped);
                    log.Log("drag: finished, effect " + effect + (hit != null ? ", dropped on Max pid " + hit.ProcessId + (hit.IsOwnerMax ? " (this Max)" : "") : ""));
                    if (collapsed && DragDropOverlay.RestoreAfterDrag(effect)) { WindowState = stateBefore; log.Log("drag: cancelled, panel restored"); }
                    foreach (var o in overlays) o.Hide();
                    if (hit != null) ShowDropMenu(path, hit.DropPoint, hit.IsOwnerMax);
                }
                finally { GiveFeedback -= follow; ghost.Dispose(); foreach (var o in overlays) o.Dispose(); }
            }
            catch (ApiException e) { log.Log("drag: " + e.Code); PostError(id, e.Code, e.Message); }
            catch (Exception e) when (e is InvalidOperationException || e is System.Runtime.InteropServices.COMException)
            {
                log.Log("drag: failed " + e.GetType().Name);
                PostError(id, "DRAG_FAILED", "Không bắt đầu được thao tác kéo thả.");
            }
        }

        // Menu shown where the model was dropped. First line names the file that will be used (renderer/version variant). Open File starts ANOTHER
        // Max with the file (the scene being worked on is never replaced). Merge/XRef only on the Max hosting this panel (run through its MAXScript);
        // another Max only gets Open. Every action re-checks that the file is still one of the library's own downloaded files.
        private void ShowDropMenu(string path, Point screenPoint, bool ownerMax)
        {
            var menu = new ContextMenuStrip { ShowImageMargin = false };
            menu.Items.Add(new ToolStripLabel(Path.GetFileName(path)) { ForeColor = SystemColors.GrayText });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open File (cửa sổ Max mới)").Click += (s, e) => OpenInNewMax(path);
            if (ownerMax)
            {
                menu.Items.Add("Merge File").Click += (s, e) => RunDropAction(path, "merge");
                menu.Items.Add("XRef File").Click += (s, e) => RunDropAction(path, "xref");
            }
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Cancel");
            menu.Closed += (s, e) => BeginInvoke(new Action(menu.Dispose));   // after the click handler has run
            menu.Show(screenPoint);
        }

        private bool DropFileStillValid(string path)
        {
            return _v3 != null && path != null && path.EndsWith(".max", StringComparison.OrdinalIgnoreCase) && File.Exists(path) && _v3.Downloads.OwnsEntry(path);
        }

        // Max windows this panel started for previews (static: survives closing/reopening the panel). Pruned to the ones still running.
        private static readonly List<int> _previewPids = new List<int>();
        private static int RunningPreviews()
        {
            _previewPids.RemoveAll(pid =>
            {
                try { using (var p = Process.GetProcessById(pid)) return p.HasExited; }
                catch (Exception e) when (e is ArgumentException || e is InvalidOperationException) { return true; }
            });
            return _previewPids.Count;
        }

        /// <summary>Called by the startup agent of a preview Max: "copy|libraryFile" once, else "" (see PreviewCopy.Consume).</summary>
        public static string ConsumePreviewRelink() { return PreviewCopy.Consume(); }

        private async void OpenInNewMax(string path)
        {
            var log = _v3 == null ? null : _v3.Update;
            try
            {
                if (!DropFileStillValid(path)) { MessageBox.Show(this, "File model không còn trong thư viện đã tải.", "3dsmood", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                string maxExe;
                using (var self = Process.GetCurrentProcess()) maxExe = self.MainModule.FileName;
                if (!string.Equals(Path.GetFileName(maxExe), "3dsmax.exe", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("not 3dsmax.exe");
                var running = RunningPreviews();
                if (running >= 2 && MessageBox.Show(this, "Đang có " + running + " cửa sổ 3ds Max do 3dsmood mở để xem trước. Mở thêm một cửa sổ nữa sẽ tốn thêm RAM và thời gian khởi động.\n\nVẫn mở thêm?",
                        "3dsmood", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) { log.Log("drag: another preview Max declined (" + running + " running)"); return; }
                // Copy only the .max (off the UI thread: scenes can be large); the library file itself is never opened, so Save cannot overwrite it.
                var previewRoot = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(log.LogPath)), "Preview");
                var copy = await Task.Run(() => PreviewCopy.Create(path, previewRoot));
                var start = new ProcessStartInfo(maxExe, "\"" + copy + "\"") { UseShellExecute = false };
                start.EnvironmentVariables[PreviewCopy.OpenEnv] = copy;   // only this new Max gets them
                start.EnvironmentVariables[PreviewCopy.EntryEnv] = path;
                using (var started = Process.Start(start)) { if (started != null) _previewPids.Add(started.Id); }
                log.Log("drag: opened a preview copy of " + Path.GetFileName(path) + " in a new Max");
            }
            catch (Exception e) when (e is InvalidOperationException || e is System.ComponentModel.Win32Exception || e is IOException || e is UnauthorizedAccessException)
            {
                if (log != null) log.Log("drag: new Max failed " + e.GetType().Name);
                MessageBox.Show(this, "Không mở được cửa sổ 3ds Max mới.", "3dsmood", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void RunDropAction(string path, string mode)
        {
            if (!DropFileStillValid(path)) { MessageBox.Show(this, "File model không còn trong thư viện đã tải.", "3dsmood", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            _v3.Update.Log("drag: " + mode + " " + Path.GetFileName(path));
            Dispatch("drop-" + Guid.NewGuid().ToString("N"), "asset.dropFile", new Dictionary<string, object> { { "path", path }, { "mode", mode } });
        }

        private async Task HandleLibraryMethodAsync(string id, string method, Dictionary<string, object> parameters)
        {
            try
            {
                if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng. Mở lại panel rồi thử lại."); return; }
                if (method == "library.downloads") { PostResponse(id, true, new { models = _v3.Downloads.List() }, null); return; }
                // DoDragDrop is a modal loop: WebView2 forbids that inside its synchronous message callback, so post it to the UI queue.
                if (method == "library.beginDrag")
                {
                    var drag = (string)parameters["modelId"];
                    object image; parameters.TryGetValue("image", out image);
                    BeginInvoke(new Action(() => BeginModelDrag(id, drag, image as string))); return;
                }
                if (method == "library.importOptions")
                {
                    var options = await Task.Run(() => _v3.Downloads.ImportOptions((string)parameters["modelId"]));
                    PostResponse(id, true, options, null); return;
                }
                // Every favorites reply is the full state {favorites, folders, assignments}; older web code only reads "favorites".
                if (method == "library.favorites") { PostResponse(id, true, _v3.Downloads.FavoriteState(), null); return; }
                if (method == "library.setFavorite")
                {
                    _v3.Downloads.SetFavorite((string)parameters["modelId"], (bool)parameters["favorite"]);
                    PostResponse(id, true, _v3.Downloads.FavoriteState(), null); return;
                }
                if (method == "library.setFavoriteFolder") { PostResponse(id, true, _v3.Downloads.SetFavoriteFolder((string)parameters["modelId"], (string)parameters["folderId"]), null); return; }
                if (method == "library.createFavoriteFolder") { PostResponse(id, true, _v3.Downloads.CreateFavoriteFolder((string)parameters["name"], (string)parameters["contentDomain"]), null); return; }
                if (method == "library.renameFavoriteFolder") { PostResponse(id, true, _v3.Downloads.RenameFavoriteFolder((string)parameters["folderId"], (string)parameters["name"]), null); return; }
                if (method == "library.deleteFavoriteFolder") { PostResponse(id, true, _v3.Downloads.DeleteFavoriteFolder((string)parameters["folderId"]), null); return; }
                if (method == "library.settings") { PostResponse(id, true, _v3.Downloads.Settings(), null); return; }
                if (method == "library.chooseDownloadDirectory")
                {
                    // WebView2 forbids a modal dialog inside its synchronous COM event callback.
                    var domain = parameters.ContainsKey("contentDomain") ? (string)parameters["contentDomain"] : "3dmodels";
                    BeginInvoke(new Action(() => ChooseDownloadDirectory(id, domain)));
                    return;
                }
                if (method == "library.refresh") await _v3.Watcher.CheckNowAsync(_lifetime.Token);
                else // library.status
                {
                    try { await _v3.GetEntitlementsAsync(_lifetime.Token); } catch (ApiException) { /* offline or blocked: report what we know */ }
                }
                PostResponse(id, true, _v3.Status(), null);
            }
            catch (ApiException error) { PostError(id, error.Code, error.Message); }
            catch (InvalidDataException error) { PostError(id, "LIBRARY_INVALID", error.Message); }
            catch (OperationCanceledException) { PostError(id, "LIBRARY_CANCELLED", "Đã hủy thao tác thư viện. Vui lòng thử lại."); }
            catch (Exception error)
            {
                Debug.WriteLine("[library] " + error);
                PostError(id, "LIBRARY_UNAVAILABLE", "Không đọc hoặc lưu được thư viện. Kiểm tra quyền ghi dữ liệu và thử lại.");
            }
        }

        private void ChooseDownloadDirectory(string id, string contentDomain)
        {
            try
            {
                if (_v3 == null || IsDisposed || Disposing || !_requestDocuments.ContainsKey(id)) return;
                using (var picker = new FolderBrowserDialog { Description = contentDomain == "3dscenes" ? "Chọn thư mục lưu scene tải về" : "Chọn thư mục lưu model tải về", SelectedPath = _v3.Downloads.DirectoryFor(contentDomain), ShowNewFolderButton = true })
                {
                    var chosen = picker.ShowDialog(this) == DialogResult.OK;
                    if (chosen) { _v3.Downloads.SetDownloadDirectory(picker.SelectedPath, contentDomain); _v3.DownloadsChanged(); }
                    PostResponse(id, true, new { downloadDirectory = _v3.Downloads.DownloadDirectory, sceneDownloadDirectory = _v3.Downloads.SceneDownloadDirectory, cancelled = !chosen }, null);
                }
            }
            catch (Exception error)
            {
                Debug.WriteLine("[library.folder] " + error.GetType().Name);
                PostError(id, "DOWNLOAD_DIRECTORY_UNAVAILABLE", error is InvalidDataException ? error.Message : "Không ghi được vào thư mục đã chọn. Chọn thư mục khác trên SSD và thử lại.");
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

        private async Task DownloadAssetAsync(string id, string modelId)
        {
            using (var cancellation = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token))
            {
                cancellation.CancelAfter(TimeSpan.FromMinutes(30));
                try
                {
                    if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng."); return; }
                    var clock = Stopwatch.StartNew();
                    var result = await _v3.DownloadModelAsync(modelId, cancellation.Token, (received, total) => {
                        if (clock.ElapsedMilliseconds < 200 && received != total) return;
                        clock.Restart(); PostProgress(id, received, total);
                    }).ConfigureAwait(false);
                    PostResponse(id, true, result, null);
                }
                catch (ApiException e) { PostError(id, e.Code, e.Message); }
                catch (OperationCanceledException) { PostError(id, "DOWNLOAD_CANCELLED", "Đã hủy hoặc hết thời gian tải model."); }
                catch (Exception e)
                {
                    Debug.WriteLine("[asset.download] " + e.GetType().Name);
                    PostError(id, IsArchiveDependencyFailure(e) ? "ARCHIVE_DEPENDENCY_MISSING" : "ASSET_DOWNLOAD_FAILED",
                        e is InvalidDataException ? e.Message : "Không lưu được model. Kiểm tra dung lượng và quyền ghi thư mục tải.");
                }
            }
        }

        // Local import never downloads, extracts or waits for the network. Files and textures stay at stable indexed paths.
        private async Task ImportAssetAsync(string id, Dictionary<string, object> p, ImportTarget selectedTarget)
        {
            try
            {
                if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng."); return; }
                if (selectedTarget == null)
                {
                    PostError(id, "TARGET_UNAVAILABLE", "Hãy chọn cửa sổ 3ds Max để import.");
                    return;
                }
                var assetId = (string)p["modelId"];
                var entry = _v3.LocalEntry(assetId, p.ContainsKey("optionId") ? (string)p["optionId"] : null);
                if (!await ValidateSelectedTargetAsync(id, selectedTarget).ConfigureAwait(false)) return;
                await DispatchImportToTargetAsync(id, entry, assetId, selectedTarget).ConfigureAwait(false);
            }
            catch (ApiException e) { PostError(id, e.Code, e.Message); }
            catch (Exception ex)
            {
                Debug.WriteLine("[asset.import] " + ex.GetType().Name);
                PostError(id, "ASSET_IMPORT_FAILED", ex is InvalidDataException ? ex.Message : "Import thất bại. Kiểm tra file model và scene đã chọn.");
            }
        }

        internal async Task DispatchImportToTargetAsync(string id, string entry, string assetId, ImportTarget target)
        {
            if (_ownerProcess.IsSameProcess(target))
            {
                var args = new Dictionary<string, object> { { "path", entry }, { "assetId", assetId },
                    { "expectedScenePath", target.ScenePath }, { "expectedDocumentToken", target.DocumentToken } };
                BeginInvoke(new Action(() => Dispatch(id, "asset.importFile", args)));
                return;
            }
            // Keep this snapshot even if the dropdown changes while the import runs.
            string envelope;
            try
            {
                envelope = await PlatformAgent.SendImportAsync(target.ProcessId, Guid.NewGuid().ToString("N"), entry,
                    target.StartedTicks, target.ScenePath, target.DocumentToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is IOException || ex is TimeoutException)
            {
                PostError(id, "TARGET_UNAVAILABLE", "Max đã chọn không phản hồi. Kiểm tra cửa sổ Max đích trước khi thử import lại.");
                return;
            }
            var json = new JavaScriptSerializer();
            var reply = json.Deserialize<Dictionary<string, object>>(envelope);
            object ok, result, error;
            if (reply != null && reply.TryGetValue("ok", out ok) && Equals(ok, true) && reply.TryGetValue("result", out result))
                PostResultJson(id, json.Serialize(result));
            else if (reply != null && reply.TryGetValue("error", out error) && error is Dictionary<string, object>)
            {
                var details = (Dictionary<string, object>)error;
                PostError(id, details["code"] as string, details["message"] as string);
            }
            else PostError(id, "ASSET_IMPORT_FAILED", "Max đích trả về phản hồi không hợp lệ.");
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
            if (selected == null || !selected.IsReady)
            {
                PostError(id, "TARGET_UNAVAILABLE", "Hãy chọn cửa sổ 3ds Max để import.");
                return false;
            }
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

        /// <summary>Unsolicited host -> web event ({event, data}); only delivered to the trusted, fully navigated document.</summary>
        private void PostHostEvent(string type, object payload)
        {
            if (IsDisposed || Disposing) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(() => PostHostEvent(type, payload))); } catch (InvalidOperationException) { /* closing */ }
                return;
            }
            if (_web.CoreWebView2 == null || _navigating || !IsTrusted(_web.CoreWebView2.Source)) return;
            _web.CoreWebView2.PostWebMessageAsJson(_json.Serialize(new Dictionary<string, object> { { "event", type }, { "data", payload } }));
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

        private void HandleHostMethod(string id, string method, Dictionary<string, object> parameters)
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
                        { "processId", _ownerProcess.ProcessId },
                        { "importTarget", "selected" },
                        { "hostVersion", HostVersion },
                        { "plugin", "MaxWebViewHost" },
                        { "pluginVersion", (_v3 != null ? _v3.Update.InstalledVersion() : null) ?? GetType().Assembly.GetName().Version.ToString() },
                        { "webview2Version", webviewVersion },
                        { "protocolVersion", 1 }
                    }, null);
                    break;

                case "host.listTargets":
                case "host.selectTarget":
                case "host.focusMax":
                    try
                    {
                        if (method == "host.listTargets") PostResponse(id, true, TargetsSnapshot(), null);
                        else if (method == "host.selectTarget")
                        {
                            if (SelectTargetById((string)parameters["id"])) PostResponse(id, true, TargetsSnapshot(), null);
                            else PostError(id, "INVALID_PARAMS", "Cửa sổ 3ds Max không còn trong danh sách.");
                        }
                        else
                        {
                            var focused = ImportTargetDiscovery.Focus(_targetSelection.Current);
                            if (!focused) _status.Text = "Không thể focus Max đã chọn. Kiểm tra cửa sổ Max còn mở và cùng mức quyền Windows.";
                            _status.Visible = !focused;
                            PostResponse(id, true, new Dictionary<string, object> { { "focused", focused } }, null);
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine("[targets] " + ex.GetType().Name);
                        PostError(id, "HOST_NOT_READY", "Không đọc được danh sách cửa sổ 3ds Max.");
                    }
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
