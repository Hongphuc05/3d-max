using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
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
        // ponytail: hard-coded test page + version string, settable từ MAXScript.
        // Phase 4 thay bằng config/staging URL.
        public static string HtmlPath = @"D:\Project\3d-max\frontend\index.html";
        public static string HostVersion = "unknown";

        /// <summary>Method allowlist. Web gọi method ngoài danh sách này thì bị từ chối ngay tại native,
        /// không tới được MAXScript. MAXScript có thể .Add thêm khi implement handler mới.</summary>
        public static readonly List<string> AllowedMethods = new List<string>
        {
            "host.ping", "host.getInfo",
            "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create"
        };

        private static MaxWebViewForm _instance;

        private string _baseUri;

        private readonly WebView2 _web = new WebView2 { Dock = DockStyle.Fill };
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        /// <summary>Mọi method không phải "host.*" được đẩy ra đây cho MAXScript xử lý.</summary>
        public event EventHandler<SceneRequestEventArgs> SceneRequestReceived;

        public MaxWebViewForm()
        {
            Text = "3ds Max Platform (test)";
            Width = 900;
            Height = 700;
            Controls.Add(_web);
            Load += async (s, e) => await InitAsync();
        }

        private async Task InitAsync()
        {
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

            if (!File.Exists(HtmlPath))
            {
                MessageBox.Show(this, "Không tìm thấy file: " + HtmlPath,
                    "MaxWebViewHost", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // ponytail: allowlist = thư mục chứa trang test. Phase 4 đổi thành https origin của platform.
            _baseUri = new Uri(Path.GetDirectoryName(Path.GetFullPath(HtmlPath))
                               + Path.DirectorySeparatorChar).AbsoluteUri;

            _web.CoreWebView2.WebMessageReceived += OnWebMessage;
            _web.CoreWebView2.NavigationStarting += (s, e) =>
            {
                if (!IsTrusted(e.Uri)) e.Cancel = true;
            };

            _web.CoreWebView2.Navigate(new Uri(HtmlPath).AbsoluteUri);
        }

        private bool IsTrusted(string uri)
        {
            return !string.IsNullOrEmpty(_baseUri)
                && uri != null
                && uri.StartsWith(_baseUri, StringComparison.OrdinalIgnoreCase);
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
                ParamsJson = _json.Serialize(paramsObj ?? new Dictionary<string, object>()),
                Params = paramsObj as Dictionary<string, object>
            });
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
