using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using MaxWebViewHost;

internal static class ArchiveSecurityTests
{
    private static int passed;
    private static void Assert(bool ok, string message)
    {
        if (!ok) throw new Exception("FAILED " + message);
        Console.WriteLine("PASS " + message); passed++;
    }
    private static void Reject(Action action, string message)
    {
        try { action(); } catch (InvalidDataException) { Assert(true, message); return; }
        throw new Exception("FAILED accepted " + message);
    }
    private static string Zip(string root, string name, params string[] entries)
    {
        var file = Path.Combine(root, name + ".zip");
        using (var output = File.Create(file))
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create))
            foreach (var entry in entries)
                using (var stream = new StreamWriter(zip.CreateEntry(entry).Open())) stream.Write(new string('X', 1024));
        return file;
    }
    private static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-archive-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var token = CancellationToken.None;
            var zip = Zip(root, "valid", "model/scene.MAX", "model/maps/wood.jpg", "model/startup.ms", "model/run.exe");
            var extracted = ArchivePackage.Extract(zip, Path.Combine(root, "valid"), token, null);
            Assert(extracted.Any(f => f.EndsWith("scene.MAX")), "ZIP with MAX and textures extracts");
            Assert(extracted.Length == 2, "archive scripts and executables are never materialized");
            Reject(() => ArchivePackage.Extract(Zip(root, "traversal", "../outside.max"), Path.Combine(root, "traversal"), token, null), "parent traversal rejected before writing");
            Reject(() => ArchivePackage.Extract(Zip(root, "absolute", "C:/outside.max"), Path.Combine(root, "absolute"), token, null), "absolute paths rejected");
            Reject(() => ArchivePackage.Extract(Zip(root, "device", "CON.max"), Path.Combine(root, "device"), token, null), "Windows device aliases rejected");
            Reject(() => ArchivePackage.Extract(Zip(root, "duplicates", "scene.max", "SCENE.MAX"), Path.Combine(root, "duplicates"), token, null), "case-insensitive duplicate paths rejected");
            Reject(() => ArchivePackage.Extract(zip, Path.Combine(root, "limited"), token, null, new ArchiveLimits { MaxExtractedBytes = 100 }), "decompression size budget enforced");
            Reject(() => ArchivePackage.Extract(zip, Path.Combine(root, "entries"), token, null, new ArchiveLimits { MaxEntries = 1 }), "archive entry count budget enforced");
            Reject(() => ArchivePackage.Extract(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"fixtures","hidden-local.zip"), Path.Combine(root,"hidden-local"), token, null, new ArchiveLimits { MaxEntries = 1 }), "ZIP local headers cannot bypass the validated central manifest");
            var corrupt = Path.Combine(root, "corrupt.rar"); File.WriteAllText(corrupt, "corrupt");
            Reject(() => ArchivePackage.Extract(corrupt, Path.Combine(root, "corrupt"), token, null), "corrupt archives return a controlled error");
            using (var cancelled = new CancellationTokenSource())
            {
                cancelled.Cancel();
                var rejected = false;
                try { ArchivePackage.Extract(zip, Path.Combine(root, "cancelled"), cancelled.Token, null); }
                catch (OperationCanceledException) { rejected = true; }
                Assert(rejected, "cancelled extraction stops");
            }
            Reject(() => ArchivePackage.CopyBounded(new MemoryStream(new byte[64]), new MemoryStream(), 16, null, token), "unknown-length streaming download is bounded");
            var progress = 0L;
            ArchivePackage.CopyBounded(new MemoryStream(new byte[64]), new MemoryStream(), 100, n => progress = n, token);
            Assert(progress == 64, "stream copy reports progress");
            foreach (var fixture in new[] { "Rar.rar", "7Zip.LZMA.7z" })
            {
                var fixturePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixtures", fixture);
                var result = ArchivePackage.Extract(fixturePath, Path.Combine(root, fixture), token, null);
                Assert(result.Length > 0 && result.All(File.Exists), fixture + " supported by licensed managed extractor");
            }
            Console.WriteLine("Archive tests passed: " + passed);
        }
        finally
        {
            // The harness owns this unique, resolved temporary directory.
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
