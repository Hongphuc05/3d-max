// P4.3 step 4: which local answer a web-UI request gets. Pure; no WebView2 needed.
using System;
using MaxWebViewHost;

class V3RoutesTests
{
    const string Origin = "https://app.3dsmood.local";
    static readonly string Sha = new string('a', 64);
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static V3Route Route(string path, string method = "GET") { string sha; return V3Routes.Classify(Origin + path, method, Origin, out sha); }
    static void Main()
    {
        Check(Route("/api/v1/catalog") == V3Route.Catalog, "catalog");
        Check(Route("/api/v1/categories") == V3Route.Categories, "categories");
        Check(Route("/api/v1/previews/manifest") == V3Route.PreviewManifest, "preview manifest");
        Check(Route("/api/v1/catalog/version") == V3Route.CatalogVersion, "catalog version");
        Check(Route("/api/v1/me/entitlements") == V3Route.Entitlements, "entitlements");
        string sha;
        Check(V3Routes.Classify(Origin + "/previews/" + Sha + ".webp", "GET", Origin, out sha) == V3Route.Preview && sha == Sha, "preview by content hash");
        foreach (var domain in new[] { "3dmodels", "3dscenes" })
            Check(V3Routes.Classify(Origin + "/previews/" + domain + "/" + Sha + ".webp", "GET", Origin, out sha) == V3Route.Preview && sha == Sha, domain + " scoped preview by content hash");
        foreach (var path in new[] { "/previews/other/", "/previews/3dscenes/extra/", "/previews/3dscenes%2f", "/previews/3dscenes//" })
            Check(Route(path + Sha + ".webp") == V3Route.Blocked, "invalid preview scope blocked: " + path);
        Check(Route("/previews/../api/v1/catalog") == V3Route.Catalog, "dot segments are normalised by Uri before classification (same answer as the direct path)");
        Check(Route("/") == V3Route.None && Route("/assets/app.js") == V3Route.None && Route("/license") == V3Route.None, "the application's own files are not API routes");
        foreach (var blocked in new[] {
            "/api/v1/device/challenge", "/api/v1/device/verify", "/api/v1/models/11111111-1111-4111-8111-111111111111/import-session", "/api/v1/model-downloads/x",
            "/api/admin/overview", "/api/auth/login", "/api/health", "/api/v1/catalog/events", "/api/v1/", "/api/",
            "/previews/other.webp", "/previews/" + Sha + ".png", "/previews/" + Sha.ToUpperInvariant() + ".webp", 
            "/api/v1/catalog//", "/api//v1/catalog", "/api/v1%2fcatalog", "/api/v1/catalog%5c", "/api/v1/catalog?x=1", "/previews/" + Sha + ".webp?x=1" })
            Check(Route(blocked) == V3Route.Blocked || Route(blocked) == V3Route.None && !blocked.StartsWith("/api") && !blocked.StartsWith("/previews"), "'" + blocked + "' is never served from the network");
        foreach (var method in new[] { "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" })
            Check(Route("/api/v1/catalog", method) == V3Route.Blocked, method + " is blocked");
        const string O = "11111111-1111-4111-8111-111111111111";
        Check(Route("/api/v1/orders", "POST") == V3Route.OrderCreate, "create order");
        Check(V3Routes.Classify(Origin + "/api/v1/orders/" + O, "GET", Origin, out sha) == V3Route.OrderGet && sha == O, "get order carries the id");
        Check(V3Routes.Classify(Origin + "/api/v1/orders/" + O + "/claim-paid", "POST", Origin, out sha) == V3Route.OrderClaim && sha == O, "claim-paid carries the id");
        Check(V3Routes.Classify(Origin + "/api/v1/orders/" + O + "/cancel", "POST", Origin, out sha) == V3Route.OrderCancel && sha == O, "cancel carries the id");
        foreach (var blocked in new[] { new[] { "/api/v1/orders", "GET" }, new[] { "/api/v1/orders/" + O, "POST" }, new[] { "/api/v1/orders/" + O + "/claim-paid", "GET" }, new[] { "/api/v1/orders/" + O + "/cancel", "GET" },
            new[] { "/api/v1/orders/" + O, "DELETE" }, new[] { "/api/v1/orders/" + O, "PUT" }, new[] { "/api/v1/orders/abc", "GET" }, new[] { "/api/v1/orders/" + O + "/other", "POST" },
            new[] { "/api/v1/orders/../device/verify", "POST" }, new[] { "/api/v1/orders?x=1", "POST" }, new[] { "/api/v1/orders/" + O + "?x=1", "GET" }, new[] { "/api/v1/orders%2f" + O, "GET" },
            new[] { "/api/v1/orders//", "POST" }, new[] { "/api/v1/orders/" + O + "/", "GET" } })
            Check(Route(blocked[0], blocked[1]) == V3Route.Blocked, blocked[1] + " " + blocked[0] + " is blocked");
        Check(Route("/api/v1/catalog", "POST") == V3Route.Blocked && Route("/api/v1/device/verify", "POST") == V3Route.Blocked, "POST is blocked outside the order routes");
        Check(V3Routes.Classify("https://evil.test/api/v1/catalog", "GET", Origin, out sha) == V3Route.None, "another origin is not ours");
        Check(V3Routes.Classify("https://user@app.3dsmood.local/api/v1/catalog", "GET", Origin, out sha) == V3Route.None, "user info is not accepted");
        Check(V3Routes.Classify("https://app.3dsmood.local/api/v1/catalog#x", "GET", Origin, out sha) == V3Route.None, "fragments are not accepted");
        Check(V3Routes.Classify("not a url", "GET", Origin, out sha) == V3Route.None && V3Routes.Classify(null, "GET", Origin, out sha) == V3Route.None, "garbage urls are not ours");
        Console.WriteLine("V3 route tests passed");
    }
}
