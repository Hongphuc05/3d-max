using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using MaxWebViewHost;
#if WEBVIEW
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
#endif

internal static class OfflineIntegrationTests
{
    private static int passed;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Check(bool ok, string name)
    { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); passed++; }
    private static void Reject(Action action, string name)
    { try { action(); } catch (InvalidDataException) { Check(true, name); return; } throw new Exception(name); }
    private static void Configure(string root, string url, string key)
    {
        Directory.CreateDirectory(Path.Combine(root, "library"));
        File.WriteAllText(Path.Combine(root, "library", "catalog.json"), "{\"version\":1,\"items\":[]}");
        File.WriteAllText(Path.Combine(root, "plugin-config.json"), Json.Serialize(new { licensePublicKeyXml = key }));
    }
    private static bool Parse(string method, object parameters)
    {
        Dictionary<string, object> message; string code;
        return BridgePolicy.TryParse(Json.Serialize(new { id = "offline-test", version = 1, method, @params = parameters }), out message, out code);
    }

    [STAThread]
    private static void Main()
    {
        using (var handler = SecureHttpTransport.CreateHandler(false, false))
            Check(handler.SslProtocols == SslProtocols.Tls12, "HTTPS transport requires TLS 1.2");
#if WEBVIEW
        RunWebView();
        return;
#else
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-offline-integration-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "app"));
        File.WriteAllText(Path.Combine(root, "app", "index.html"), "<!doctype html><title>Offline app</title>");
        try
        {
            using (var rsa = new RSACryptoServiceProvider(2048))
            {
                rsa.PersistKeyInCsp = false;
                var publicKey = rsa.ToXmlString(false);
                const string catalog = "https://example.github.io/library/catalog.json";
                Configure(root, catalog, publicKey);
                var config = PluginConfiguration.Load(root);
                Check(config.IsOfflineLibrary, "catalog config selects offline library without backend");
                Check(config.LibraryDirectory == Path.Combine(root, "library"), "bundled catalog path preserved");
                Check(config.LicensePublicKeyXml == publicKey, "public verification key preserved");
                Check(config.ApiBaseUri == null, "offline library needs no backend API");
                Check(config.AppDirectory == Path.Combine(root, "app"), "existing packaged application reused");
                foreach (var key in new[] { null, "", "not RSA XML", "<RSAKeyValue><Modulus>AQ==</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>", rsa.ToXmlString(true) })
                {
                    Configure(root, catalog, key);
                    Reject(() => PluginConfiguration.Load(root), "missing, malformed, weak or private key rejected");
                }
                Configure(root, catalog, publicKey);
                File.Delete(Path.Combine(root, "library", "catalog.json"));
                Reject(() => PluginConfiguration.Load(root), "missing bundled catalog rejected");
                Configure(root, catalog, publicKey);
                File.Delete(Path.Combine(root, "app", "index.html"));
                Reject(() => PluginConfiguration.Load(root), "missing bundled UI rejected");
            }
            Check(Parse("library.status", new { }), "offline license status accepted");
            Check(Parse("library.refresh", new { }), "catalog refresh accepted");
            Check(Parse("library.activate", new { license = "signed-license-token" }), "license activation accepted");
            Check(Parse("asset.import", new { assetId = "chair-001" }), "model ID only import accepted");
            Check(!Parse("library.status", new { url = "https://evil.test" }), "status cannot inject network URL");
            Check(!Parse("library.refresh", new { path = "C:/Windows" }), "refresh cannot inject file path");
            Check(!Parse("library.activate", new { license = "" }), "empty activation rejected");
            Check(!Parse("library.activate", new { license = new string('a', 12001) }), "oversized activation rejected");
            Check(!Parse("library.activate", new { license = "token", machineCode = "other-machine" }), "activation cannot override native machine code");
            Check(!Parse("asset.import", new { assetId = "../model" }), "import path traversal rejected");
            Check(!Parse("asset.import", new { assetId = "chair", url = "https://evil.test/file" }), "import arbitrary URL rejected");
            Check(!Parse("asset.import", new { assetId = "chair", ticket = "legacy-ticket-value" }), "obsolete ticket cannot alter offline import");
            Console.WriteLine("Offline integration tests passed: " + passed);
        }
        finally { Directory.Delete(root, true); }
#endif
    }
