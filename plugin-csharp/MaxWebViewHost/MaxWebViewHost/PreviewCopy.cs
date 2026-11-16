using System;
using System.IO;
using System.Linq;

namespace MaxWebViewHost
{
    /// <summary>"Open in a new Max" works on a copy of the library's .max file (textures stay in the library folder and are relinked by the new Max),
    /// so pressing Save in the preview window can never overwrite the downloaded library file. Only the .max is copied, never the textures.</summary>
    internal static class PreviewCopy
    {
        private const string Marker = "source.txt";   // line 1: library file, line 2: its LastWriteTimeUtc ticks at copy time
        /// <summary>Env vars set ONLY on the preview Max the panel starts; its startup agent relinks textures once the copy is open.</summary>
        internal const string OpenEnv = "MZP_PREVIEW_OPEN", EntryEnv = "MZP_PREVIEW_ENTRY";

        /// <summary>"copy|libraryFile" once (the variables are cleared so later Max launches from this process do not inherit them), else "".
        /// '|' cannot appear in a Windows path. Whether libraryFile is really a downloaded file is checked by TexturePathResolver.</summary>
        internal static string Consume()
        {
            var open = Environment.GetEnvironmentVariable(OpenEnv);
            var entry = Environment.GetEnvironmentVariable(EntryEnv);
            Environment.SetEnvironmentVariable(OpenEnv, null);
            Environment.SetEnvironmentVariable(EntryEnv, null);
            if (string.IsNullOrEmpty(open) || string.IsNullOrEmpty(entry) || open.Contains("|") || entry.Contains("|")
                || !open.EndsWith(".max", StringComparison.OrdinalIgnoreCase) || !entry.EndsWith(".max", StringComparison.OrdinalIgnoreCase)) return "";
            return open + "|" + entry;
        }

        /// <summary>Copies <paramref name="libraryFile"/> into a fresh folder under <paramref name="root"/> and returns the copy's path.
        /// Old copies are cleaned first. The copy keeps the library file's timestamp (File.Copy preserves it), which is how cleanup tells
        /// an untouched copy from one the user saved.</summary>
        internal static string Create(string libraryFile, string root)
        {
            Cleanup(root, TimeSpan.FromDays(1), DateTime.UtcNow);
            var folder = Path.Combine(root, DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(folder);
            var copy = Path.Combine(folder, Path.GetFileName(libraryFile));
            File.Copy(libraryFile, copy, false);
            File.WriteAllLines(Path.Combine(folder, Marker), new[] { libraryFile, File.GetLastWriteTimeUtc(copy).Ticks.ToString() });
            return copy;
        }

        /// <summary>Deletes preview folders older than <paramref name="age"/> whose copy is unchanged (the user never saved it). A folder whose
        /// copy was saved, has no marker, or is still open (locked) is kept. Returns how many folders were removed.</summary>
        internal static int Cleanup(string root, TimeSpan age, DateTime nowUtc)
        {
            if (!Directory.Exists(root)) return 0;
            var removed = 0;
            foreach (var folder in Directory.GetDirectories(root))
            {
                try
                {
                    if (nowUtc - Directory.GetCreationTimeUtc(folder) < age) continue;
                    var marker = Path.Combine(folder, Marker);
                    if (!File.Exists(marker)) continue;
                    var lines = File.ReadAllLines(marker);
                    long ticks;
                    if (lines.Length < 2 || !long.TryParse(lines[1], out ticks)) continue;
                    var copies = Directory.GetFiles(folder, "*.max");
                    if (copies.Any(c => File.GetLastWriteTimeUtc(c).Ticks != ticks)) continue;   // saved by the user: keep their work
                    Directory.Delete(folder, true);
                    removed++;
                }
                catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }   // still open in a Max: try next time
            }
            return removed;
        }
    }
}
