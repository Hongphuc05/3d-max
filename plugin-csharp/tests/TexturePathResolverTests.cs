using System;
using System.IO;
using MaxWebViewHost;

public static class TexturePathResolverTests
{
    public static TexturePathResolver Create(string root, string entry) { return new TexturePathResolver(root, entry); }
    static int checks;
    static void Check(bool condition, string message)
    { if (!condition) throw new Exception(message); checks++; Console.WriteLine("PASS " + message); }
    static string Write(string root, string relative)
    {
        var path = Path.Combine(root, relative); Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, "fixture"); return path;
    }
    public static int Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "3dsmood-texture-" + Guid.NewGuid().ToString("N"));
        try
        {
            var entry = Write(root, @"export\chair.fbx");
            var diffuse = Write(root, @"maps\diffuse.jpg");
            var bump = Write(root, @"textures\nested\bump.exr");
            var red = Write(root, @"red\maps\shared.png");
            Write(root, @"blue\maps\shared.png");
            var resolver = Create(root, entry);
            Check(resolver.Resolve(@"..\maps\diffuse.jpg") == diffuse, "FBX relative paths resolve from the entry directory");
            Check(resolver.Resolve("maps/diffuse.jpg") == diffuse, "package-root paths resolve with either separator");
            Check(resolver.Resolve("DIFFUSE.JPG") == diffuse, "bare filenames resolve case-insensitively within this package");
            Check(resolver.Resolve(@"C:\author\project\maps\diffuse.jpg") == diffuse, "author-machine absolute paths are rebound to the downloaded package");
            Check(resolver.Resolve("bump.exr") == bump, "nested textures and HDR formats are included without a JPEG-specific rule");
            Check(resolver.Resolve(@"C:\old\red\maps\shared.png") == red, "directory suffix disambiguates same-named color variants");
            Check(resolver.Resolve("shared.png") == "" && resolver.LastStatus == "ambiguous", "duplicate bare filenames are never guessed");
            Check(resolver.Resolve(@"C:\old\maps\shared.png") == "" && resolver.LastStatus == "ambiguous", "ambiguous directory suffixes are never guessed");
            Check(resolver.Resolve("missing.jpg") == "" && resolver.LastStatus == "missing", "missing assets produce an explicit unresolved result");
            Check(resolver.Resolve(diffuse) == diffuse, "already absolute package texture remains stable on reimport");
            Check(resolver.Resolve(@"\\unreachable\share\missing.jpg") == "", "unresolved UNC references do not probe a network share");
            File.Delete(bump);
            Check(resolver.Resolve("bump.exr") == "", "a texture deleted after indexing is not reported as resolved");
            var rejected = false;
            try { new TexturePathResolver(root, entry, 2); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "texture indexing enforces a filesystem entry budget");
            rejected = false;
            try { Create(root, Path.Combine(Path.GetTempPath(), "outside.max")); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "entry outside the model package is rejected");
            Console.WriteLine(checks + " texture resolver checks passed"); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            if (Path.GetDirectoryName(Path.GetFullPath(root)) == Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)
                && Path.GetFileName(root).StartsWith("3dsmood-texture-", StringComparison.Ordinal) && Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
