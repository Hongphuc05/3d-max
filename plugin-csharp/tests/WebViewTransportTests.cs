using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using MaxWebViewHost;

internal static class WebViewTransportTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static int passed;
    private static void Assert(bool condition, string name)
    {
        if (!condition) throw new Exception("FAILED: " + name);
        Console.WriteLine("PASS " + name);
        passed++;
    }

    [STAThread]
    private static void Main()
    {
        Assert(MaxWebViewForm.StartUrl == "https://app.3dsmood.local/", "shipping host starts from the bundled app, without a development server");
        Assert(MaxWebViewForm.IsArchiveDependencyFailure(new FileNotFoundException("dependency", "SharpCompress, Version=0.50.7.0")), "missing archive assembly is classified without exposing its path");
        Assert(MaxWebViewForm.IsArchiveDependencyFailure(new InvalidDataException("wrapped", new FileLoadException("dependency", "System.Memory.dll"))), "wrapped dependency load failures remain actionable");
        Assert(!MaxWebViewForm.IsArchiveDependencyFailure(new FileNotFoundException("package", "package.bin")), "missing model package is not misreported as missing dependency");
        AgentRejectsUnselectedTargets();
        ImportWaitsForPendingTargetRefresh();
        DeviceOperationsDoNotInheritCallerExecutionContext();
        AssetImportFormatPriority();

        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        var origin = "http://localhost:" + port;
        var listener = new HttpListener();
        listener.Prefixes.Add(origin + "/");
        listener.Start();
        var serving = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                try
                {
                    var request = await listener.GetContextAsync();
                    var body = Encoding.UTF8.GetBytes("<!doctype html><title>3DsMood transport test</title><p>Local test fixture</p>");
                    request.Response.ContentType = "text/html; charset=utf-8";
                    request.Response.ContentLength64 = body.Length;
                    await request.Response.OutputStream.WriteAsync(body, 0, body.Length);
                    request.Response.Close();
                }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
            }
        });
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-webview-tests-" + Guid.NewGuid().ToString("N"));
        // Isolate the test browser from the profile of an already-running 3ds Max panel.
        var previousBrowserProfile = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(root, "browser"));
        var keyName = "3DsMood.WebViewTest." + Guid.NewGuid().ToString("N");
        MaxWebViewForm.StartUrl = origin;
        MaxWebViewForm.UsePackagedApp = false;
        MaxWebViewForm.TrustedOrigins = origin;
        var identity = new DeviceIdentityService(root, keyName, true);
        using (var form = new MaxWebViewForm { Opacity = 0, ShowInTaskbar = false })
        {
            typeof(MaxWebViewForm).GetField("_deviceIdentity", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(form, identity);
            form.Shown += async (sender, args) =>
            {
                try
                {
                    var web = (WebView2)typeof(MaxWebViewForm).GetField("_web", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(form);
                    for (var attempt = 0; attempt < 150; attempt++)
                    {
                        if (web.CoreWebView2 != null && !(bool)typeof(MaxWebViewForm).GetField("_navigating", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(form)) break;
                        await Task.Delay(200);
                    }
                    Console.WriteLine("WebView readiness: core=" + (web.CoreWebView2 != null)
                        + ", source=" + (web.CoreWebView2 == null ? "unavailable" : web.CoreWebView2.Source)
                        + ", navigating=" + typeof(MaxWebViewForm).GetField("_navigating", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(form));
                    Assert(web.CoreWebView2 != null && web.CoreWebView2.Source.StartsWith(origin + "/"), "actual WebView2 loads trusted local page");
                    await web.CoreWebView2.ExecuteScriptAsync("window.__responses={};chrome.webview.addEventListener('message',e=>window.__responses[e.data.id]=e.data);");
                    var ownerReply = await Request(web, "owner-info", "host.getInfo", new { });
                    var ownerInfo = (Dictionary<string, object>)ownerReply["result"];
                    Assert(Convert.ToInt32(ownerInfo["processId"]) == System.Diagnostics.Process.GetCurrentProcess().Id && (string)ownerInfo["importTarget"] == "owner", "actual bridge reports this process as the immutable import owner");
                    var info = await Request(web, "identity", "device.getIdentity", new { });
                    Assert((bool)info["ok"], "device.getIdentity crosses actual WebView2 message channel");
                    var result = (Dictionary<string, object>)info["result"];
                    Console.WriteLine("PROVIDER " + result["keyProtection"]);
                    Assert((string)result["keyProtection"] == "TPM" || (string)result["keyProtection"] == "SOFTWARE", "default provider reports its assurance explicitly");
                    Assert(!Json.Serialize(result).Contains("private"), "transport returns public identity only");
                    var challengeId = Guid.NewGuid().ToString();
                    var message = "3DM-DEVICE-V1|" + challengeId + "|" + new string('A', 43) + "|" + Guid.NewGuid()
                        + "|" + result["deviceId"] + "|VERIFY|" + identity.PublicKeyHash();
                    var signed = await Request(web, "signed", "device.signChallenge", new { challengeId, message });
                    Assert((bool)signed["ok"], "device.signChallenge crosses actual WebView2 message channel");
                    var provider = (string)result["keyProtection"] == "TPM"
                        ? new CngProvider("Microsoft Platform Crypto Provider") : CngProvider.MicrosoftSoftwareKeyStorageProvider;
                    using (var key = CngKey.Open(keyName, provider))
                    using (var rsa = new RSACng(key))
                        Assert(rsa.VerifyData(Encoding.UTF8.GetBytes(message), Convert.FromBase64String(
                            (string)((Dictionary<string, object>)signed["result"])["signature"]), HashAlgorithmName.SHA256,
                            RSASignaturePadding.Pkcs1), "transport signature cryptographically verifies");
                    var malformed = await Request(web, "malformed", "device.getIdentity", new { privateKey = "forged" });
                    Assert(!(bool)malformed["ok"] && (string)((Dictionary<string, object>)malformed["error"])["code"] == "INVALID_PARAMS",
                        "transport rejects invalid method schema");
                    var arbitrary = await Request(web, "arbitrary", "device.signChallenge", new { challengeId, message = "arbitrary document" });
                    Assert(!(bool)arbitrary["ok"], "transport refuses arbitrary document signing");
                    var unknown = await Request(web, "unknown", "executeScript", new { });
                    Assert(!(bool)unknown["ok"] && (string)((Dictionary<string, object>)unknown["error"])["code"] == "UNKNOWN_METHOD",
                        "transport rejects unknown method");
                    var source = web.CoreWebView2.Source;
                    web.CoreWebView2.Navigate("file:///C:/Windows/win.ini");
                    await Task.Delay(500);
                    Assert(web.CoreWebView2.Source == source, "untrusted file navigation is cancelled without shell launch");
                    var repeated = await Request(web, "identity-again", "device.getIdentity", new { });
                    Assert((string)((Dictionary<string, object>)repeated["result"])["deviceId"] == (string)result["deviceId"],
                        "identity stays unchanged across transport requests");
                    Console.WriteLine("WebView2 runtime tests passed: " + passed);
                }
                catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
                finally { form.Close(); }
            };
            Application.Run(form);
        }
        listener.Close();
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", previousBrowserProfile);
        foreach (var provider in new[] { new CngProvider("Microsoft Platform Crypto Provider"), CngProvider.MicrosoftSoftwareKeyStorageProvider })
        {
            try { if (CngKey.Exists(keyName, provider)) using (var key = CngKey.Open(keyName, provider)) key.Delete(); }
            catch (CryptographicException) { }
        }
        // Delete only the unique temporary directory made by this test process.
        for (var attempt = 0; Directory.Exists(root) && attempt < 20; attempt++)
        {
            try { Directory.Delete(root, true); }
            catch (IOException) { System.Threading.Thread.Sleep(250); }
            catch (UnauthorizedAccessException) { System.Threading.Thread.Sleep(250); }
        }
    }

    private static void AssetImportFormatPriority()
    {
        var field = typeof(MaxWebViewForm).GetField("ImportExtensions", BindingFlags.NonPublic | BindingFlags.Static);
        var extensions = field == null ? null : (string[])field.GetValue(null);
        Assert(extensions != null && extensions.Length == 3
            && extensions[0] == ".fbx" && extensions[1] == ".obj" && extensions[2] == ".max",
            "asset import prefers FBX and OBJ before MAX when the archive contains alternatives");
    }

    private static void AgentRejectsUnselectedTargets()
    {
        var agent = PlatformAgent.Start();
        var dispatches = 0;
        var documentToken = new string('a', 32);
        agent.SceneRequestReceived += (sender, args) =>
        {
            if (args.Method == "scene.targetInfo")
                agent.PostResultJson(args.Id, Json.Serialize(new { scenePath = @"D:\First\Same.max", documentToken, objectCount = 3, selectedCount = 1 }));
            else dispatches++;
        };
        var pid = System.Diagnostics.Process.GetCurrentProcess().Id;
        var started = System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks;
        using (var pipe = new NamedPipeClientStream(".", PlatformAgent.PipeNameFor(pid), PipeDirection.InOut))
        {
            pipe.Connect(3000);
            var writer = new StreamWriter(pipe) { AutoFlush = true };
            writer.WriteLine(Json.Serialize(new { id = "old-client", path = Path.Combine(PlatformAgent.CacheRoot, "fixture.max") }));
            var reply = Json.Deserialize<Dictionary<string, object>>(new StreamReader(pipe).ReadLine());
            Assert(!(bool)reply["ok"] && (string)((Dictionary<string, object>)reply["error"])["code"] == "INVALID_PARAMS",
                "actual agent pipe rejects legacy imports without explicit target identity");
        }
        var stale = Json.Deserialize<Dictionary<string, object>>(PlatformAgent.SendImportAsync(pid, "stale-target",
            Path.Combine(PlatformAgent.CacheRoot, "fixture.max"), 1, @"D:\First\Same.max", documentToken).GetAwaiter().GetResult());
        Assert(!(bool)stale["ok"] && (string)((Dictionary<string, object>)stale["error"])["code"] == "TARGET_SCENE_CHANGED",
            "actual agent pipe rejects a stale target before scene dispatch");
        Assert(dispatches == 0, "invalid or stale target requests cannot mutate a scene");
        var infoTask = PlatformAgent.ReadSceneTargetAsync(new ImportTarget(pid, started, "Same.max - Autodesk 3ds Max 2022"));
        var wait = System.Diagnostics.Stopwatch.StartNew();
        while (!infoTask.IsCompleted && wait.ElapsedMilliseconds < 5000) { Application.DoEvents(); System.Threading.Thread.Sleep(5); }
        var info = infoTask.GetAwaiter().GetResult();
        Assert(info.ScenePath == @"D:\First\Same.max" && info.DocumentToken == documentToken,
            "actual private agent metadata returns full file path and document generation from the UI adapter");
    }

    private static void ImportWaitsForPendingTargetRefresh()
    {
        var first = new ImportTarget(101, 1001, "Same.max", @"D:\First\Same.max", new string('a', 32));
        var second = new ImportTarget(202, 2002, "Same.max", @"D:\Second\Same.max", new string('b', 32));
        var visible = new[] { first, second };
        var pending = new TaskCompletionSource<ImportTarget>();
        var block = false;
        var resolutions = 0;
        var currentFirst = first;
        var invalidMetadata = false;
        using (var form = new MaxWebViewForm(() => visible, target =>
        {
            Assert(target.IsSameProcess(first), "first plugin never reads another Max process");
            resolutions++;
            return block ? pending.Task : Task.FromResult(invalidMetadata ? second : currentFirst);
        }, first))
        using (var other = new MaxWebViewForm(() => visible, target =>
        {
            Assert(target.IsSameProcess(second), "second plugin never reads the first Max process");
            return Task.FromResult(second);
        }, second))
        {
            Assert(Pump(form.CaptureImportTargetAsync()).ProcessId == 101, "first panel is bound to the Max that opened it even with two Max windows");
            Assert(Pump(other.CaptureImportTargetAsync()).ProcessId == 202, "second panel independently follows its own Max");
            Assert(form.Text.Contains("101") && other.Text.Contains("202") && form.Text != other.Text, "same-named scenes have distinguishable plugin titles using owner PID");
            Assert(form.Text.Contains("Same.max"), "panel title includes the current scene filename");
            foreach (Control control in form.Controls)
                if (control is Panel) foreach (Control child in control.Controls)
                    Assert(!(child is ComboBox), "owner-bound panel exposes no selector for another Max");
            block = true;
            var timerRefresh = form.RefreshTargetsAsync();
            visible = new[] { second, first, new ImportTarget(303, 3003, "Foreign.max") };
            var importing = form.CaptureImportTargetAsync();
            Assert(!importing.IsCompleted, "import awaits an in-flight owner metadata refresh");
            pending.SetResult(first);
            Assert(Pump(importing).ProcessId == 101, "opening or focusing another Max never changes the import owner");
            Assert(resolutions == 2 && timerRefresh.IsCompleted, "concurrent owner refresh callers share pending metadata work");
            block = false;
            currentFirst = new ImportTarget(101, 1001, "Bedroom.max", @"D:\First\Bedroom.max", new string('c', 32));
            var nextScene = Pump(form.CaptureImportTargetAsync());
            Assert(nextScene.IsSameScene(currentFirst) && form.Text.Contains("Bedroom.max"), "opening a new scene in the owning Max updates the panel automatically");
            var validate = typeof(MaxWebViewForm).GetMethod("ValidateSelectedTargetAsync", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert(!Pump((Task<bool>)validate.Invoke(form, new object[] { "old-scene", first })), "an in-flight import captured before a document change is rejected");
            var beforeForeign = resolutions;
            Assert(!Pump((Task<bool>)validate.Invoke(form, new object[] { "foreign", second })) && resolutions == beforeForeign, "foreign-process import validation fails before reading or dispatching to that process");
            visible = new[] { second };
            Assert(Pump(form.CaptureImportTargetAsync()) == null, "missing owner never falls back to the remaining Max");
            visible = new[] { new ImportTarget(101, 9999, first.SceneTitle, first.ScenePath, first.DocumentToken), second };
            Assert(Pump(form.CaptureImportTargetAsync()) == null, "reused owner PID with a different process start cannot inherit the panel");
            visible = new[] { first, second }; invalidMetadata = true;
            Assert(Pump(form.CaptureImportTargetAsync()) == null, "metadata for another process cannot redirect the owner-bound panel");
        }
    }

    private static T Pump<T>(Task<T> task)
    {
        var wait = System.Diagnostics.Stopwatch.StartNew();
        while (!task.IsCompleted && wait.ElapsedMilliseconds < 5000) { Application.DoEvents(); System.Threading.Thread.Sleep(5); }
        if (!task.IsCompleted) throw new TimeoutException("Test UI task did not complete");
        return task.GetAwaiter().GetResult();
    }

    private static void DeviceOperationsDoNotInheritCallerExecutionContext()
    {
        var ambient = new System.Threading.AsyncLocal<string>();
        ambient.Value = "webview-callback-context";
        string observed = "not-run";
        MaxWebViewForm.RunDeviceOperation(() => observed = ambient.Value).GetAwaiter().GetResult();
        Assert(observed == null, "device operations do not inherit the WebView callback execution context");
        ambient.Value = null;
    }

    private static async Task<Dictionary<string, object>> Request(WebView2 web, string id, string method, object parameters)
    {
        var envelope = Json.Serialize(new { id, version = 1, method, @params = parameters });
        await web.CoreWebView2.ExecuteScriptAsync("chrome.webview.postMessage(" + envelope + ");");
        for (var attempt = 0; attempt < 200; attempt++)
        {
            var response = await web.CoreWebView2.ExecuteScriptAsync("window.__responses[" + Json.Serialize(id) + "]||null");
            if (response != "null") return Json.Deserialize<Dictionary<string, object>>(response);
            await Task.Delay(100);
        }
        throw new Exception("Bridge response timed out: " + method);
    }
}
