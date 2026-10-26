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
            if (msg == null) return Err("INVALID_PARAMS", "JSON hỏng");

            object idObj, paramsObj, methodObj, versionObj, startedObj;
            msg.TryGetValue("id", out idObj);
            msg.TryGetValue("params", out paramsObj);
            msg.TryGetValue("method", out methodObj);
            msg.TryGetValue("version", out versionObj);
            msg.TryGetValue("targetStartedTicks", out startedObj);
            var id = idObj as string;
            var parameters = paramsObj as Dictionary<string, object>;
            long started;
            if (id == null || !IdRx.IsMatch(id) || !Equals(versionObj, 2) || parameters == null
                || !long.TryParse(Convert.ToString(startedObj, System.Globalization.CultureInfo.InvariantCulture), out started))
                return Err("INVALID_PARAMS", "Agent cần giao thức chọn scene phiên bản 2. Cập nhật plugin và mở lại tất cả 3ds Max.");
            using (var process = System.Diagnostics.Process.GetCurrentProcess())
                if (process.StartTime.ToUniversalTime().Ticks != started)
                    return Err("TARGET_SCENE_CHANGED", "Process 3ds Max đã chọn đã đóng hoặc khởi động lại.");
            if (Equals(methodObj, "sceneInfo") && parameters.Count == 0)
                return await DispatchSceneAsync(id, "scene.targetInfo", parameters, TimeSpan.FromSeconds(2)).ConfigureAwait(false);

            object pathObj = null;
            object expectedPathObj, expectedTokenObj;
            parameters.TryGetValue("path", out pathObj);
            parameters.TryGetValue("expectedScenePath", out expectedPathObj);
            parameters.TryGetValue("expectedDocumentToken", out expectedTokenObj);
            var path = pathObj as string;
            Guid parsedToken;
            if (!Equals(methodObj, "import") || parameters.Count != 3 || string.IsNullOrEmpty(path)
                || !(expectedPathObj is string) || ((string)expectedPathObj).Length > 4096
                || !(expectedTokenObj is string) || !Guid.TryParseExact((string)expectedTokenObj, "N", out parsedToken))
                return Err("INVALID_PARAMS", "Thiếu định danh document đã chọn.");

            string full;
            try { full = Path.GetFullPath(path); } catch { return Err("INVALID_PARAMS", "Path không hợp lệ"); }
            var root = Path.GetFullPath(CacheRoot) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                || !AllowedExt.Contains(Path.GetExtension(full).ToLowerInvariant())
                || !File.Exists(full))
                return Err("INVALID_PARAMS", "File import không hợp lệ");

            return await DispatchSceneAsync(id, "asset.importFile", new Dictionary<string, object>
            {
                { "path", full }, { "expectedScenePath", expectedPathObj }, { "expectedDocumentToken", expectedTokenObj }
            }, ImportTimeout).ConfigureAwait(false);
        }

        private async Task<string> DispatchSceneAsync(string id, string method, Dictionary<string, object> parameters, TimeSpan timeout)
        {
            var handler = SceneRequestReceived;
            if (handler == null) return Err("HOST_NOT_READY", "Agent chưa có handler");

            var tcs = new TaskCompletionSource<string>();
            if (!_pending.TryAdd(id, tcs)) return Err("INVALID_PARAMS", "Id trùng");
            try
            {
                _ui.BeginInvoke(new Action(() =>
                {
                    try
                    {
                        handler(this, new SceneRequestEventArgs
                        { Id = id, Method = method, ParamsJson = _json.Serialize(parameters), Params = parameters });
                    }
                    catch { tcs.TrySetResult(Err("MAX_OPERATION_FAILED", "Adapter không thực hiện được yêu cầu scene.")); }
                }));
                var done = await Task.WhenAny(tcs.Task, Task.Delay(timeout)).ConfigureAwait(false);
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
        public static Task<string> SendImportAsync(int pid, string id, string path, long targetStartedTicks, string expectedScenePath, string expectedDocumentToken)
        {
            return SendRequestAsync(pid, new Dictionary<string, object>
            {
                { "id", id }, { "version", 2 }, { "method", "import" }, { "targetStartedTicks", targetStartedTicks },
                { "params", new Dictionary<string, object> { { "path", path }, { "expectedScenePath", expectedScenePath }, { "expectedDocumentToken", expectedDocumentToken } } }
            }, ImportTimeout + TimeSpan.FromSeconds(15));
        }

        public static Task<string> SendSceneInfoAsync(int pid, long targetStartedTicks)
        {
            return SendRequestAsync(pid, new Dictionary<string, object>
            {
                { "id", Guid.NewGuid().ToString("N") }, { "version", 2 }, { "method", "sceneInfo" },
                { "targetStartedTicks", targetStartedTicks }, { "params", new Dictionary<string, object>() }
            }, TimeSpan.FromSeconds(3));
        }

        internal static async Task<ImportTarget> ReadSceneTargetAsync(ImportTarget process)
        {
            var reply = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                await SendSceneInfoAsync(process.ProcessId, process.StartedTicks).ConfigureAwait(false));
            object ok, value;
            if (reply == null || !reply.TryGetValue("ok", out ok) || !Equals(ok, true) || !reply.TryGetValue("result", out value))
                throw new InvalidDataException("Target agent metadata unavailable.");
            var result = value as Dictionary<string, object>;
            object path, token;
            Guid parsed;
            if (result == null || !result.TryGetValue("scenePath", out path) || !(path is string) || ((string)path).Length > 4096
                || !result.TryGetValue("documentToken", out token) || !(token is string) || !Guid.TryParseExact((string)token, "N", out parsed))
                throw new InvalidDataException("Target agent metadata invalid.");
            return new ImportTarget(process.ProcessId, process.StartedTicks, process.SceneTitle, (string)path, (string)token);
        }

        private static async Task<string> SendRequestAsync(int pid, Dictionary<string, object> request, TimeSpan timeout)
        {
            using (var c = new NamedPipeClientStream(".", PipeNameFor(pid), PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                await c.ConnectAsync(1000).ConfigureAwait(false);
                var w = new StreamWriter(c) { AutoFlush = true };
                await w.WriteLineAsync(new JavaScriptSerializer().Serialize(request)).ConfigureAwait(false);
                var read = new StreamReader(c).ReadLineAsync();
                var done = await Task.WhenAny(read, Task.Delay(timeout)).ConfigureAwait(false);
                if (done != read) throw new TimeoutException();
                return read.Result;
            }
        }
    }
}
