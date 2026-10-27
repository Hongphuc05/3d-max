using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using MaxWebViewHost;
using Microsoft.Web.WebView2.WinForms;

internal static class ImportPipelineTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static int passed;
    private static void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS " + message); passed++; }
    private static object Field(object target, string name) { return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target); }
    private static void Set(object target, string name, object value) { target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value); }
    private sealed class Handler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Reply;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation) { return Task.FromResult(Reply(request)); }
    }
    private static string Signed(RSACryptoServiceProvider rsa, string machine)
    {
        var bytes = Encoding.UTF8.GetBytes(Json.Serialize(new { version = 1, product = "3dsmood-library", machineCode = machine, licenseId = "pipeline-test" }));
        Func<byte[], string> b64 = value => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return "MXL1." + b64(bytes) + "." + b64(rsa.SignData(bytes, CryptoConfig.MapNameToOID("SHA256")));
    }
    private static byte[] Zip()
    {
        using (var stream = new MemoryStream())
        {
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, true))
                foreach (var name in new[] { "model/scene.max", "model/maps/wood.jpg" })
                    using (var writer = new StreamWriter(archive.CreateEntry(name).Open())) writer.Write("fixture " + name);
            return stream.ToArray();
        }
    }
    private static async Task<Dictionary<string, object>> Request(WebView2 web, string id, string method, object parameters)
    {
        await web.CoreWebView2.ExecuteScriptAsync("chrome.webview.postMessage(" + Json.Serialize(new { id, version = 1, method, @params = parameters }) + ");");
        for (var attempt = 0; attempt < 150; attempt++)
        {
            var response = await web.CoreWebView2.ExecuteScriptAsync("window.__responses[" + Json.Serialize(id) + "] || null");
            if (response != "null") return Json.Deserialize<Dictionary<string, object>>(response);
            await Task.Delay(100);
        }
        throw new Exception("Bridge timed out: " + id);
    }
    [STAThread] private static void Main()
    {
        var assemblyRoot = Path.GetDirectoryName(typeof(ImportPipelineTests).Assembly.Location);
        var data = Path.Combine(Path.GetTempPath(), "3DsMood-pipeline-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(data); Directory.CreateDirectory(Path.Combine(assemblyRoot, "app"));
        File.WriteAllText(Path.Combine(assemblyRoot, "app", "index.html"), "<!doctype html><title>Pipeline fixture</title>");
        var zip = Zip(); string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(zip)).Replace("-", "").ToLowerInvariant();
        var catalogJson = Json.Serialize(new { version = 1, items = new[] { new { id = "fixture-1", name = "Fixture", category = "Test", preview = "previews/test.png", driveFileId = "test_id_123456", fileName = "fixture.zip", sha256 = hash, entryFile = "model/scene.max" } } });
        const string machine = "MAX-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        string publicKey, license;
        using (var rsa = new RSACryptoServiceProvider(2048)) { rsa.PersistKeyInCsp = false; publicKey = rsa.ToXmlString(false); license = Signed(rsa, machine); }
        var library = Path.Combine(assemblyRoot, "library");
        Directory.CreateDirectory(library);
        File.WriteAllText(Path.Combine(library, "catalog.json"), catalogJson);
        File.WriteAllText(Path.Combine(assemblyRoot, "plugin-config.json"), Json.Serialize(new { licensePublicKeyXml = publicKey }));
        var identity = new OfflineLicenseService(publicKey, Path.Combine(data, "license"), machine);
        var catalog = new StaticCatalogService(library);
        catalog.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
        int requests = 0, dispatches = 0, reads = 0; bool corrupt = false, sceneChanges = false, present = true;
        var process = Process.GetCurrentProcess();
        var selected = new ImportTarget(process.Id, process.StartTime.ToUniversalTime().Ticks, "fixture", "C:\\fixture.max", Guid.NewGuid().ToString("N"));
        var stale = new ImportTarget(selected.ProcessId, selected.StartedTicks, "fixture", "C:\\fixture.max", Guid.NewGuid().ToString("N"));
        var profile = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(data, "browser"));
        MaxWebViewForm.UsePackagedApp = true;
        string retainedDirectory = null;
        using (var form = new MaxWebViewForm(() => present ? new[] { selected } : new ImportTarget[0],
            target => Task.FromResult(sceneChanges && ++reads >= 3 ? stale : target),
            () => new GoogleDriveDownloader(new HttpClient(new Handler { Reply = r => { Interlocked.Increment(ref requests); return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(corrupt ? Encoding.UTF8.GetBytes("wrong") : zip) }; } }))) { Opacity = 0, ShowInTaskbar = false })
        {
            form.SceneRequestReceived += (sender, args) => {
                if (args.Method != "asset.importFile") return;
                dispatches++;
                var path = args.Param("path");
                Check(File.Exists(path) && File.Exists(Path.Combine(Path.GetDirectoryName(path), "maps", "wood.jpg")), "archive content and texture exist at scene dispatch");
                Check(args.Param("expectedDocumentToken") == selected.DocumentToken, "dispatch retains selected document token");
                retainedDirectory = Directory.GetParent(Directory.GetParent(Path.GetDirectoryName(path)).FullName).FullName;
                form.PostResultJson(args.Id, "{\"imported\":1}");
            };
            form.Shown += async (sender, args) => {
                try {
                    var web = (WebView2)Field(form, "_web");
                    for (var i = 0; i < 150 && (web.CoreWebView2 == null || (bool)Field(form, "_navigating")); i++) await Task.Delay(200);
                    Check(web.CoreWebView2 != null && !(bool)Field(form, "_navigating"), "real packaged WebView ready");
                    var oldCatalog = (StaticCatalogService)Field(form, "_catalog"); Set(form, "_catalog", catalog); oldCatalog.Dispose();
                    Set(form, "_offlineLicense", identity);
                    await web.CoreWebView2.ExecuteScriptAsync("window.__responses={};chrome.webview.addEventListener('message',e=>{if(e.data.type!=='asset.progress')window.__responses[e.data.id]=e.data;});");
                    var rejected = await Request(web, "unlicensed", "asset.import", new { assetId = "fixture-1" });
                    Check(!(bool)rejected["ok"] && (string)((Dictionary<string, object>)rejected["error"])["code"] == "LICENSE_REQUIRED" && requests == 0 && dispatches == 0, "unlicensed import never fetches or dispatches");
                    identity.Activate(license); corrupt = true;
                    var badHash = await Request(web, "bad-hash", "asset.import", new { assetId = "fixture-1" });
                    Check(!(bool)badHash["ok"] && (string)((Dictionary<string, object>)badHash["error"])["code"] == "ASSET_DOWNLOAD_FAILED" && requests == 1 && dispatches == 0, "invalid checksum never dispatches");
                    corrupt = false; reads = 0; sceneChanges = true;
                    var changed = await Request(web, "scene-changed", "asset.import", new { assetId = "fixture-1" });
                    Check(!(bool)changed["ok"] && (string)((Dictionary<string, object>)changed["error"])["code"] == "TARGET_SCENE_CHANGED"
                        && requests == 2 && dispatches == 0, "scene change after download before dispatch fails closed");
                    sceneChanges = false; reads = 0;
                    var result = await Request(web, "success", "asset.import", new { assetId = "fixture-1" });
                    Check((bool)result["ok"] && requests == 3 && dispatches == 1, "licensed ID-only import downloads and dispatches verified archive");
                    present = false;
                    var noTarget = await Request(web, "no-target", "asset.import", new { assetId = "fixture-1" });
                    Check(!(bool)noTarget["ok"] && requests == 3 && dispatches == 1, "missing target blocks download and dispatch");
                    Console.WriteLine("Import pipeline tests passed: " + passed);
                } catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
                finally { form.Close(); }
            };
            Application.Run(form);
        }
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", profile);
        Guid ownedId;
        if (retainedDirectory != null && Path.GetDirectoryName(retainedDirectory) == PlatformAgent.CacheRoot
            && Guid.TryParseExact(Path.GetFileName(retainedDirectory), "N", out ownedId) && Directory.Exists(retainedDirectory))
            Directory.Delete(retainedDirectory, true);
        // Browser processes may briefly retain files; only remove this harness's GUID directory.
        for (var attempt = 0; Directory.Exists(data) && attempt < 20; attempt++)
        {
            try { Directory.Delete(data, true); }
            catch (IOException) { Thread.Sleep(100); }
            catch (UnauthorizedAccessException) { Thread.Sleep(100); }
        }
    }
}
