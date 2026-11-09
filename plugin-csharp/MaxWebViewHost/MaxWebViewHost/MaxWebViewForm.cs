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

    // Native owner-drawn selector keeps the connection strip dark, including its popup.
    internal sealed class SceneTargetPicker : ComboBox
    {
        private static readonly Color Surface = Color.FromArgb(16, 16, 20);
        private static readonly Color Accent = Color.FromArgb(106, 190, 164);

        public SceneTargetPicker()
        {
            DropDownStyle = ComboBoxStyle.DropDownList;
            DrawMode = DrawMode.OwnerDrawFixed;
            FlatStyle = FlatStyle.Flat;
            BackColor = Surface;
            ForeColor = Color.FromArgb(235, 235, 229);
            Font = new Font("Consolas", 12);
            ItemHeight = 38;
            IntegralHeight = false;
            MaxDropDownItems = 8;
            DropDownHeight = 304;
            AccessibleName = "Cửa sổ 3ds Max đích";
            Cursor = Cursors.Hand;
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            DropDownWidth = Math.Max(1, Width);
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        // The managed setter skips the native message when the stored value is unchanged, but the native list
        // width can still be stale after the toolbar switches layout; send it every time the list opens.
        protected override void OnDropDown(EventArgs e)
        {
            base.OnDropDown(e);
            if (IsHandleCreated) SendMessage(Handle, 0x0160, (IntPtr)Math.Max(1, Width), IntPtr.Zero); // CB_SETDROPPEDWIDTH
        }

        protected override void OnDrawItem(DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= Items.Count) return;
            var collapsed = (e.State & DrawItemState.ComboBoxEdit) != 0;
            var selected = !collapsed && (e.State & DrawItemState.Selected) != 0;
            var target = Items[e.Index] as ImportTarget;
            var text = target == null ? Items[e.Index].ToString() : target.DisplayName
                + (collapsed ? "" : " | PID " + target.ProcessId)
                + (target.IsReady ? "" : " · chưa sẵn sàng");
            using (var background = new SolidBrush(selected ? Color.FromArgb(28, 43, 41) : Surface))
                e.Graphics.FillRectangle(background, e.Bounds);
            var bounds = new Rectangle(e.Bounds.X + 15, e.Bounds.Y, Math.Max(0, e.Bounds.Width - (collapsed ? 45 : 25)), e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, text, Font, bounds,
                target != null && !target.IsReady ? Color.FromArgb(135, 135, 135) : selected ? Accent : ForeColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            var printing = m.Msg == 0x0317 || m.Msg == 0x0318; // WM_PRINT / WM_PRINTCLIENT
            if ((m.Msg != 0x000F && !printing) || !IsHandleCreated) return;
            using (var graphics = printing && m.WParam != IntPtr.Zero ? Graphics.FromHdc(m.WParam) : Graphics.FromHwnd(Handle))
            using (var surface = new SolidBrush(Surface))
            using (var border = new Pen(Accent))
            using (var divider = new Pen(Color.FromArgb(44, 44, 48)))
            using (var arrow = new SolidBrush(ForeColor))
            {
                graphics.FillRectangle(surface, ClientRectangle);
                if (SelectedIndex >= 0)
                    OnDrawItem(new DrawItemEventArgs(graphics, Font, ClientRectangle, SelectedIndex, DrawItemState.ComboBoxEdit));
                var arrowWidth = Math.Max(28, (int)(32 * graphics.DpiX / 96));
                var x = Width - arrowWidth;
                graphics.FillRectangle(surface, x, 1, arrowWidth - 1, Height - 2);
                graphics.DrawLine(divider, x, 1, x, Height - 2);
                var cx = x + arrowWidth / 2;
                var cy = Height / 2;
                graphics.FillPolygon(arrow, new[] { new Point(cx - 5, cy - 2), new Point(cx + 5, cy - 2), new Point(cx, cy + 3) });
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var outline = new System.Drawing.Drawing2D.GraphicsPath())
                {
                    outline.AddArc(0, 0, 8, 8, 180, 90);
                    outline.AddArc(Width - 9, 0, 8, 8, 270, 90);
                    outline.AddArc(Width - 9, Height - 9, 8, 8, 0, 90);
                    outline.AddArc(0, Height - 9, 8, 8, 90, 90);
                    outline.CloseFigure();
                    graphics.DrawPath(border, outline);
                }
            }
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
        private string _updateScript, _updateMaxExe;

        /// <summary>Method allowlist. Web gọi method ngoài danh sách này thì bị từ chối ngay tại native,
        /// không tới được MAXScript. MAXScript có thể .Add thêm khi implement handler mới.</summary>
        public static readonly List<string> AllowedMethods = new List<string>
        {
            "host.ping", "host.getInfo", "host.checkUpdate", "host.applyUpdate",
            "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create",
            "asset.download", "asset.import", "device.getIdentity", "device.signChallenge",
            "library.status", "library.refresh", "library.downloads", "library.importOptions", "library.settings", "library.chooseDownloadDirectory",
            "library.favorites", "library.setFavorite", "library.setFavoriteFolder", "library.createFavoriteFolder", "library.renameFavoriteFolder", "library.deleteFavoriteFolder"
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
        private readonly ComboBox _targetPicker = new SceneTargetPicker { Dock = DockStyle.Fill };
        private readonly Button _focusMaxButton = new Button
        {
            Text = "Focus 3ds Max", Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(21, 21, 23), ForeColor = Color.FromArgb(225, 225, 222),
            Font = new Font("Consolas", 12), Cursor = Cursors.Hand, Enabled = false
        };
        private Task _targetRefreshTask = Task.CompletedTask;
        private readonly Func<ImportTarget[]> _discoverTargets;
        private readonly Func<ImportTarget, Task<ImportTarget>> _readTarget;
        private readonly Timer _focusTimer = new Timer { Interval = 1000 };
        private readonly Label _target = new Label
        {
            Dock = DockStyle.Fill, Text = "Not connected", AutoEllipsis = true,
            ForeColor = Color.FromArgb(221, 221, 215), Font = new Font("Consolas", 12),
            TextAlign = ContentAlignment.MiddleLeft
        };

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

        /// <summary>Mọi method không phải "host.*" được đẩy ra đây cho MAXScript xử lý.</summary>
        public event EventHandler<SceneRequestEventArgs> SceneRequestReceived;

        public MaxWebViewForm() : this(ImportTargetDiscovery.Discover, PlatformAgent.ReadSceneTargetAsync) { }

        internal MaxWebViewForm(Func<ImportTarget[]> discoverTargets, Func<ImportTarget, Task<ImportTarget>> readTarget, ImportTarget ownerProcess = null)
        {
            _discoverTargets = discoverTargets ?? throw new ArgumentNullException(nameof(discoverTargets));
            _readTarget = readTarget ?? throw new ArgumentNullException(nameof(readTarget));
            FormClosed += (sender, args) => _lifetime.Cancel();
            _ownerProcess = ownerProcess ?? CurrentOwnerProcess();
            UpdateOwnerDisplay(null);
            Width = 1100;
            Height = 800;

            var toolbar = new TableLayoutPanel
            {
                Name = "ConnectionToolbar", Dock = DockStyle.Top, Height = 64, ColumnCount = 3, RowCount = 1,
                BackColor = Color.FromArgb(22, 22, 24), Padding = new Padding(12, 9, 12, 9)
            };
            toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 37));
            toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 63));
            toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 172));
            toolbar.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            _target.Margin = new Padding(0, 0, 12, 0);
            _targetPicker.Margin = new Padding(0, 0, 12, 0);
            _focusMaxButton.Margin = Padding.Empty;
            _focusMaxButton.FlatAppearance.BorderColor = Color.FromArgb(55, 55, 59);
            _focusMaxButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(35, 41, 39);
            _focusMaxButton.Click += (s, e) =>
            {
                if (!ImportTargetDiscovery.Focus(_targetSelection.Current))
                {
                    _status.Text = "Không thể focus Max đã chọn. Kiểm tra cửa sổ Max còn mở và cùng mức quyền Windows.";
                    _status.Visible = true;
                }
                else _status.Visible = false;
            };
            toolbar.Controls.Add(_target, 0, 0);
            toolbar.Controls.Add(_targetPicker, 1, 0);
            toolbar.Controls.Add(_focusMaxButton, 2, 0);
            toolbar.SizeChanged += (s, e) => LayoutConnectionToolbar(toolbar);
            LayoutConnectionToolbar(toolbar);
            _targetPicker.DropDown += (s, e) =>
            {
                // No refresh here: the 1 s timer keeps the list current, and a synchronous window scan on the UI thread
                // at the exact moment the list opens is what made opening it stutter.
                _targetPicker.DropDownWidth = Math.Max(1, _targetPicker.Width);
            };
            _targetPicker.SelectionChangeCommitted += (s, e) =>
            {
                _targetSelection.Select(_targetPicker.SelectedItem as ImportTarget);
                UpdateOwnerDisplay(_targetSelection.Current);
            };
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
            Controls.Add(toolbar);
            Controls.Add(_status);
            _connectionTimer.Tick += async (s, e) => await MonitorConnectionAsync();
            FormClosed += (s, e) => { _connectionTimer.Dispose(); _packagedApp?.Dispose(); _v3?.Dispose(); };
            Load += async (s, e) => await InitAsync();
        }

        private static ImportTarget CurrentOwnerProcess()
        {
            using (var process = Process.GetCurrentProcess())
                return new ImportTarget(process.Id, process.StartTime.ToUniversalTime().Ticks, process.MainWindowTitle);
        }

        private void LayoutConnectionToolbar(TableLayoutPanel toolbar)
        {
            var compact = toolbar.ClientSize.Width < 800;
            if (toolbar.Tag is bool && (bool)toolbar.Tag == compact) return;
            toolbar.Tag = compact;
            toolbar.SuspendLayout();
            try
            {
                toolbar.SetColumnSpan(_target, 1);
                toolbar.SetColumnSpan(_targetPicker, 1);
                toolbar.RowCount = compact ? 2 : 1;
                toolbar.RowStyles.Clear();
                if (compact) toolbar.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
                toolbar.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                toolbar.ColumnStyles[0].Width = compact ? 0 : 37;
                toolbar.ColumnStyles[1].Width = compact ? 100 : 63;
                toolbar.ColumnStyles[2].Width = compact ? 150 : 172;
                toolbar.SetCellPosition(_target, new TableLayoutPanelCellPosition(0, 0));
                toolbar.SetCellPosition(_targetPicker, new TableLayoutPanelCellPosition(compact ? 0 : 1, compact ? 1 : 0));
                toolbar.SetCellPosition(_focusMaxButton, new TableLayoutPanelCellPosition(2, compact ? 1 : 0));
                toolbar.SetColumnSpan(_target, compact ? 3 : 1);
                toolbar.SetColumnSpan(_targetPicker, compact ? 2 : 1);
                toolbar.Height = compact ? 96 : 64;
            }
            finally { toolbar.ResumeLayout(true); }
        }

        private void UpdateOwnerDisplay(ImportTarget current)
        {
            Text = current == null ? "3dsmood | Chọn cửa sổ 3ds Max" : "3dsmood | "
                + (string.IsNullOrEmpty(current.ScenePath) ? "Untitled" : Path.GetFileName(current.ScenePath))
                + " | Max PID " + current.ProcessId;
            _target.Text = current == null ? "Not connected · Chọn 3ds Max" : "Connected: " + current.DisplayName;
            _focusMaxButton.Enabled = current != null;
            // Polling must not move items underneath an open dropdown.
            if (_targetPicker.DroppedDown) return;
            // Rebuilding the list repaints the whole selector, so do it only when what it shows actually changed;
            // doing it on every 1 s poll made the text flash.
            var targets = _targetSelection.Targets;
            var signature = PickerSignature(current, targets);
            if (signature == _pickerSignature && _targetPicker.Items.Count == targets.Length + 1) return;
            _pickerSignature = signature;
            _targetPicker.BeginUpdate();
            try
            {
                _targetPicker.Items.Clear();
                _targetPicker.Items.Add(_targetSelection.SelectedUnavailable
                    ? "Scene đã chọn không còn sẵn sàng — chọn lại cửa sổ Max"
                    : "Chọn cửa sổ 3ds Max để import…");
                foreach (var target in targets) _targetPicker.Items.Add(target);
                _targetPicker.SelectedIndex = current == null ? 0 : Array.FindIndex(targets, t => t.IsSameScene(current)) + 1;
            }
            finally { _targetPicker.EndUpdate(); }
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
            // WebView2 forbids a modal dialog inside its synchronous COM event callback.
            if (method == "host.applyUpdate") { BeginInvoke(new Action(() => ConfirmAndApplyUpdate(id))); return; }

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
                    PostResponse(id, true, new { current = status.Current, latest = status.Latest, updateAvailable = status.UpdateAvailable }, null);
                }
            }
            catch (ApiException e) { PostError(id, e.Code, e.Message); }
            catch (OperationCanceledException) { PostError(id, "UPDATE_UNAVAILABLE", "Không kiểm tra được bản cập nhật. Thử lại sau."); }
        }

        private void ConfirmAndApplyUpdate(string id)
        {
            if (IsDisposed || Disposing || !_requestDocuments.ContainsKey(id)) return;
            if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng. Mở lại panel rồi thử lại."); return; }
            if (_updating) { PostError(id, "UPDATE_BUSY", "Đang cập nhật."); return; }
            int windows;
            using (var self = Process.GetCurrentProcess()) windows = Process.GetProcessesByName(self.ProcessName).Length;
            var yes = MessageBox.Show(this, "Cập nhật 3dsmood sẽ đóng TẤT CẢ cửa sổ 3ds Max đang mở (" + windows + ") rồi mở lại 3ds Max trống.\n\nHãy lưu scene trước khi tiếp tục. Tiếp tục cập nhật?",
                "3dsmood", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;
            if (!yes) { PostError(id, "UPDATE_CANCELLED", "Đã hủy cập nhật."); return; }
            _updating = true;
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
                    if (!status.UpdateAvailable) { PostError(id, "UPDATE_NOT_NEEDED", "Phiên bản hiện tại là mới nhất."); return; }
                    var clock = Stopwatch.StartNew();
                    var directory = await _v3.Update.PrepareAsync(status, (received, total) =>
                    {
                        if (clock.ElapsedMilliseconds < 200 && received != total) return;
                        clock.Restart(); PostProgress(id, received, total);
                    }, cancellation.Token).ConfigureAwait(false);
                    string maxExe;
                    using (var self = Process.GetCurrentProcess()) maxExe = self.MainModule.FileName;
                    _updateScript = _v3.Update.WriteRestartScript(maxExe);
                    _updateMaxExe = maxExe;
                    handedOver = true;
                    BeginInvoke(new Action(() =>
                    {
                        try { Dispatch(id, "update.install", new Dictionary<string, object> { { "dir", directory } }); }
                        finally { _updating = false; }
                    }));
                }
            }
            catch (ApiException e) { PostError(id, e.Code, e.Message); }
            catch (InvalidDataException e) { PostError(id, "UPDATE_VERIFY_FAILED", e.Message); }
            catch (OperationCanceledException) { PostError(id, "UPDATE_UNAVAILABLE", "Hết thời gian tải bản cập nhật. Thử lại sau."); }
            catch (Exception e)
            {
                Debug.WriteLine("[update] " + e.GetType().Name);
                PostError(id, "UPDATE_UNAVAILABLE", "Không tải hoặc chuẩn bị được bản cập nhật. Kiểm tra dung lượng ổ đĩa và thử lại.");
            }
            finally { if (!handedOver) _updating = false; }
        }

        /// <summary>Called by MAXScript (update.install) AFTER install.ms succeeded: start the restart script, ask every 3ds Max to close
        /// (each one can still show its own "Save changes?" prompt), then this one.</summary>
        public void RestartMaxForUpdate()
        {
            if (_updateScript == null || _updateMaxExe == null) return;
            try
            {
                PluginUpdateService.StartDetached(_updateScript, _updateMaxExe);
                using (var self = Process.GetCurrentProcess())
                {
                    foreach (var other in Process.GetProcessesByName(self.ProcessName))
                        using (other) { if (other.Id != self.Id) try { other.CloseMainWindow(); } catch (Exception e) when (e is InvalidOperationException || e is System.ComponentModel.Win32Exception) { } }
                    self.CloseMainWindow();
                }
            }
            catch (Exception e) { Debug.WriteLine("[update] restart: " + e.GetType().Name); }
        }

        private async Task HandleLibraryMethodAsync(string id, string method, Dictionary<string, object> parameters)
        {
            try
            {
                if (_v3 == null) { PostError(id, "LIBRARY_NOT_CONFIGURED", "Thư viện chưa sẵn sàng. Mở lại panel rồi thử lại."); return; }
                if (method == "library.downloads") { PostResponse(id, true, new { models = _v3.Downloads.List() }, null); return; }
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
                        { "processId", _ownerProcess.ProcessId },
                        { "importTarget", "selected" },
                        { "hostVersion", HostVersion },
                        { "plugin", "MaxWebViewHost" },
                        { "pluginVersion", (_v3 != null ? _v3.Update.InstalledVersion() : null) ?? GetType().Assembly.GetName().Version.ToString() },
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