#if WEBVIEW
    private static object Field(object target, string name)
    { return target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target); }

    private static void RunWebView()
    {
        var root = Path.GetDirectoryName(typeof(OfflineIntegrationTests).Assembly.Location);
        var data = Path.Combine(Path.GetTempPath(), "3DsMood-offline-ui-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "app"));
        File.WriteAllText(Path.Combine(root, "app", "index.html"), "<!doctype html><title>Offline packaged library fixture</title><p id='loaded'>Library available offline</p>");
        string key, license, otherLicense;
        using (var rsa = new RSACryptoServiceProvider(2048))
        {
            rsa.PersistKeyInCsp = false;
            key = rsa.ToXmlString(false);
            license = Sign(rsa, "MAX-" + new string('A', 64));
            otherLicense = Sign(rsa, "MAX-" + new string('B', 64));
        }
        Configure(root, "https://offline-library.invalid/catalog.json", key);
        var previousProfile = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(data, "browser"));
        MaxWebViewForm.UsePackagedApp = true;
        MaxWebViewForm.StartUrl = PackagedAppRuntime.StartUrl;
        MaxWebViewForm.TrustedOrigins = PackagedAppRuntime.AppOrigin;
        using (var form = new MaxWebViewForm(() => new ImportTarget[0], target => Task.FromResult(target)) { Opacity = 0, ShowInTaskbar = false })
        {
            form.Shown += async (sender, args) =>
            {
                try
                {
                    var web = (WebView2)Field(form, "_web");
                    for (var attempt = 0; attempt < 150; attempt++)
                    {
                        if (web.CoreWebView2 != null && web.CoreWebView2.Source == PackagedAppRuntime.StartUrl && !(bool)Field(form, "_navigating")) break;
                        await Task.Delay(200);
                    }
                    Check(web.CoreWebView2 != null && web.CoreWebView2.Source == PackagedAppRuntime.StartUrl, "actual host loads bundled library without a backend");
                    Check(await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('loaded')?.textContent") == "\"Library available offline\"", "bundled UI renders offline");
                    var service = new OfflineLicenseService(key, Path.Combine(data, "licenses"), "MAX-" + new string('A', 64));
                    typeof(MaxWebViewForm).GetField("_offlineLicense", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, service);
                    await web.CoreWebView2.ExecuteScriptAsync("window.__responses={};chrome.webview.addEventListener('message',e=>window.__responses[e.data.id]=e.data);");
                    var status = await Request(web, "status", "library.status", new { });
                    Check((bool)status["ok"], "offline status crosses actual WebView bridge");
                    var result = (Dictionary<string, object>)status["result"];
                    Check((string)result["machineCode"] == service.MachineCode && !(bool)result["licensed"], "native machine code available without license or network");
                    var invalid = await Request(web, "invalid-license", "library.activate", new { license = "invalid-license" });
                    Check(!(bool)invalid["ok"], "actual bridge rejects invalid license");
                    var other = await Request(web, "other-machine", "library.activate", new { license = otherLicense });
                    Check(!(bool)other["ok"], "actual bridge rejects valid signature for another machine");
                    var activated = await Request(web, "valid-license", "library.activate", new { license });
                    Check((bool)activated["ok"] && (bool)((Dictionary<string, object>)activated["result"])["licensed"], "actual bridge activates owner-signed permanent license offline");
                    var reopened = new OfflineLicenseService(key, Path.Combine(data, "licenses"), service.MachineCode);
                    typeof(MaxWebViewForm).GetField("_offlineLicense", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, reopened);
                    var restored = await Request(web, "restored", "library.status", new { });
                    Check((bool)((Dictionary<string, object>)restored["result"])["licensed"], "saved permanent license restores without network");
                    await ((Task)typeof(MaxWebViewForm).GetMethod("MonitorConnectionAsync", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, null));
                    Check(!((Panel)Field(form, "_connectionPanel")).Visible && web.Visible, "connection monitor keeps offline library visible");
                    await web.CoreWebView2.ExecuteScriptAsync("window.__api=null;fetch('/api/auth/me').then(r=>window.__api=r.status).catch(()=>window.__api=0);");
                    string api = "null";
                    for (var attempt = 0; attempt < 100 && api == "null"; attempt++) { api = await web.CoreWebView2.ExecuteScriptAsync("window.__api"); await Task.Delay(50); }
                    Check(api == "403" || api == "404", "offline runtime rejects legacy backend proxy requests locally");
                    var runtime = (PackagedAppRuntime)Field(form, "_packagedApp");
                    var previewKey = new string('a', 64) + ".png";
                    runtime.PreviewLoader = (requested, ct) => Task.FromResult(requested == previewKey
                        ? new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 } : throw new InvalidDataException("Unknown preview"));
                    await web.CoreWebView2.ExecuteScriptAsync("window.__preview=null;fetch('/library-previews/" + previewKey + "?v=1').then(async r=>window.__preview=[r.status,r.headers.get('content-type'),(await r.arrayBuffer()).byteLength]).catch(()=>window.__preview=false);");
                    string preview = "null";
                    for (var attempt = 0; attempt < 100 && preview == "null"; attempt++) { preview = await web.CoreWebView2.ExecuteScriptAsync("window.__preview"); await Task.Delay(50); }
                    Check(preview == "[200,\"image/png\",8]", "cached preview is served through actual WebView with image content type");
                    Console.WriteLine("Offline packaged WebView tests passed: " + passed);
                }
                catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
                finally { form.Close(); }
            };
            Application.Run(form);
        }
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", previousProfile);
        // WebView may retain profile handles briefly; never touch the user's real profile.
        for (var attempt = 0; Directory.Exists(data) && attempt < 20; attempt++)
        {
            try { Directory.Delete(data, true); }
            catch (IOException) { System.Threading.Thread.Sleep(100); }
            catch (UnauthorizedAccessException) { System.Threading.Thread.Sleep(100); }
        }
    }

    private static async Task<Dictionary<string, object>> Request(WebView2 web, string id, string method, object parameters)
    {
        await web.CoreWebView2.ExecuteScriptAsync("chrome.webview.postMessage(" + Json.Serialize(new { id, version = 1, method, @params = parameters }) + ");");
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var response = await web.CoreWebView2.ExecuteScriptAsync("window.__responses[" + Json.Serialize(id) + "] || null");
            if (response != "null") return Json.Deserialize<Dictionary<string, object>>(response);
            await Task.Delay(100);
        }
        throw new Exception("Offline bridge timed out: " + method);
    }

    private static string Sign(RSACryptoServiceProvider rsa, string machineCode)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(Json.Serialize(new { version = 1, product = "3dsmood-library", machineCode, licenseId = "offline-ui-test" }));
        Func<byte[], string> encode = value => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return "MXL1." + encode(bytes) + "." + encode(rsa.SignData(bytes, CryptoConfig.MapNameToOID("SHA256")));
    }
#endif
}
