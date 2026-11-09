// In-panel update: version compare, verified download, zip-slip safe unpack, restart-script guard.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MaxWebViewHost;

class PluginUpdateTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Reply;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t) { return Task.FromResult(Reply(r)); }
    }
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Sha(byte[] d) { using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(d)).Replace("-", "").ToLowerInvariant(); }
    static readonly Uri Api = new Uri("https://api.example.test/");

    static byte[] Package(string version)
    {
        using (var ms = new MemoryStream())
        {
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
            {
                foreach (var name in new[] { "install.ms", "payload-id.txt", "version.txt", "payload/MaxWebViewHost.dll" })
                    using (var w = new StreamWriter(zip.CreateEntry(name).Open())) w.Write(name == "version.txt" ? version : "x");
            }
            return ms.ToArray();
        }
    }
    static string Temp() { var d = Path.Combine(Path.GetTempPath(), "upd-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
    static HttpResponseMessage Json(string body) { return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") }; }
    static string Latest(string version, byte[] pkg, string sha = null)
    { return "{\"version\":\"" + version + "\",\"sha256\":\"" + (sha ?? Sha(pkg)) + "\",\"size\":" + pkg.Length + "}"; }
    static Func<HttpRequestMessage, HttpResponseMessage> Server(string latest, byte[] body)
    { return r => r.RequestUri.AbsolutePath == "/api/v1/plugin/latest" ? Json(latest) : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) }; }

    static PluginUpdateService Make(Fake fake, string installDir, string work)
    { var api = new BackendApi(Api, new HttpClient(fake)); return new PluginUpdateService(api, api, installDir, work); }

    static async Task<bool> Throws<T>(Func<Task> action) where T : Exception
    {
        try { await action(); } catch (T) { return true; }
        return false;
    }

    static void Main() { Run().GetAwaiter().GetResult(); }
    static async Task Run()
    {
        Check(PluginUpdateService.IsNewer("1.4.4", "1.4.5"), "patch bump is newer");
        Check(PluginUpdateService.IsNewer("1.4.9", "1.5.0"), "minor bump is newer");
        Check(PluginUpdateService.IsNewer("1.9.0", "2.0.0"), "major bump is newer");
        Check(!PluginUpdateService.IsNewer("1.4.10", "1.4.9"), "numeric not lexical compare");
        Check(!PluginUpdateService.IsNewer("1.4.4", "1.4.4"), "same version is not newer");
        Check(!PluginUpdateService.IsNewer("1.5.0", "1.4.9"), "older server version is not an update");
        Check(PluginUpdateService.IsNewer("1.5.0-rc.1", "1.5.0"), "release is newer than its pre-release");
        Check(PluginUpdateService.IsNewer(null, "1.0.0"), "unknown current version counts as outdated");
        Check(!PluginUpdateService.IsNewer("1.0.0", "garbage"), "garbage latest is ignored");

        var work = Temp(); var install = Temp();
        try
        {
            File.WriteAllText(Path.Combine(install, "version.txt"), "1.4.4\n");
            var pkg = Package("1.5.0");
            var fake = new Fake { Reply = Server(Latest("1.5.0", pkg), pkg) };
            var service = Make(fake, install, work);
            Check(service.InstalledVersion() == "1.4.4", "installed version read from version.txt");
            var status = await service.CheckAsync(CancellationToken.None);
            Check(status.UpdateAvailable && status.Current == "1.4.4" && status.Latest == "1.5.0", "check reports update");

            var progressed = false;
            var dir = await service.PrepareAsync(status, (a, b) => progressed = true, CancellationToken.None);
            Check(File.Exists(dir + "install.ms") && File.Exists(dir + @"payload\MaxWebViewHost.dll") && progressed, "package verified and unpacked");
            Check(Directory.GetFiles(work, "*.part", SearchOption.AllDirectories).Length == 0, "no .part left behind");

            fake.Reply = Server(Latest("1.5.0", pkg, new string('0', 64)), pkg);
            var bad = await service.CheckAsync(CancellationToken.None);
            Check(await Throws<InvalidDataException>(() => service.PrepareAsync(bad, null, CancellationToken.None)), "sha mismatch rejected");

            var other = Package("1.4.9");
            fake.Reply = Server(Latest("1.5.0", other), other);
            Check(await Throws<InvalidDataException>(async () => await service.PrepareAsync(await service.CheckAsync(CancellationToken.None), null, CancellationToken.None)), "package version must match API");

            fake.Reply = Server(Latest("1.5.0", pkg), pkg.Concat(new byte[] { 1 }).ToArray());
            Check(await Throws<InvalidDataException>(async () => await service.PrepareAsync(await service.CheckAsync(CancellationToken.None), null, CancellationToken.None)), "oversize body rejected");

            fake.Reply = r => Json("{\"version\":\"../x\",\"sha256\":\"a\",\"size\":1}");
            Check(await Throws<ApiException>(() => service.CheckAsync(CancellationToken.None)), "malformed latest rejected");

            foreach (var evil in new[] { "../evil.txt", "a/../../evil.txt", "/abs.txt", "C:/abs.txt" })
            {
                var zipPath = Path.Combine(work, "evil.zip"); File.Delete(zipPath);
                using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create)) using (var w = new StreamWriter(zip.CreateEntry(evil).Open())) w.Write("x");
                var rejected = false;
                try { PluginUpdateService.Extract(zipPath, Path.Combine(work, "slip") + Path.DirectorySeparatorChar); } catch (InvalidDataException) { rejected = true; }
                Check(rejected, "zip-slip rejected: " + evil);
            }
            Check(!File.Exists(Path.Combine(work, "evil.txt")) && !File.Exists(Path.Combine(Path.GetDirectoryName(work), "evil.txt")), "nothing written outside destination");

            var refused = false;
            try { service.WriteRestartScript(Path.Combine(install, "notmax.exe")); } catch (InvalidDataException) { refused = true; }
            Check(refused, "restart script refuses non-3dsmax executable");
            var fakeMax = Path.Combine(install, "3dsmax.exe"); File.WriteAllText(fakeMax, "x");
            var script = File.ReadAllText(service.WriteRestartScript(fakeMax));
            Check(script.Contains("Get-Process -Name 3dsmax") && script.Contains("Start-Process -FilePath $MaxExe") && script.All(c => c < 128), "restart script waits for all Max then starts one (ASCII)");
        }
        finally { Directory.Delete(work, true); Directory.Delete(install, true); }
        Console.WriteLine("All PluginUpdate tests passed.");
    }
}
