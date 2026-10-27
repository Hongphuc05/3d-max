using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

namespace MaxWebViewHost
{
    /// <summary>Serves the installed application and forwards its fixed API routes to the configured server.</summary>
    public sealed class PackagedAppRuntime : IDisposable
    {
        public const string AppOrigin = "https://app.3dsmood.local";
        public const string StartUrl = AppOrigin + "/";
        private readonly PluginConfiguration configuration;
        private readonly CoreWebView2 core;
        private readonly SessionCookieStore sessions;
        private readonly HttpClient http = SecureHttpTransport.CreateClient(false, false, TimeSpan.FromSeconds(20));
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private bool disposed;
        internal Func<string, CancellationToken, Task<byte[]>> PreviewLoader { get; set; }

        public PackagedAppRuntime(PluginConfiguration configuration, CoreWebView2 core)
            : this(configuration, core, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MaxWebViewHost", "Sessions", "v1")) { }

        internal PackagedAppRuntime(PluginConfiguration configuration, CoreWebView2 core, string sessionDirectory)
        {
            this.configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            this.core = core ?? throw new ArgumentNullException(nameof(core));
            if (!configuration.IsOfflineLibrary) sessions = new SessionCookieStore(sessionDirectory, configuration.ApiBaseUri);
        }

        public async Task ConfigureAsync()
        {
            // An origin-wide responder is required: WebView's virtual-folder loader resolves
            // mapped API paths before WebResourceRequested and cannot be used as an API proxy.
            core.AddWebResourceRequestedFilter(AppOrigin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnRequest;
            if (!configuration.IsOfflineLibrary) SynchronizeBrowserCookies(await WithoutCallerContext(() => sessions.Load()));
        }

        public async Task<bool> CheckConnectionAsync(CancellationToken cancellationToken)
        {
            if (configuration.IsOfflineLibrary) return true;
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, lifetime.Token))
            {
            deadline.CancelAfter(TimeSpan.FromSeconds(20));
            try
            {
                using (var response = await http.GetAsync(new Uri(configuration.ApiBaseUri, "api/health"), HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) return false;
                    var bytes = await ReadBoundedAsync(await response.Content.ReadAsStreamAsync().ConfigureAwait(false), 16384, deadline.Token).ConfigureAwait(false);
                    var result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes));
                    object ok;
                    return result != null && result.TryGetValue("ok", out ok) && ok is bool && (bool)ok;
                }
            }
            catch (Exception e) when (e is HttpRequestException || e is OperationCanceledException || e is IOException || e is ArgumentException || e is InvalidOperationException)
            { return false; }
            }
        }

        internal static bool IsProxyRequest(string url, string method)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != AppOrigin
                || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return false;
            var path = uri.AbsolutePath;
            if (path.IndexOf("%2f", StringComparison.OrdinalIgnoreCase) >= 0 || path.IndexOf("%5c", StringComparison.OrdinalIgnoreCase) >= 0
                || path.Contains("\\") || path.Contains("//")) return false;
            return path.StartsWith("/api/", StringComparison.Ordinal) && new[] { "GET", "POST", "PATCH", "PUT", "DELETE" }.Contains(method)
                || path.StartsWith("/previews/", StringComparison.Ordinal) && method == "GET";
        }

        private async void OnRequest(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            if (disposed) return;
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
            deadline.CancelAfter(TimeSpan.FromSeconds(20));
            var deferral = args.GetDeferral();
            try
            {
                var request = args.Request;
                if (configuration.IsOfflineLibrary)
                {
                    Uri previewUri, documentUri;
                    if (request.Method == "GET" && PreviewLoader != null
                        && Uri.TryCreate(request.Uri, UriKind.Absolute, out previewUri)
                        && previewUri.GetLeftPart(UriPartial.Authority) == AppOrigin
                        && previewUri.AbsolutePath.StartsWith("/library-previews/", StringComparison.Ordinal)
                        && Uri.TryCreate(core.Source, UriKind.Absolute, out documentUri)
                        && documentUri.GetLeftPart(UriPartial.Authority) == AppOrigin)
                    {
                        var key = previewUri.AbsolutePath.Substring("/library-previews/".Length);
                        // Each network fetch has its own timeout. Keep this request alive
                        // to serve cached bytes after a timeout or waiting for a free slot.
                        var bytes = await PreviewLoader(key, lifetime.Token);
                        if (disposed) return;
                        var ext = Path.GetExtension(key);
                        var mime = ext == ".png" ? "image/png" : ext == ".webp" ? "image/webp" : "image/jpeg";
                        args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                            "Content-Type: " + mime + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
                        return;
                    }
                    // Customer mode has no remote API or account session.
                    args.Response = LocalAsset(request.Uri, request.Method);
                    return;
                }
                if (!IsProxyRequest(request.Uri, request.Method))
                {
                    args.Response = LocalAsset(request.Uri, request.Method);
                    return;
                }
                Uri document;
                var origin = request.Headers.Contains("Origin") ? request.Headers.GetHeader("Origin") : null;
                if (!IsProxyRequest(request.Uri, request.Method)
                    || !Uri.TryCreate(core.Source, UriKind.Absolute, out document) || document.GetLeftPart(UriPartial.Authority) != AppOrigin
                    || (origin != null && origin != AppOrigin))
                { args.Response = Response(403, "{\"error\":\"ORIGIN_NOT_ALLOWED\"}"); return; }
                var local = new Uri(request.Uri);
                using (var upstream = new HttpRequestMessage(new HttpMethod(request.Method), new Uri(configuration.ApiBaseUri, local.PathAndQuery)))
                {
                    // Native requests omit browser Origin intentionally: only the installed application
                    // can enter this bridge, and the remote server need not allow a synthetic CORS origin.
                    var stored = await WithoutCallerContext(() => sessions.Load());
                    if (request.Method == "POST" && local.AbsolutePath == "/api/auth/logout")
                    {
                        await WithoutCallerContext(() => { sessions.Apply(new[] { "sid=; Path=/; Max-Age=0", "dsid=; Path=/; Max-Age=0" }); return true; });
                        if (disposed) return;
                        SynchronizeBrowserCookies(new List<StoredSessionCookie>());
                    }
                    if (stored.Count > 0) upstream.Headers.TryAddWithoutValidation("Cookie", string.Join("; ", stored.Select(c => c.Name + "=" + c.Value)));
                    if (request.Content != null)
                    {
                        var body = await ReadBoundedAsync(request.Content, 10240, deadline.Token);
                        upstream.Content = new ByteArrayContent(body);
                        upstream.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                    }
                    using (var response = await http.SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead, deadline.Token))
                    {
                        if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
                        { args.Response = Response(502, "{\"error\":\"SERVER_REDIRECT_REJECTED\"}"); return; }
                        if (response.Content.Headers.ContentType?.MediaType == "text/event-stream")
                        { args.Response = Response(503, "{\"error\":\"USE_CATALOG_POLLING\"}"); return; }
                        IEnumerable<string> cookies;
                        if (response.Headers.TryGetValues("Set-Cookie", out cookies))
                        {
                            var snapshot = cookies.ToArray();
                            await WithoutCallerContext(() => { sessions.Apply(snapshot); return true; });
                            if (disposed) return;
                            SynchronizeBrowserCookies(await WithoutCallerContext(() => sessions.Load()));
                        }
                        var bytes = await ReadBoundedAsync(await response.Content.ReadAsStreamAsync(),
                            local.AbsolutePath.StartsWith("/previews/", StringComparison.Ordinal) ? 32 * 1024 * 1024 : 8 * 1024 * 1024, deadline.Token);
                        var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
                        if (disposed) return;
                        args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(bytes), (int)response.StatusCode,
                            "Response", "Content-Type: " + contentType + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
                    }
                }
            }
            catch (Exception e) when (!(e is OutOfMemoryException) && !(e is StackOverflowException))
            {
                if (!disposed)
                {
                    try { args.Response = Response(503, "{\"error\":\"CONNECTION_REQUIRED\"}"); }
                    catch (Exception responseError) when (responseError is InvalidOperationException || responseError is ObjectDisposedException
                        || responseError is System.Runtime.InteropServices.COMException) { }
                }
            }
            finally
            {
                try { deferral.Complete(); }
                catch (Exception e) when (e is InvalidOperationException || e is ObjectDisposedException || e is System.Runtime.InteropServices.COMException) { }
            }
            }
        }

        private void SynchronizeBrowserCookies(List<StoredSessionCookie> stored)
        {
            foreach (var name in new[] { "sid", "dsid" })
            {
                core.CookieManager.DeleteCookiesWithDomainAndPath(name, new Uri(AppOrigin).Host, "/");
                var value = stored.FirstOrDefault(c => c.Name == name);
                if (value == null) continue;
                var cookie = core.CookieManager.CreateCookie(value.Name, value.Value, new Uri(AppOrigin).Host, "/");
                cookie.IsHttpOnly = true;
                cookie.IsSecure = true;
                cookie.SameSite = CoreWebView2CookieSameSiteKind.Lax;
                cookie.Expires = value.ExpiresUtc;
                core.CookieManager.AddOrUpdateCookie(cookie);
            }
        }

        private CoreWebView2WebResourceResponse Response(int status, string json)
        { return core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(json)), status, "Response", "Content-Type: application/json\r\nCache-Control: no-store\r\n"); }

        private CoreWebView2WebResourceResponse LocalAsset(string value, string method)
        {
            Uri uri;
            if (method != "GET" || !Uri.TryCreate(value, UriKind.Absolute, out uri)
                || uri.GetLeftPart(UriPartial.Authority) != AppOrigin || !string.IsNullOrEmpty(uri.UserInfo))
                return Response(403, "{\"error\":\"ORIGIN_NOT_ALLOWED\"}");
            var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
            if (relative.Contains("\\") || relative.Split('/').Any(p => p == ".." || p == ".") || relative.Contains(":"))
                return Response(403, "{\"error\":\"PATH_NOT_ALLOWED\"}");
            var root = Path.GetFullPath(configuration.AppDirectory) + Path.DirectorySeparatorChar;
            var path = Path.GetFullPath(Path.Combine(root, relative));
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return Response(403, "{\"error\":\"PATH_NOT_ALLOWED\"}");
            if (relative == "" || relative == "license") path = Path.Combine(root, "index.html");
            if (!File.Exists(path) || new FileInfo(path).Length > 32 * 1024 * 1024) return Response(404, "{\"error\":\"NOT_FOUND\"}");
            var extension = Path.GetExtension(path).ToLowerInvariant();
            var types = new Dictionary<string, string> { { ".html", "text/html; charset=utf-8" }, { ".js", "application/javascript; charset=utf-8" },
                { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".svg", "image/svg+xml" },
                { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".webp", "image/webp" }, { ".ico", "image/x-icon" }, { ".woff2", "font/woff2" } };
            string type;
            if (!types.TryGetValue(extension, out type)) return Response(403, "{\"error\":\"FILE_TYPE_NOT_ALLOWED\"}");
            return core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(path)), 200, "OK",
                "Content-Type: " + type + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'\r\n");
        }

        private static Task<T> WithoutCallerContext<T>(Func<T> action)
        {
            if (ExecutionContext.IsFlowSuppressed()) return Task.Run(action);
            using (ExecutionContext.SuppressFlow()) return Task.Run(action);
        }

        private static async Task<byte[]> ReadBoundedAsync(Stream input, int limit, CancellationToken cancellationToken)
        {
            using (var output = new MemoryStream())
            {
                var buffer = new byte[32768];
                int read;
                while ((read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false)) > 0)
                {
                    if (output.Length + read > limit) throw new IOException("Response exceeds configured limit.");
                    output.Write(buffer, 0, read);
                }
                return output.ToArray();
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            lifetime.Cancel();
            core.WebResourceRequested -= OnRequest;
            http.Dispose();
        }
    }
}
