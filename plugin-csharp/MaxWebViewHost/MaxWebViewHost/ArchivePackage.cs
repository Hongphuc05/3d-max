using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using SharpCompress.Archives;
using SharpCompress.Common;
using SharpCompress.Readers;

namespace MaxWebViewHost
{
    internal sealed class ArchiveLimits
    {
        public long MaxExtractedBytes = 8L * 1024 * 1024 * 1024;
        public int MaxEntries = 20000;
    }

    internal static class ArchivePackage
    {
        private static readonly HashSet<string> Blocked = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { ".ms", ".mse", ".mcr", ".py", ".pyc", ".exe", ".dll", ".bat", ".cmd", ".com", ".ps1", ".vbs", ".js", ".scr", ".lnk", ".url", ".hta", ".reg" };

        public static long CopyBounded(Stream source, Stream destination, long maximum, Action<long> progress, CancellationToken token)
        {
            var buffer = new byte[65536];
            long total = 0;
            int count;
            while (true)
            {
                token.ThrowIfCancellationRequested();
                count = source.Read(buffer, 0, buffer.Length);
                if (count == 0) break;
                total = checked(total + count);
                if (total > maximum) throw new InvalidDataException("Archive size budget exceeded.");
                destination.Write(buffer, 0, count);
                progress?.Invoke(total);
            }
            return total;
        }

        private static string SafePath(string root, string key)
        {
            if (string.IsNullOrWhiteSpace(key) || key.StartsWith("/") || key.StartsWith("\\") || key.Contains(":"))
                throw new InvalidDataException("Unsafe archive path.");
            var parts = key.Replace('\\', '/').TrimEnd('/').Split('/');
            foreach (var part in parts)
            {
                var stem = part.Split('.')[0].ToUpperInvariant();
                if (part == ".." || part == "." || part.Length == 0 || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                    || new[] { "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$" }.Contains(stem)
                    || System.Text.RegularExpressions.Regex.IsMatch(stem, "^(COM|LPT)[0-9¹²³]$"))
                    throw new InvalidDataException("Unsafe archive path.");
            }
            var result = Path.GetFullPath(Path.Combine(root, Path.Combine(parts)));
            if (!result.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Archive path escapes root.");
            return result;
        }

        public static string[] Extract(string package, string destination, CancellationToken token, Action<long> progress, ArchiveLimits limits = null)
        {
            token.ThrowIfCancellationRequested();
            limits = limits ?? new ArchiveLimits();
            var root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
            if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()) throw new InvalidDataException("Extraction requires an empty owned directory.");
            Directory.CreateDirectory(root);
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Reparse point root.");
            try
            {
                using (var archive = ArchiveFactory.OpenArchive(package))
                {
                    if (archive.Type != ArchiveType.Zip && archive.Type != ArchiveType.Rar && archive.Type != ArchiveType.SevenZip)
                        throw new InvalidDataException("Unsupported archive format.");
                    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var manifest = new Dictionary<string, Tuple<long,bool>>(StringComparer.OrdinalIgnoreCase);
                    long declared = 0;
                    int count = 0;
                    foreach (var entry in archive.Entries)
                    {
                        token.ThrowIfCancellationRequested();
                        if (++count > limits.MaxEntries || entry.Size < 0 || entry.Size > limits.MaxExtractedBytes - declared)
                            throw new InvalidDataException("Archive budget exceeded.");
                        declared += entry.Size;
                        var target = SafePath(root, entry.Key);
                        if (!names.Add(target) || !string.IsNullOrEmpty(entry.LinkTarget) || entry.IsEncrypted || !entry.IsComplete
                            || (entry.Attrib.GetValueOrDefault() & (int)FileAttributes.ReparsePoint) != 0
                            || ((entry.Attrib.GetValueOrDefault() >> 16) & 0xf000) == 0xa000)
                            throw new InvalidDataException("Unsafe archive entry.");
                        manifest.Add(target,Tuple.Create(entry.Size,entry.IsDirectory));
                    }
                    var files = new List<string>();
                    long total = 0;
                    long readerDeclared = 0;
                    var readNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    using (var reader = archive.IsSolid || archive.Type == ArchiveType.SevenZip ? archive.ExtractAllEntries() : ReaderFactory.OpenReader(package))
                    {
                        while (reader.MoveToNextEntry())
                        {
                            token.ThrowIfCancellationRequested();
                            var entry = reader.Entry;
                            var target = SafePath(root, entry.Key);
                            Tuple<long,bool> expected;
                            if (!readNames.Add(target) || readNames.Count > limits.MaxEntries || !manifest.TryGetValue(target,out expected)
                                || expected.Item1 != entry.Size || expected.Item2 != entry.IsDirectory
                                || !string.IsNullOrEmpty(entry.LinkTarget) || entry.IsEncrypted
                                || (entry.Attrib.GetValueOrDefault() & (int)FileAttributes.ReparsePoint) != 0
                                || ((entry.Attrib.GetValueOrDefault() >> 16) & 0xf000) == 0xa000
                                || entry.Size < 0 || entry.Size > limits.MaxExtractedBytes - readerDeclared)
                                throw new InvalidDataException("Archive stream differs from validated manifest.");
                            readerDeclared += entry.Size;
                            if (entry.IsDirectory) { Directory.CreateDirectory(target); continue; }
                            if (Blocked.Contains(Path.GetExtension(target))) continue;
                            Directory.CreateDirectory(Path.GetDirectoryName(target));
                            using (var source = reader.OpenEntryStream())
                            using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                            {
                                var written = CopyBounded(source, output, Math.Min(entry.Size, limits.MaxExtractedBytes - total), n => progress?.Invoke(total + n), token);
                                if (written != entry.Size) throw new InvalidDataException("Archive entry is truncated.");
                                total += written;
                            }
                            files.Add(target);
                        }
                        if (readNames.Count != names.Count) throw new InvalidDataException("Archive stream is incomplete.");
                    }
                    return files.ToArray();
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (InvalidDataException) { throw; }
            catch (Exception error) { throw new InvalidDataException("Archive is corrupt or unsupported.", error); }
        }
    }
}
