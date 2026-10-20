using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MaxWebViewHost
{
    /// <summary>
    /// Chạy trong MỖI process 3ds Max (khởi động từ scripts\Startup). Mở named pipe "MaxPlatform-&lt;pid&gt;"
    /// chỉ cho user hiện tại, nhận đúng một lệnh: import file đã giải nén trong thư mục cache.
    /// Panel (hub) ở một Max khác dùng SendImportAsync để chuyển lệnh import tới Max đang làm việc.
    /// Pipe là trust boundary: chỉ nhận path nằm trong CacheRoot, đuôi trong allowlist, không nhận gì khác.
    /// </summary>
    public class PlatformAgent
    {
        public const string PipePrefix = "MaxPlatform-";
        private static readonly string[] AllowedExt = { ".fbx", ".obj", ".max" };
        private static readonly Regex IdRx = new Regex("^[A-Za-z0-9-]{1,64}$");
        private const int MaxRequestChars = 8192;
        private static readonly TimeSpan ImportTimeout = TimeSpan.FromMinutes(10);

        public static readonly string CacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaxWebViewHost", "cache");

        private static PlatformAgent _instance;

        private readonly Control _ui = new Control();   // tạo trên UI thread của Max để marshal về đó
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _pending =
            new ConcurrentDictionary<string, TaskCompletionSource<string>>();

        /// <summary>Cùng kiểu event với MaxWebViewForm để MAXScript dùng chung một handler.</summary>
        public event EventHandler<SceneRequestEventArgs> SceneRequestReceived;

        public static string PipeNameFor(int pid) { return PipePrefix + pid; }

        /// <summary>Gọi từ MAXScript (UI thread). Gọi lại nhiều lần vẫn chỉ có 1 agent.</summary>
        public static PlatformAgent Start()
        {
            if (_instance != null) return _instance;
            var a = new PlatformAgent();
            var unused = a._ui.Handle; // ép tạo handle ngay trên UI thread
            _instance = a;
            var _ = a.ServeAsync();
            return a;
        }

        // ---------- phía nhận (agent) ----------

        private NamedPipeServerStream CreatePipe()
        {
            var sec = new PipeSecurity();
            sec.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,
                PipeAccessRights.FullControl, AccessControlType.Allow)); // chỉ user đang chạy Max
            return new NamedPipeServerStream(PipeNameFor(System.Diagnostics.Process.GetCurrentProcess().Id),
                PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, sec);
        }

        private async Task ServeAsync()
        {
            while (true)
            {
                NamedPipeServerStream pipe = null;
                try
                {
                    pipe = CreatePipe();
                    await Task.Factory.FromAsync(pipe.BeginWaitForConnection, pipe.EndWaitForConnection, null)
                              .ConfigureAwait(false);
                    var p = pipe; pipe = null;
                    var _ = Task.Run(() => HandleAsync(p));
                }
                catch
                {
                    if (pipe != null) pipe.Dispose();
                    await Task.Delay(1000).ConfigureAwait(false); // tránh vòng lặp nóng nếu tạo pipe lỗi liên tục
                }
            }
        }

        private async Task HandleAsync(NamedPipeServerStream pipe)
        {
            using (pipe)
            {
                try
                {
                    var reader = new StreamReader(pipe);
                    var writer = new StreamWriter(pipe) { AutoFlush = true };
                    var line = await reader.ReadLineAsync().ConfigureAwait(false);
                    string reply;
                    if (line == null || line.Length > MaxRequestChars) reply = Err("INVALID_PARAMS", "Request không hợp lệ");
                    else reply = await ProcessAsync(line).ConfigureAwait(false);
                    await writer.WriteLineAsync(reply).ConfigureAwait(false);
                }
                catch { /* client đã ngắt: không có gì để trả */ }
            }
        }

        private async Task<string> ProcessAsync(string line)
        {
            Dictionary<string, object> msg;
            try { msg = _json.Deserialize<Dictionary<string, object>>(line); }
            catch { return Err("INVALID_PARAMS", "JSON hỏng"); }

            object idObj, pathObj;
            msg.TryGetValue("id", out idObj);
            msg.TryGetValue("path", out pathObj);
            var id = idObj as string;
            var path = pathObj as string;
            if (id == null || !IdRx.IsMatch(id) || string.IsNullOrEmpty(path))
                return Err("INVALID_PARAMS", "Thiếu id/path");

            string full;
            try { full = Path.GetFullPath(path); } catch { return Err("INVALID_PARAMS", "Path không hợp lệ"); }
            var root = Path.GetFullPath(CacheRoot) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                || !AllowedExt.Contains(Path.GetExtension(full).ToLowerInvariant())
                || !File.Exists(full))
                return Err("INVALID_PARAMS", "File import không hợp lệ");

            var handler = SceneRequestReceived;
            if (handler == null) return Err("HOST_NOT_READY", "Agent chưa có handler");

            var tcs = new TaskCompletionSource<string>();
            if (!_pending.TryAdd(id, tcs)) return Err("INVALID_PARAMS", "Id trùng");
            try
            {
                var p = new Dictionary<string, object> { { "path", full } };
                _ui.BeginInvoke(new Action(() => handler(this, new SceneRequestEventArgs
                {
                    Id = id, Method = "asset.importFile", ParamsJson = _json.Serialize(p), Params = p
                })));
                var done = await Task.WhenAny(tcs.Task, Task.Delay(ImportTimeout)).ConfigureAwait(false);
                return done == tcs.Task ? tcs.Task.Result : Err("TIMEOUT", "Max đích không phản hồi");
            }
            finally { TaskCompletionSource<string> _; _pending.TryRemove(id, out _); }
        }

        // MAXScript trả kết quả qua 2 hàm này (giống MaxWebViewForm)
        public void PostResultJson(string id, string resultJson)
        {
            Complete(id, "{\"ok\":true,\"result\":" + (string.IsNullOrEmpty(resultJson) ? "{}" : resultJson) + "}");
        }

        public void PostError(string id, string code, string message) { Complete(id, Err(code, message)); }

        private void Complete(string id, string envelope)
        {
            TaskCompletionSource<string> tcs;
            if (_pending.TryGetValue(id, out tcs)) tcs.TrySetResult(envelope);
        }

        private string Err(string code, string message)
        {
            return _json.Serialize(new Dictionary<string, object>
            {
                { "ok", false },
                { "error", new Dictionary<string, object> { { "code", code }, { "message", message } } }
            });
        }

        // ---------- phía gửi (hub) ----------

        /// <summary>Gửi lệnh import tới Max pid. Trả về envelope JSON {"ok":..,"result"|"error":..}.
        /// Ném TimeoutException nếu không kết nối được (Max đó đã đóng / chưa có agent) hoặc không phản hồi.</summary>
        public static async Task<string> SendImportAsync(int pid, string id, string path)
        {
            using (var c = new NamedPipeClientStream(".", PipeNameFor(pid), PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                await c.ConnectAsync(3000).ConfigureAwait(false);
                var w = new StreamWriter(c) { AutoFlush = true };
                await w.WriteLineAsync(new JavaScriptSerializer().Serialize(
                    new Dictionary<string, object> { { "id", id }, { "path", path } })).ConfigureAwait(false);
                var read = new StreamReader(c).ReadLineAsync();
                var done = await Task.WhenAny(read, Task.Delay(ImportTimeout + TimeSpan.FromSeconds(15))).ConfigureAwait(false);
                if (done != read) throw new TimeoutException();
                return read.Result;
            }
        }
    }
}
