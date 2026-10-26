using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using MaxWebViewHost;

internal static class PackagedRuntimeTests
{
    private static int passed;
    private static void Assert(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); passed++; }
    private static void Reject(Action action, string name) { try { action(); } catch (InvalidDataException) { Assert(true, name); return; } throw new Exception(name); }
    private static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-runtime-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "app"));
        File.WriteAllText(Path.Combine(root, "app", "index.html"), "test");
        try
        {
            Reject(() => PluginConfiguration.Load(root), "missing backend fails closed");
            File.WriteAllText(Path.Combine(root, "plugin-config.json"), "{\"apiBaseUrl\":\"http://example.com\"}");
            Reject(() => PluginConfiguration.Load(root), "HTTP public backend rejected");
            File.WriteAllText(Path.Combine(root, "plugin-config.json"), "{\"apiBaseUrl\":\"http://127.0.0.1:4000\"}");
            Reject(() => PluginConfiguration.Load(root), "loopback requires explicit test configuration");
            File.WriteAllText(Path.Combine(root, "plugin-config.json"), "{\"apiBaseUrl\":\"https://localhost\"}");
            Reject(() => PluginConfiguration.Load(root), "HTTPS loopback still requires test configuration");
            File.WriteAllText(Path.Combine(root, "plugin-config.json"), "{\"apiBaseUrl\":\"https://backend.example.com\"}");
            var config = PluginConfiguration.Load(root);
            Assert(config.ApiBaseUri.AbsoluteUri == "https://backend.example.com/", "HTTPS backend accepted");
            Assert(PackagedAppRuntime.IsProxyRequest(PackagedAppRuntime.AppOrigin + "/api/auth/me", "GET"), "fixed app API route accepted");
            Assert(!PackagedAppRuntime.IsProxyRequest("https://evil.test/api/auth/me", "GET"), "foreign proxy origin rejected");
            Assert(!PackagedAppRuntime.IsProxyRequest(PackagedAppRuntime.AppOrigin + "/api-evil", "GET"), "path prefix confusion rejected");
            Assert(!PackagedAppRuntime.IsProxyRequest(PackagedAppRuntime.AppOrigin + "/previews/a.png", "POST"), "preview writes rejected");
            var store = new SessionCookieStore(Path.Combine(root, "cookies"), config.ApiBaseUri);
            store.Apply(new[] { "sid=test-session; Path=/; HttpOnly; Max-Age=3600", "dsid=test-device; Path=/; HttpOnly; Max-Age=3600", "password=never-save; Path=/" });
            var reopened = new SessionCookieStore(Path.Combine(root, "cookies"), config.ApiBaseUri);
            Assert(reopened.Load().Count == 2 && reopened.Load().All(c => c.Name != "password"), "reopened DPAPI vault restores only session cookies");
            Assert(!File.ReadAllText(Directory.GetFiles(Path.Combine(root, "cookies"), "*.dat").Single()).Contains("test-session"), "session not stored as plaintext");
            Assert(new SessionCookieStore(Path.Combine(root, "cookies"), new Uri("https://other.example.com/")).Load().Count == 0, "sessions scoped to backend");
            reopened.Apply(new[] { "sid=; Path=/; Max-Age=0", "dsid=; Path=/; Max-Age=0" });
            Assert(new SessionCookieStore(Path.Combine(root, "cookies"), config.ApiBaseUri).Load().Count == 0, "logout survives reopening");
            Console.WriteLine("Packaged runtime tests passed: " + passed);
        }
        finally { Directory.Delete(root, true); }
    }
}
