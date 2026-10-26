using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using MaxWebViewHost;

internal static class PackagedWebViewTests
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0) return Child(args[0], args[1]);
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-packaged-webview-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "app"));
        File.WriteAllText(Path.Combine(root, "app", "index.html"), "<!doctype html><title>Installed test app</title><p>Bundled client</p>");
        var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
        var origin = "http://localhost:" + port;
        File.WriteAllText(Path.Combine(root, "plugin-config.json"), "{\"apiBaseUrl\":\"" + origin + "\",\"allowLoopbackForTesting\":true}");
        var listener = new HttpListener(); listener.Prefixes.Add(origin + "/"); listener.Start();
        var serve = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                try
                {
                    var context = await listener.GetContextAsync();
                    var path = context.Request.Url.AbsolutePath;
                    var body = "{}";
                    if (path == "/api/health") body = "{\"ok\":true}";
                    else if (path == "/api/auth/login") { context.Response.AppendHeader("Set-Cookie", "sid=packaged-session-test; Path=/; HttpOnly; Max-Age=3600"); body = "{\"ok\":true}"; }
                    else if (path == "/api/auth/me") body = context.Request.Cookies["sid"]?.Value == "packaged-session-test" ? "{\"authenticated\":true}" : "{\"authenticated\":false}";
                    else if (path == "/api/auth/logout") context.Response.AppendHeader("Set-Cookie", "sid=; Path=/; Max-Age=0");
                    else if (path == "/api/delay")
                    {
                        _ = Task.Run(async () => { try { await Task.Delay(5000); context.Response.Close(); } catch { } });
                        continue;
                    }
                    else context.Response.StatusCode = 404;
                    var bytes = Encoding.UTF8.GetBytes(body); context.Response.ContentType = "application/json"; context.Response.ContentLength64 = bytes.Length;
                    await context.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length); context.Response.Close();
                }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
            }
        });
        try
        {
            foreach (var phase in new[] { "login", "restore", "logout-restored", "cancel", "login" }) Run(root, phase);
            listener.Close();
            Run(root, "offline-logout");
            Run(root, "offline");
            Console.WriteLine("PASS packaged app independent-process login restore/logout and offline checks");
            return 0;
        }
        finally { listener.Close(); }
    }

    private static void Run(string root, string phase)
    {
        var info = new ProcessStartInfo(typeof(PackagedWebViewTests).Assembly.Location, "\"" + root + "\" " + phase)
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (var process = Process.Start(info))
        {
            if (!process.WaitForExit(60000)) { process.Kill(); throw new Exception("Packaged WebView child timed out: " + phase); }
            Console.WriteLine(process.StandardOutput.ReadToEnd());
            Console.WriteLine(process.StandardError.ReadToEnd());
            if (process.ExitCode != 0) throw new Exception("Packaged WebView phase failed: " + phase);
        }
    }

    private static int Child(string root, string phase)
    {
        int exit = 0;
        using (var form = new Form { Width = 400, Height = 300, Opacity = 0, ShowInTaskbar = false })
        using (var web = new WebView2 { Dock = DockStyle.Fill })
        {
            form.Controls.Add(web);
            form.Shown += async (s, e) =>
            {
                try
                {
                    var config = PluginConfiguration.Load(root);
                    var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "browser"));
                    await web.EnsureCoreWebView2Async(env);
                    using (var runtime = new PackagedAppRuntime(config, web.CoreWebView2, Path.Combine(root, "sessions")))
                    {
                        await runtime.ConfigureAsync();
                        web.CoreWebView2.WebResourceRequested += (a, r) => Console.WriteLine("Test requested " + r.Request.Uri);
                        web.CoreWebView2.WebResourceResponseReceived += (a, r) => Console.WriteLine("Test response " + r.Request.Uri + " " + r.Response.StatusCode);
                        var connected = await runtime.CheckConnectionAsync(CancellationToken.None);
                        if (phase == "offline") { if (connected) throw new Exception("Offline health unexpectedly accepted"); Console.WriteLine("PASS unavailable backend fails health gate"); return; }
                        if (!connected && phase != "offline-logout") throw new Exception("Backend health failed");
                        var loaded = new TaskCompletionSource<bool>();
                        web.CoreWebView2.NavigationCompleted += (a, n) => { Console.WriteLine("Navigation " + web.CoreWebView2.Source + " success=" + n.IsSuccess + " status=" + n.WebErrorStatus); loaded.TrySetResult(n.IsSuccess); };
                        web.CoreWebView2.Navigate(PackagedAppRuntime.StartUrl);
                        if (!await loaded.Task) throw new Exception("Bundled navigation failed");
                        if (phase == "cancel")
                        {
                            await web.CoreWebView2.ExecuteScriptAsync("fetch('/api/delay').catch(()=>{});");
                            await Task.Delay(300);
                            runtime.Dispose();
                            await Task.Delay(750);
                        }
                        else if (phase == "offline-logout")
                        {
                            await Evaluate(web, "return (await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status===503;", true);
                            if (new SessionCookieStore(Path.Combine(root, "sessions"), config.ApiBaseUri).Load().Count != 0) throw new Exception("Offline logout retained session");
                        }
                        else if (phase == "login") await Evaluate(web, "await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()); return (await fetch('/api/auth/me').then(r=>r.json())).authenticated;", true);
                        else if (phase == "restore")
                        {
                            await Evaluate(web, "return (await fetch('/api/auth/me').then(r=>r.json())).authenticated;", true);
                            await Evaluate(web, "await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); return (await fetch('/api/auth/me').then(r=>r.json())).authenticated;", false);
                        }
                        else await Evaluate(web, "return (await fetch('/api/auth/me').then(r=>r.json())).authenticated;", false);
                        Console.WriteLine("PASS actual bundled WebView " + phase);
                    }
                }
                catch (Exception error) { Console.Error.WriteLine(error); exit = 1; }
                finally { form.Close(); }
            };
            Application.Run(form);
        }
        return exit;
    }

    private static async Task Evaluate(WebView2 web, string script, bool expected)
    {
        await web.CoreWebView2.ExecuteScriptAsync("window.__outcome=null;(async()=>{" + script + "})().then(r=>window.__outcome={value:r},e=>window.__outcome={error:String(e)});");
        for (int i = 0; i < 200; i++)
        {
            var result = await web.CoreWebView2.ExecuteScriptAsync("window.__outcome");
            if (result != "null")
            {
                if (result != "{\"value\":" + (expected ? "true" : "false") + "}") throw new Exception("Unexpected fixture result: " + result);
                return;
            }
            await Task.Delay(100);
        }
        throw new Exception("API proxy timed out");
    }
}
