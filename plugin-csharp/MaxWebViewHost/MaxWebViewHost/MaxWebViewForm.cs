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
            "asset.import"
        };

        /// <summary>Origin của backend 3DS Mood, nơi host tải asset. Phải nằm trong TrustedOrigins.
        /// Web chỉ gửi asset ID + ticket, không bao giờ gửi URL (spec §5.5).</summary>
        public static string ApiBase = "http://localhost:5001";

        // ponytail: giới hạn cứng 2GB, không resume/progress. Thêm khi cần tải gói lớn qua mạng thật.
        private const long MaxPackageBytes = 2L * 1024 * 1024 * 1024;
        private static readonly string[] ImportExtensions = { ".fbx", ".obj", ".max" }; // ưu tiên: không kéo theo plugin renderer lạ
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };

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
                _diagnosticBaseUri = new Uri(Path.GetDirectoryName(Path.GetFullPath(DiagnosticPagePath))
                                             + Path.DirectorySeparatorChar).AbsoluteUri;

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
                if (IsTrusted(e.Uri)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            _web.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            _web.CoreWebView2.NavigationCompleted += (s, e) => ShowStatus(e.IsSuccess ? null : StartUrl);

            Navigate(StartUrl);
        }

        private void Navigate(string url)
        {
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
            if (string.IsNullOrEmpty(uri)) return false;

            if (_diagnosticBaseUri != null && uri.StartsWith(_diagnosticBaseUri, StringComparison.OrdinalIgnoreCase))
                return true;

            Uri u;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return false;
            return _trustedOrigins != null && _trustedOrigins.Any(o =>
                string.Equals(o.Scheme, u.Scheme, StringComparison.OrdinalIgnoreCase)
                && string.Equals(o.Host, u.Host, StringComparison.OrdinalIgnoreCase)
                && o.Port == u.Port);
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!IsTrusted(e.Source)) return; // chỉ trang trong allowlist mới có bridge privilege

            Dictionary<string, object> msg;
            try
            {
                msg = _json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
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

            if (method == "asset.import")
            {
                var p = paramsObj as Dictionary<string, object> ?? new Dictionary<string, object>();
                _ = Task.Run(() => ImportAssetAsync(id, p));
                return;
            }

            Dispatch(id, method, paramsObj as Dictionary<string, object>);
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
                CleanOldDirs(root);
                workDir = Path.Combine(root, DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
                var extractDir = Path.Combine(workDir, "content");
                Directory.CreateDirectory(extractDir);
                var pkg = Path.Combine(workDir, "package.bin");

                // 1) tải về file tạm
                try
                {
                    var url = new Uri(api, "/api/downloads/stream/" + ticket);
                    using (var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                    {
                        if (!resp.IsSuccessStatusCode)
                        {
                            PostError(id, "ASSET_DOWNLOAD_FAILED", "Server trả " + (int)resp.StatusCode + " (ticket hết hạn hoặc đã dùng?)");
                            return;
                        }
                        if (resp.Content.Headers.ContentLength > MaxPackageBytes)
                        {
                            PostError(id, "ASSET_TOO_LARGE", "Gói vượt giới hạn " + (MaxPackageBytes >> 20) + "MB");
                            return;
                        }
                        using (var src = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        using (var dst = File.Create(pkg))
                            await src.CopyToAsync(dst).ConfigureAwait(false);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("[asset.import] download: " + ex);
                    PostError(id, "ASSET_DOWNLOAD_FAILED", "Không tải được gói từ backend");
                    return;
                }

                // 2) kiểm tra đường dẫn trong gói trước khi giải nén (zip-slip), rồi giải nén
                var entries = RunTar("-tf", pkg, null);
                if (entries == null) { PostError(id, "ASSET_EXTRACT_FAILED", "Không đọc được gói (định dạng không hỗ trợ?)"); return; }
                foreach (var e in entries)
                    if (!IsSafeEntry(e)) { PostError(id, "ASSET_UNSAFE_PACKAGE", "Gói chứa đường dẫn không an toàn"); return; }
                if (RunTar("-xf", pkg, extractDir) == null) { PostError(id, "ASSET_EXTRACT_FAILED", "Giải nén thất bại"); return; }

                // kiểm tra lại sau giải nén: mọi file phải nằm trong extractDir (symlink/junction)
                var baseFull = Path.GetFullPath(extractDir) + Path.DirectorySeparatorChar;
                var files = Directory.GetFiles(extractDir, "*", SearchOption.AllDirectories);
                if (files.Any(f => !Path.GetFullPath(f).StartsWith(baseFull, StringComparison.OrdinalIgnoreCase)))
                {
                    PostError(id, "ASSET_UNSAFE_PACKAGE", "Gói chứa đường dẫn không an toàn");
                    return;
                }

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
                var target = _targetPid;
                if (target == Process.GetCurrentProcess().Id)
                {
                    var args = new Dictionary<string, object> { { "path", entry }, { "assetId", assetId } };
                    BeginInvoke(new Action(() => Dispatch(id, "asset.importFile", args)));
                    return;
                }

                // Max đích là process khác: chuyển lệnh qua pipe. Không import nhầm sang scene khác khi đích không với tới được.
                string replyJson;
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
        }

        private static void CleanOldDirs(string root)
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } // file có thể đang bị Max khoá -> bỏ qua
            catch { }
        }

        private static bool IsSafeEntry(string e)
        {
            if (string.IsNullOrWhiteSpace(e)) return true;
            if (e.StartsWith("/") || e.StartsWith("\\") || e.Contains(":")) return false;
            return !e.Split('/', '\\').Contains("..");
        }

        /// <summary>Chạy tar.exe của Windows (đọc zip/rar, không đọc 7z). Trả về các dòng stdout, null nếu lỗi.</summary>
        private static List<string> RunTar(string mode, string pkg, string destDir)
        {
            var tar = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "tar.exe");
            var args = mode + " \"" + pkg + "\"" + (destDir != null ? " -C \"" + destDir + "\"" : "");
            var psi = new ProcessStartInfo(tar, args)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var pr = Process.Start(psi))
            {
                var err = pr.StandardError.ReadToEndAsync(); // đọc song song để không nghẽn pipe
                var lines = new List<string>();
                string line;
                while ((line = pr.StandardOutput.ReadLine()) != null) lines.Add(line);
                if (!pr.WaitForExit(5 * 60 * 1000)) { try { pr.Kill(); } catch { } return null; }
                if (pr.ExitCode != 0) { Debug.WriteLine("[tar] " + err.Result); return null; }
                return lines;
            }
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
            PostRaw(id, false, "error", _json.Serialize(MakeError(code, message)));
        }

        private static Dictionary<string, object> MakeError(string code, string message)
        {
            return new Dictionary<string, object> { { "code", code }, { "message", message } };
        }

        private void PostRaw(string id, bool ok, string payloadKey, string payloadJson)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => PostRaw(id, ok, payloadKey, payloadJson)));
                return;
            }
            if (_web.CoreWebView2 == null) return;

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
