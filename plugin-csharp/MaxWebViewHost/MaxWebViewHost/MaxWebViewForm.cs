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
        public static string StartUrl = "http://localhost:5173";

        /// <summary>Danh sách origin được tin, phân tách bằng dấu phẩy (kiểu string thay vì string[]
        /// để MAXScript gán trực tiếp được, không cần dựng .NET array).</summary>
        public static string TrustedOrigins = "http://localhost:5173";

        public static string EnvironmentName = "development";
        public static string HostVersion = "unknown";

        /// <summary>Method allowlist. Web gọi method ngoài danh sách này thì bị từ chối ngay tại native,
        /// không tới được MAXScript. MAXScript có thể .Add thêm khi implement handler mới.</summary>
        public static readonly List<string> AllowedMethods = new List<string>
        {
            "host.ping", "host.getInfo",
            "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create",
            "asset.import", "device.getIdentity", "device.signChallenge"
        };

        /// <summary>Origin của backend 3DS Mood, nơi host tải asset. Phải nằm trong TrustedOrigins.
        /// Web chỉ gửi asset ID + ticket, không bao giờ gửi URL (spec §5.5).</summary>
        public static string ApiBase = "http://localhost:5001";

        // Bounded streaming download; single-use tickets intentionally do not resume.
        private const long MaxPackageBytes = 2L * 1024 * 1024 * 1024;
        private static readonly string[] ImportExtensions = { ".max", ".fbx", ".obj" };
        private static readonly HttpClient Http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromMinutes(30) };
        private readonly System.Threading.CancellationTokenSource _lifetime = new System.Threading.CancellationTokenSource();

        private static MaxWebViewForm _instance;

        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        // Max được focus gần nhất (không tính chính panel). Panel là cửa sổ riêng nên lúc bấm Import
        // foreground đã là panel; vì vậy phải nhớ Max trước đó thay vì đọc foreground tại thời điểm import.
        private int _targetPid = Process.GetCurrentProcess().Id;
        private readonly Timer _focusTimer = new Timer { Interval = 500 };
        private readonly Label _target = new Label
        {
            Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleLeft, Padding = new Padding(6, 0, 0, 0)
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
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
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

        public MaxWebViewForm()
        {
            FormClosed += (sender, args) => _lifetime.Cancel();
            Text = "3ds Max Platform — " + EnvironmentName;
            Width = 1100;
            Height = 800;

            var toolbar = new Panel { Dock = DockStyle.Top, Height = 28 };
            _retryButton.Click += (s, e) => Navigate(StartUrl);
            _diagButton.Click += (s, e) => OpenDiagnosticPage();
            toolbar.Controls.Add(_target);
            toolbar.Controls.Add(_retryButton);
            toolbar.Controls.Add(_diagButton);
            _focusTimer.Tick += (s, e) => TrackTarget();
            _focusTimer.Start();
            FormClosed += (s, e) => _focusTimer.Dispose();
            TrackTarget();

            Controls.Add(_web);
            Controls.Add(toolbar);
            Controls.Add(_status);
            Load += async (s, e) => await InitAsync();
        }

        private void TrackTarget()
        {
            try
            {
                uint pid;
                var hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero && hwnd != Handle && GetWindowThreadProcessId(hwnd, out pid) != 0)
                {
                    using (var p = Process.GetProcessById((int)pid))
                        if (string.Equals(p.ProcessName, "3dsmax", StringComparison.OrdinalIgnoreCase)) _targetPid = (int)pid;
                }
                var title = "(đã đóng)";
                try
                {
                    using (var t = Process.GetProcessById(_targetPid))
                        if (!t.HasExited) title = t.MainWindowTitle;
                }
                catch { }
                _target.Text = "Import vào: " + title;
            }
            catch { /* process vừa thoát giữa chừng: bỏ qua, tick sau sẽ cập nhật */ }
        }

        private async Task InitAsync()
        {
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

            Navigate(StartUrl);
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

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
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

            if (method.StartsWith("device.", StringComparison.Ordinal))
            {
                var parameters = (Dictionary<string, object>)paramsObj;
                _ = Task.Run(() => HandleDeviceMethod(id, method, parameters));
                return;
            }

            if (method == "asset.import")
            {
                var p = paramsObj as Dictionary<string, object> ?? new Dictionary<string, object>();
                _ = Task.Run(() => ImportAssetAsync(id, p));
                return;
            }

            Dispatch(id, method, paramsObj as Dictionary<string, object>);
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

        private static readonly Regex AssetIdRx = new Regex("^[0-9a-fA-F]{12,24}$"); // 12 = id store-api, 24 = ObjectId web cu
        private static readonly Regex TicketRx = new Regex("^[A-Za-z0-9_-]{16,128}$");

        private async Task ImportAssetAsync(string id, Dictionary<string, object> p)
        {
            string workDir = null;
            bool retainContent = false;
            using (var cancellation = System.Threading.CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token))
            {
            cancellation.CancelAfter(TimeSpan.FromMinutes(30));
            var token = cancellation.Token;
            try
            {
                object a, t;
                p.TryGetValue("assetId", out a);
                p.TryGetValue("ticket", out t);
                var assetId = a as string;
                var ticket = t as string;
                if (assetId == null || !AssetIdRx.IsMatch(assetId) || ticket == null || !TicketRx.IsMatch(ticket))
                {
                    PostError(id, "INVALID_PARAMS", "assetId/ticket không hợp lệ");
                    return;
                }

                Uri api;
                if (!Uri.TryCreate(ApiBase, UriKind.Absolute, out api) || !IsTrusted(api.GetLeftPart(UriPartial.Authority)))
                {
                    PostError(id, "ORIGIN_NOT_ALLOWED", "ApiBase không nằm trong TrustedOrigins");
                    return;
                }

                // Mỗi lần import dùng thư mục mới (ticket là một lần dùng nên không có cache hit để tận dụng).
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                        "MaxWebViewHost", "cache", assetId);
                workDir = Path.Combine(root, Guid.NewGuid().ToString("N"));
                var extractDir = Path.Combine(workDir, "content");
                Directory.CreateDirectory(extractDir);
                var pkg = Path.Combine(workDir, "package.bin");

                // 1) tải về file tạm
                try
                {
                    var url = new Uri(api, "/api/downloads/stream/" + ticket);
                    using (var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false))
                    {
                        if (!resp.IsSuccessStatusCode)
                        {
                            var code = "ASSET_DOWNLOAD_FAILED";
                            try {
                                var failure = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
                                object value;
                                if (failure != null && failure.TryGetValue("error", out value) && value is string
                                    && Regex.IsMatch((string)value, "^[A-Z][A-Z0-9_]{1,80}$")) code = (string)value;
                            } catch (ArgumentException) { }
                            PostError(id, code, "Không tải được model (HTTP " + (int)resp.StatusCode + ", " + code + "). Kiểm tra license/ticket hoặc trạng thái nguồn catalog.");
                            return;
                        }
                        if (resp.Content.Headers.ContentLength > MaxPackageBytes)
                        {
                            PostError(id, "ASSET_TOO_LARGE", "Gói vượt giới hạn " + (MaxPackageBytes >> 20) + "MB");
                            return;
                        }
                        using (var aborted = token.Register(() => resp.Dispose()))
                        using (var src = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        using (var dst = File.Create(pkg))
                        {
                            var clock = Stopwatch.StartNew();
                            var copied = ArchivePackage.CopyBounded(src, dst, MaxPackageBytes, n => {
                                if (clock.ElapsedMilliseconds < 200) return;
                                clock.Restart();
                                PostProgress(id, n, resp.Content.Headers.ContentLength);
                            }, token);
                            if (resp.Content.Headers.ContentLength.HasValue && copied != resp.Content.Headers.ContentLength.Value)
                                throw new InvalidDataException("Download truncated.");
                            PostProgress(id, copied, resp.Content.Headers.ContentLength);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("[asset.import] download: " + ex);
                    PostError(id, "ASSET_DOWNLOAD_FAILED", "Không tải được gói từ backend");
                    return;
                }

                // Validate every entry before writing; only bounded model/texture data is extracted.
                var files = ArchivePackage.Extract(pkg, extractDir, token, null);

                // 3) chọn file import theo thứ tự ưu tiên định dạng
                string entry = null;
                foreach (var ext in ImportExtensions)
                {
                    entry = files.Where(f => f.EndsWith(ext, StringComparison.OrdinalIgnoreCase))
                                 .OrderBy(f => f.Length).FirstOrDefault();
                    if (entry != null) break;
                }
                if (entry == null) { PostError(id, "ASSET_NO_IMPORTABLE_FILE", "Gói không có file .fbx/.obj/.max"); return; }

                // 4) giao cho adapter (MAXScript) chạy trên UI thread. Method này KHÔNG nằm trong allowlist
                //    nên web không gọi trực tiếp được; đường dẫn do host tự tính.
                token.ThrowIfCancellationRequested();
                var target = _targetPid;
                if (target == Process.GetCurrentProcess().Id)
                {
                    var args = new Dictionary<string, object> { { "path", entry }, { "assetId", assetId } };
                    retainContent = true; // scene textures may refer to this owned cache directory.
                    BeginInvoke(new Action(() => Dispatch(id, "asset.importFile", args)));
                    return;
                }

                // Max đích là process khác: chuyển lệnh qua pipe. Không import nhầm sang scene khác khi đích không với tới được.
                string replyJson;
                // A lost reply does not prove that the target failed to merge. Preserve
                // the files from the moment the command can reach another Max scene.
                retainContent = true;
                try { replyJson = await PlatformAgent.SendImportAsync(target, id, entry).ConfigureAwait(false); }
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
                PostError(id, "ASSET_IMPORT_FAILED", "Import thất bại");
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
