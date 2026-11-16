// "Open File (cửa sổ Max mới)" works on a copy: the library file is never opened, untouched copies are cleaned, saved ones are kept.
using System;
using System.IO;
using MaxWebViewHost;

class PreviewCopyTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }

    static void Main()
    {
        var work = Path.Combine(Path.GetTempPath(), "3dsmood-preview-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var library = Path.Combine(work, "library", "Chair"); Directory.CreateDirectory(library);
            var source = Path.Combine(library, "chair_2020.max"); File.WriteAllText(source, "original scene bytes");
            File.SetLastWriteTimeUtc(source, new DateTime(2025, 1, 2, 3, 4, 5, DateTimeKind.Utc));
            var root = Path.Combine(work, "Preview");

            var copy = PreviewCopy.Create(source, root);
            Check(File.Exists(copy) && copy.StartsWith(root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(copy) == "chair_2020.max", "the .max is copied under the preview folder, same name");
            Check(File.ReadAllText(copy) == "original scene bytes", "the copy has the same content");
            Check(File.GetLastWriteTimeUtc(copy) == File.GetLastWriteTimeUtc(source), "the copy keeps the library file's timestamp (how cleanup spots an unsaved copy)");
            File.WriteAllText(copy, "user saved the preview");
            Check(File.ReadAllText(source) == "original scene bytes", "saving the preview never touches the library file");

            // Cleanup: only old AND untouched copies go.
            var now = DateTime.UtcNow;
            var saved = Path.GetDirectoryName(copy);
            var untouched = Path.GetDirectoryName(PreviewCopy.Create(source, root));
            var recent = Path.GetDirectoryName(PreviewCopy.Create(source, root));
            var noMarker = Path.Combine(root, "foreign"); Directory.CreateDirectory(noMarker); File.WriteAllText(Path.Combine(noMarker, "x.max"), "x");
            foreach (var d in new[] { saved, untouched, noMarker }) Directory.SetCreationTimeUtc(d, now.AddDays(-2));
            var removed = PreviewCopy.Cleanup(root, TimeSpan.FromDays(1), now);
            Check(removed == 1 && !Directory.Exists(untouched), "an old copy the user never saved is removed");
            Check(Directory.Exists(saved), "an old copy the user saved is kept (their work)");
            Check(Directory.Exists(recent), "a copy younger than a day is kept");
            Check(Directory.Exists(noMarker), "a folder without our marker is never deleted");
            var locked = Path.GetDirectoryName(PreviewCopy.Create(source, root));
            Directory.SetCreationTimeUtc(locked, now.AddDays(-2));
            using (new FileStream(Path.Combine(locked, "chair_2020.max"), FileMode.Open, FileAccess.Read, FileShare.None))
                Check(PreviewCopy.Cleanup(root, TimeSpan.FromDays(1), now) == 0 && Directory.Exists(locked), "a copy still open in a Max is kept, no exception");
            Check(PreviewCopy.Cleanup(Path.Combine(work, "missing"), TimeSpan.FromDays(1), now) == 0, "no preview folder yet: nothing to do");

            // Env vars handed to the preview Max: consumed once, validated.
            Environment.SetEnvironmentVariable(PreviewCopy.OpenEnv, copy); Environment.SetEnvironmentVariable(PreviewCopy.EntryEnv, source);
            Check(PreviewCopy.Consume() == copy + "|" + source, "the preview Max reads copy|libraryFile");
            Check(PreviewCopy.Consume() == "" && Environment.GetEnvironmentVariable(PreviewCopy.OpenEnv) == null, "consumed once: later Max launches do not inherit it");
            Environment.SetEnvironmentVariable(PreviewCopy.OpenEnv, copy);
            Check(PreviewCopy.Consume() == "", "only one of the two variables: nothing");
            Environment.SetEnvironmentVariable(PreviewCopy.OpenEnv, @"C:\a|b.max"); Environment.SetEnvironmentVariable(PreviewCopy.EntryEnv, source);
            Check(PreviewCopy.Consume() == "", "a '|' in a value is rejected");
            Environment.SetEnvironmentVariable(PreviewCopy.OpenEnv, @"C:\x\evil.ms"); Environment.SetEnvironmentVariable(PreviewCopy.EntryEnv, source);
            Check(PreviewCopy.Consume() == "", "only .max files are accepted");
        }
        finally { try { Directory.Delete(work, true); } catch (IOException) { } }
        Console.WriteLine("All PreviewCopy tests passed.");
    }
}
