using System;
using System.Text.RegularExpressions;

namespace MaxWebViewHost
{
    internal enum V3Route { None, Blocked, Catalog, Categories, PreviewManifest, CatalogVersion, Entitlements, Preview, OrderCreate, OrderGet, OrderClaim, OrderCancel }

    /// <summary>Which local answer a request from the web UI gets. The UI has no network access of its own: /api/v1 reads are served from the
    /// verified local catalog (or the device session), /previews/[3dmodels/|3dscenes/]&lt;sha256&gt;.webp from the preview cache, and order calls (POST /api/v1/orders,
    /// GET/POST /api/v1/orders/&lt;uuid&gt;[/claim-paid|/cancel]) are forwarded by OrdersClient with the device token. Nothing else under /api or
    /// /previews is reachable — in particular never the device endpoints, whose token only native code may hold.</summary>
    internal static class V3Routes
    {
        private static readonly Regex Preview = new Regex("^/previews/(?:(?:3dmodels|3dscenes)/)?([0-9a-f]{64})\\.webp$", RegexOptions.CultureInvariant);
        private static readonly Regex Order = new Regex("^/api/v1/orders/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})(/claim-paid|/cancel)?$", RegexOptions.CultureInvariant);

        /// <summary>arg = the preview sha256 or the order id the route refers to.</summary>
        internal static V3Route Classify(string url, string method, string appOrigin, out string arg)
        {
            arg = null;
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != appOrigin
                || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return V3Route.None;
            var path = uri.AbsolutePath;
            var guarded = path.StartsWith("/api/", StringComparison.Ordinal) || path.StartsWith("/previews/", StringComparison.Ordinal);
            if (!guarded) return V3Route.None;
            if ((method != "GET" && method != "POST") || !string.IsNullOrEmpty(uri.Query)
                || url.IndexOf("%2f", StringComparison.OrdinalIgnoreCase) >= 0 || url.IndexOf("%5c", StringComparison.OrdinalIgnoreCase) >= 0 // raw text: Uri.AbsolutePath may already have decoded them
                || path.Contains("\\") || path.Contains("//")) return V3Route.Blocked;
            var order = Order.Match(path);
            if (method == "POST")
            {
                if (path == "/api/v1/orders") return V3Route.OrderCreate;
                if (order.Success && order.Groups[2].Success) { arg = order.Groups[1].Value; return order.Groups[2].Value == "/cancel" ? V3Route.OrderCancel : V3Route.OrderClaim; }
                return V3Route.Blocked;
            }
            switch (path)
            {
                case "/api/v1/catalog": return V3Route.Catalog;
                case "/api/v1/categories": return V3Route.Categories;
                case "/api/v1/previews/manifest": return V3Route.PreviewManifest;
                case "/api/v1/catalog/version": return V3Route.CatalogVersion;
                case "/api/v1/me/entitlements": return V3Route.Entitlements;
            }
            if (order.Success && !order.Groups[2].Success) { arg = order.Groups[1].Value; return V3Route.OrderGet; }
            var match = Preview.Match(path);
            if (match.Success) { arg = match.Groups[1].Value; return V3Route.Preview; }
            return V3Route.Blocked;
        }
    }
}
