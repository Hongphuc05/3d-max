using System;
using System.Collections.Generic;
using System.IO;
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
