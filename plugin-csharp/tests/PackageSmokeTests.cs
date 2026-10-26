using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

// Runs without NuGet DLLs beside this executable: dependencies must resolve from
// the actual deployment directory, just as they do in 3ds Max.
internal static class PackageSmokeTests
{
    private static int Main(string[] args)
    {
        var work = Path.Combine(Path.GetTempPath(), "3dsmood-package-smoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var host = Assembly.LoadFrom(Path.Combine(Path.GetFullPath(args[0]), "MaxWebViewHost.dll"));
            var extractor = host.GetType("MaxWebViewHost.ArchivePackage", true).GetMethod("Extract", BindingFlags.Public | BindingFlags.Static);
            var zip = Path.Combine(work, "model.zip");
            using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
            using (var writer = new StreamWriter(archive.CreateEntry("model.obj").Open()))
                writer.Write("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
            var packages = new[] { zip, Path.GetFullPath(args[1]), Path.GetFullPath(args[2]) };
            for (var i = 0; i < packages.Length; i++)
            {
                var files = (string[])extractor.Invoke(null, new object[] {
                    packages[i], Path.Combine(work, "content-" + i), CancellationToken.None, null, null });
                if (files.Length == 0) throw new Exception("Package extraction produced no files.");
                foreach (var file in files)
                    if (!File.Exists(file)) throw new Exception("Extracted file is missing.");
                Console.WriteLine("PASS deployed host extracts " + Path.GetExtension(packages[i]));
            }
            return 0;
        }
        catch (Exception error)
        {
            while (error.InnerException != null) error = error.InnerException;
            Console.Error.WriteLine("FAIL deployed archive runtime: " + error.GetType().Name + ": " + error.Message);
            return 1;
        }
        finally
        {
            var resolved = Path.GetFullPath(work);
            var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (resolved.StartsWith(temp, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(resolved).StartsWith("3dsmood-package-smoke-", StringComparison.Ordinal))
                Directory.Delete(resolved, true);
        }
    }
}
