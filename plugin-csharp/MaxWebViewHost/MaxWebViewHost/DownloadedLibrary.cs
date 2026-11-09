using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class ImportOption
    {
        public string optionId { get; set; }
        public string label { get; set; }
        public string relativePath { get; set; }
        public string format { get; set; }
        public string renderer { get; set; }
        public int? maxVersion { get; set; }
    }

    internal sealed class DownloadedModel
    {
        public string modelId { get; set; }
        public string downloadedAt { get; set; }
        public string name { get; set; }
        public string directory { get; set; }
        public string entryFile { get; set; }
        public ImportOption[] importOptions { get; set; }
        public long sizeBytes { get; set; }
        public Dictionary<string, object> product { get; set; }
        public object PublicView() { return new { modelId, downloadedAt, name, sizeBytes, product }; }
    }

    internal sealed class DownloadedLibraryState
    {
        public string downloadDirectory { get; set; }
        public string sceneDownloadDirectory { get; set; }
        public List<DownloadedModel> models { get; set; } = new List<DownloadedModel>();
        public Dictionary<string, bool> rights { get; set; } = new Dictionary<string, bool>();
        public List<string> favorites { get; set; } = new List<string>(); // lowercase model UUIDs, any content domain
        public List<FavoriteFolder> favoriteFolders { get; set; } = new List<FavoriteFolder>();
        public Dictionary<string, string> favoriteFolderOf { get; set; } = new Dictionary<string, string>(); // model UUID -> folder id; absent = Default
    }

    /// <summary>User-made favorites folder. Default is virtual (no entry): a favorite with no assignment lives there.</summary>
    internal sealed class FavoriteFolder
    {
        public string id { get; set; }
        public string name { get; set; }
        public string contentDomain { get; set; }
    }

    /// <summary>Small DPAPI-protected index outside installed files. Model contents are extracted once,
    /// kept at stable locations and never moved when the default download folder changes.</summary>
    internal sealed class DownloadedLibrary
    {
        private readonly string stateDirectory;
        private readonly string defaultDirectory;
        private readonly string defaultSceneDirectory;
        private readonly byte[] entropy = Encoding.UTF8.GetBytes("3DsMood.DownloadedLibrary.v1");
        private readonly string mutexName;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
        internal static string StateDirectory { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "3dMood", "Downloads"); } }

        public DownloadedLibrary() : this(StateDirectory, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "3DS Mood", "Models"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "3DS Mood", "Scenes")) { }
        internal DownloadedLibrary(string stateDirectory, string defaultDirectory, string defaultSceneDirectory = null)
        {
            this.stateDirectory = Path.GetFullPath(stateDirectory);
            this.defaultDirectory = Path.GetFullPath(defaultDirectory);
            this.defaultSceneDirectory = Path.GetFullPath(defaultSceneDirectory ?? Path.Combine(defaultDirectory, "Scenes"));
            using (var sha = SHA256.Create()) mutexName = "Local\\3DsMood.Downloads." + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(this.stateDirectory.ToUpperInvariant()))).Replace("-", "");
        }

        private T Locked<T>(Func<DownloadedLibraryState, T> operation, bool save = false)
        {
            using (var mutex = new Mutex(false, mutexName))
            {
                try { mutex.WaitOne(); } catch (AbandonedMutexException) { }
                try
                {
                    var state = Read();
                    var result = operation(state);
                    if (save) Write(state);
                    return result;
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private DownloadedLibraryState Read()
        {
            var path = Path.Combine(stateDirectory, "index.dat");
            if (!File.Exists(path)) return new DownloadedLibraryState { downloadDirectory = defaultDirectory, sceneDownloadDirectory = defaultSceneDirectory };
            try
            {
                if (new FileInfo(path).Length > 40 * 1024 * 1024) throw new InvalidDataException("Download index is too large.");
                var state = json.Deserialize<DownloadedLibraryState>(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), entropy, DataProtectionScope.CurrentUser)));
                if (state == null || state.models == null || state.rights == null || string.IsNullOrEmpty(state.downloadDirectory)) throw new InvalidDataException("Download index is invalid.");
                if (string.IsNullOrEmpty(state.sceneDownloadDirectory)) state.sceneDownloadDirectory = defaultSceneDirectory;
                if (state.favorites == null) state.favorites = new List<string>(); // indexes written before favorites existed
                if (state.favoriteFolders == null) state.favoriteFolders = new List<FavoriteFolder>(); // ... or before favorite folders
                if (state.favoriteFolderOf == null) state.favoriteFolderOf = new Dictionary<string, string>();
                state.favoriteFolders.RemoveAll(folder => folder == null || folder.id == null || folder.name == null);
                // Drop assignments whose model is no longer a favorite or whose folder is gone, so a stale entry can never resurrect.
                foreach (var stale in state.favoriteFolderOf.Where(a => !state.favorites.Contains(a.Key) || !state.favoriteFolders.Any(f => f.id == a.Value)).Select(a => a.Key).ToList())
                    state.favoriteFolderOf.Remove(stale);
                // Older indexes predate the mixed Models/Scenes catalog.
                foreach (var model in state.models)
                    if (model != null)
                    {
                        if (model.product == null) model.product = new Dictionary<string, object>();
                        object domain;
                        if (!model.product.TryGetValue("contentDomain", out domain) || domain == null)
                            model.product["contentDomain"] = "3dmodels";
                    }
                return state;
            }
            catch (Exception e) when (e is CryptographicException || e is ArgumentException || e is InvalidOperationException)
            { throw new InvalidDataException("Không đọc được danh sách model đã tải. Dữ liệu trên đĩa vẫn được giữ nguyên.", e); }
        }

        private void Write(DownloadedLibraryState state)
        {
            Directory.CreateDirectory(stateDirectory);
            RejectReparse(stateDirectory);
            var target = Path.Combine(stateDirectory, "index.dat");
            var temp = target + "." + Guid.NewGuid().ToString("N") + ".part";
            try
            {
                File.WriteAllBytes(temp, ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(state)), entropy, DataProtectionScope.CurrentUser));
                if (File.Exists(target)) File.Replace(temp, target, null); else File.Move(temp, target);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }

        public string DownloadDirectory { get { return Locked(s => s.downloadDirectory); } }
        public string SceneDownloadDirectory { get { return Locked(s => s.sceneDownloadDirectory); } }
        public string DirectoryFor(string contentDomain)
        {
            if (contentDomain == "3dmodels") return DownloadDirectory;
            if (contentDomain == "3dscenes") return SceneDownloadDirectory;
            throw new InvalidDataException("Phân vùng thư viện không hợp lệ.");
        }
        internal const int MaxFavorites = 5000;
        public string[] Favorites() { return Locked(s => s.favorites.ToArray()); }
        public string[] SetFavorite(string modelId, bool favorite)
        {
            Guid parsed;
            if (!Guid.TryParse(modelId, out parsed)) throw new InvalidDataException("Mã model không hợp lệ.");
            var id = parsed.ToString("D");
            return Locked(s =>
            {
                s.favorites.RemoveAll(existing => string.Equals(existing, id, StringComparison.OrdinalIgnoreCase));
                if (favorite)
                {
                    if (s.favorites.Count >= MaxFavorites) throw new InvalidDataException("Danh sách yêu thích đã đầy.");
                    s.favorites.Add(id);
                }
                else s.favoriteFolderOf.Remove(id);
                return s.favorites.ToArray();
            }, true);
        }

        // ---- Favorite folders. A model sits in exactly one folder; "default" (no assignment) is the built-in one. ----
        internal const int MaxFavoriteFolders = 50, MaxFolderNameLength = 40;
        internal const string DefaultFolderId = "default";
        private static readonly string[] ReservedFolderNames = { "default", "tất cả" };

        private static object FavoriteView(DownloadedLibraryState s)
        {
            return new
            {
                favorites = s.favorites.ToArray(),
                folders = s.favoriteFolders.Select(f => new { f.id, f.name, f.contentDomain }).ToArray(),
                assignments = new Dictionary<string, string>(s.favoriteFolderOf)
            };
        }
        public object FavoriteState() { return Locked(s => FavoriteView(s)); }

        private static string NormalizeId(string modelId)
        {
            Guid parsed;
            if (!Guid.TryParse(modelId, out parsed)) throw new InvalidDataException("Mã không hợp lệ.");
            return parsed.ToString("D");
        }
        private static string NormalizeFolderName(string name)
        {
            var value = (name ?? "").Trim();
            if (value.Length == 0 || value.Length > MaxFolderNameLength || value.Any(char.IsControl))
                throw new InvalidDataException("Tên thư mục cần từ 1 đến " + MaxFolderNameLength + " ký tự.");
            if (ReservedFolderNames.Contains(value.ToLowerInvariant())) throw new InvalidDataException("Tên này dành cho thư mục có sẵn. Hãy chọn tên khác.");
            return value;
        }
        private static void RequireUniqueName(DownloadedLibraryState s, string name, string domain, string exceptId)
        {
            if (s.favoriteFolders.Any(f => f.id != exceptId && f.contentDomain == domain && string.Equals(f.name, name, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Đã có thư mục tên này.");
        }
        private static FavoriteFolder FindFolder(DownloadedLibraryState s, string folderId)
        {
            var folder = s.favoriteFolders.FirstOrDefault(f => f.id == folderId);
            if (folder == null) throw new InvalidDataException("Không tìm thấy thư mục yêu thích.");
            return folder;
        }

        /// <summary>Favorites the model if it is not yet, and moves it into the folder ("default" = no folder).</summary>
        public object SetFavoriteFolder(string modelId, string folderId)
        {
            var id = NormalizeId(modelId);
            var folder = folderId == DefaultFolderId ? DefaultFolderId : NormalizeId(folderId);
            return Locked(s =>
            {
                if (folder != DefaultFolderId) FindFolder(s, folder);
                if (!s.favorites.Contains(id))
                {
                    if (s.favorites.Count >= MaxFavorites) throw new InvalidDataException("Danh sách yêu thích đã đầy.");
                    s.favorites.Add(id);
                }
                if (folder == DefaultFolderId) s.favoriteFolderOf.Remove(id); else s.favoriteFolderOf[id] = folder;
                return FavoriteView(s);
            }, true);
        }

        public object CreateFavoriteFolder(string name, string contentDomain)
        {
            var clean = NormalizeFolderName(name);
            if (contentDomain != "3dmodels" && contentDomain != "3dscenes") throw new InvalidDataException("Phân vùng thư viện không hợp lệ.");
            return Locked(s =>
            {
                if (s.favoriteFolders.Count(f => f.contentDomain == contentDomain) >= MaxFavoriteFolders) throw new InvalidDataException("Đã đủ " + MaxFavoriteFolders + " thư mục.");
                RequireUniqueName(s, clean, contentDomain, null);
                s.favoriteFolders.Add(new FavoriteFolder { id = Guid.NewGuid().ToString("D"), name = clean, contentDomain = contentDomain });
                return FavoriteView(s);
            }, true);
        }

        public object RenameFavoriteFolder(string folderId, string name)
        {
            var id = NormalizeId(folderId); var clean = NormalizeFolderName(name);
            return Locked(s =>
            {
                var folder = FindFolder(s, id);
                RequireUniqueName(s, clean, folder.contentDomain, id);
                folder.name = clean;
                return FavoriteView(s);
            }, true);
        }

        /// <summary>Deleting a folder un-favorites every model in it (each model lives in one folder only).</summary>
        public object DeleteFavoriteFolder(string folderId)
        {
            var id = NormalizeId(folderId);
            return Locked(s =>
            {
                FindFolder(s, id);
                var members = s.favoriteFolderOf.Where(a => a.Value == id).Select(a => a.Key).ToList();
                foreach (var member in members) { s.favoriteFolderOf.Remove(member); s.favorites.Remove(member); }
                s.favoriteFolders.RemoveAll(f => f.id == id);
                return FavoriteView(s);
            }, true);
        }
        public object Settings() { return Locked(s => new { downloadDirectory = s.downloadDirectory, sceneDownloadDirectory = s.sceneDownloadDirectory }); }
        public void SetDownloadDirectory(string directory, string contentDomain = "3dmodels")
        {
            if (contentDomain != "3dmodels" && contentDomain != "3dscenes") throw new InvalidDataException("Phân vùng thư viện không hợp lệ.");
            var full = Path.GetFullPath(directory);
            if (!Path.IsPathRooted(directory) || full.StartsWith("\\\\", StringComparison.Ordinal) || full.Length > 200) throw new InvalidDataException("Chọn thư mục trên ổ đĩa cục bộ (đường dẫn dưới 200 ký tự).");
            Directory.CreateDirectory(full);
            RejectReparse(full);
            var probe = Path.Combine(full, ".3dsmood-write-" + Guid.NewGuid().ToString("N"));
            using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write)) { }
            File.Delete(probe);
            Locked(s => { if (contentDomain == "3dscenes") s.sceneDownloadDirectory = full; else s.downloadDirectory = full; return true; }, true);
        }

        internal static void RejectReparse(string path)
        {
            for (var current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
                if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Không hỗ trợ đường dẫn liên kết hoặc junction.");
        }

        private static bool ValidEntry(DownloadedModel model, out string entry)
        {
            entry = null;
            try
            {
                Guid id;
                if (model == null || !Guid.TryParse(model.modelId, out id) || string.IsNullOrEmpty(model.directory) || string.IsNullOrEmpty(model.entryFile)) return false;
                var root = Path.GetFullPath(model.directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                entry = Path.GetFullPath(Path.Combine(root, model.entryFile));
                if (!entry.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !new[] { ".max", ".fbx", ".obj" }.Contains(Path.GetExtension(entry).ToLowerInvariant()) || !File.Exists(entry)) return false;
                RejectReparse(entry);
                return true;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is ArgumentException) { return false; }
        }

        private static bool ValidRelativePath(DownloadedModel model, string relative, out string entry)
        {
            entry = null;
            try
            {
                if (model == null || string.IsNullOrEmpty(model.directory) || string.IsNullOrEmpty(relative) || Path.IsPathRooted(relative)
                    || relative.Contains(":") || relative.Replace('\\', '/').Split('/').Any(p => p == "." || p == ".." || p.Length == 0)) return false;
                var root = Path.GetFullPath(model.directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                entry = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
                if (!entry.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !new[] { ".max", ".fbx", ".obj" }.Contains(Path.GetExtension(entry).ToLowerInvariant()) || !File.Exists(entry)) return false;
                RejectReparse(entry);
                return true;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is ArgumentException) { return false; }
        }

        private static string OptionId(string modelId, string relative)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(modelId.ToLowerInvariant() + "\n" + relative.Replace('\\', '/').ToLowerInvariant()))).Replace("-", "").ToLowerInvariant();
        }

        private static bool ValidOption(DownloadedModel model, ImportOption option, out string entry)
        {
            entry = null;
            return option != null && option.optionId == OptionId(model.modelId, option.relativePath ?? "") && ValidRelativePath(model, option.relativePath, out entry);
        }

        private static bool HasEntry(DownloadedModel model)
        {
            string entry;
            if (model == null) return false;
            return model.importOptions == null ? ValidEntry(model, out entry) : model.importOptions.Any(o => ValidOption(model, o, out entry));
        }

        internal static ImportOption[] BuildOptions(string modelId, string directory, IEnumerable<string> files)
        {
            var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var model = new DownloadedModel { modelId = modelId, directory = directory };
            var result = new List<ImportOption>();
            foreach (var file in files)
            {
                var path = Path.GetFullPath(file);
                if (!new[] { ".max", ".fbx", ".obj" }.Contains(Path.GetExtension(path).ToLowerInvariant())) continue;
                if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Import candidate escapes model directory.");
                var relative = path.Substring(root.Length).Replace('\\', '/'); string valid;
                if (!ValidRelativePath(model, relative, out valid)) throw new InvalidDataException("Unsafe import candidate.");
                var format = Path.GetExtension(path).Substring(1).ToLowerInvariant();
                var rendererMatch = System.Text.RegularExpressions.Regex.Match(relative, @"(?i)(?:^|[^a-z])(v[- _]?ray|corona|arnold|octane|redshift)(?:[^a-z]|$)");
                var year = format == "max" ? System.Text.RegularExpressions.Regex.Match(Path.GetFileNameWithoutExtension(path), @"(?:^|[^0-9])(20[0-2][0-9])(?:[^0-9]|$)") : null;
                result.Add(new ImportOption { optionId = OptionId(modelId, relative), relativePath = relative, label = Path.GetFileName(path), format = format,
                    renderer = rendererMatch.Success ? rendererMatch.Groups[1].Value : null,
                    maxVersion = year != null && year.Success ? (int?)int.Parse(year.Groups[1].Value) : null });
            }
            return result.GroupBy(o => o.relativePath, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).OrderBy(o => o.relativePath, StringComparer.OrdinalIgnoreCase).ToArray();
        }

        internal static ImportOption[] ScanOptions(DownloadedModel model, int maximumEntries = 20000)
        {
            if (!Directory.Exists(model.directory)) return new ImportOption[0];
            var pending = new Stack<string>(); var files = new List<string>(); var count = 0;
            RejectReparse(model.directory); pending.Push(model.directory);
            while (pending.Count > 0)
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(pending.Pop()))
                {
                    if (++count > maximumEntries) throw new InvalidDataException("Model directory exceeds the import candidate scan limit.");
                    RejectReparse(path);
                    if (Directory.Exists(path)) pending.Push(path); else files.Add(path);
                }
            }
            return BuildOptions(model.modelId, model.directory, files);
        }

        private DownloadedModel OptionsModel(string modelId)
        {
            return Locked(s => {
                var model = s.models.FirstOrDefault(m => string.Equals(m.modelId, modelId, StringComparison.OrdinalIgnoreCase));
                if (model == null) throw MissingModel();
                if (model.importOptions == null) { model.importOptions = ScanOptions(model); Write(s); }
                return model;
            });
        }

        private static ApiException MissingModel() { return new ApiException("MODEL_NOT_DOWNLOADED", 404, "Model chưa được tải hoặc file trên đĩa đã bị di chuyển. Hãy tải lại model."); }

        public object ImportOptions(string modelId)
        {
            var model = OptionsModel(modelId);
            var available = model.importOptions.Where(o => { string path; return ValidOption(model, o, out path); }).ToArray();
            var preferred = available.FirstOrDefault(o => string.Equals(o.relativePath.Replace('/', Path.DirectorySeparatorChar), model.entryFile, StringComparison.OrdinalIgnoreCase));
            return new { options = available, defaultOptionId = preferred == null ? null : preferred.optionId };
        }

        public DownloadedModel Find(string modelId)
        {
            return Locked(s => { var m = s.models.FirstOrDefault(x => string.Equals(x.modelId, modelId, StringComparison.OrdinalIgnoreCase)); return HasEntry(m) ? m : null; });
        }
        public object[] List() { return Locked(s => s.models.Where(HasEntry).Select(m => m.PublicView()).ToArray()); }
        public void Add(DownloadedModel model)
        {
            string entry;
            if (!ValidEntry(model, out entry) || (model.importOptions != null && model.importOptions.Any(o => !ValidOption(model, o, out entry)))) throw new InvalidDataException("File model chưa sẵn sàng.");
            Locked(s => { s.models.RemoveAll(m => string.Equals(m.modelId, model.modelId, StringComparison.OrdinalIgnoreCase)); s.models.Add(model); return true; }, true);
        }
        public void RecordRights(string deviceBinding, bool allowed) { Locked(s => { s.rights[deviceBinding] = allowed; return true; }, true); }
        public bool Allows(string deviceBinding) { return Locked(s => { bool allowed; return s.rights.TryGetValue(deviceBinding, out allowed) && allowed; }); }
        public bool HasRights(string deviceBinding) { return Locked(s => s.rights.ContainsKey(deviceBinding)); }
        public string EntryPath(string modelId, string optionId = null)
        {
            var model = OptionsModel(modelId);
            var available = model.importOptions.Where(o => { string path; return ValidOption(model, o, out path); }).ToArray();
            ImportOption selected;
            if (optionId == null)
            {
                if (available.Length == 0) throw MissingModel();
                if (available.Length > 1) throw new ApiException("IMPORT_SELECTION_REQUIRED", 409, "Chọn file model hoặc biến thể trước khi import.");
                selected = available[0];
            }
            else
            {
                selected = model.importOptions.FirstOrDefault(o => string.Equals(o.optionId, optionId, StringComparison.Ordinal));
                if (selected == null) throw new ApiException("IMPORT_OPTION_INVALID", 400, "Lựa chọn file import không hợp lệ. Hãy chọn lại.");
            }
            string entry;
            if (!ValidOption(model, selected, out entry)) throw MissingModel();
            return entry;
        }
        internal bool OwnsEntry(string path)
        {
            var full = Path.GetFullPath(path);
            return Locked(s => s.models.Any(m => {
                string entry;
                if (m.importOptions == null) return ValidEntry(m, out entry) && string.Equals(entry, full, StringComparison.OrdinalIgnoreCase);
                return m.importOptions.Any(o => ValidOption(m, o, out entry) && string.Equals(entry, full, StringComparison.OrdinalIgnoreCase));
            }));
        }

        internal string RootForEntry(string path)
        {
            var full = Path.GetFullPath(path);
            return Locked(s => {
                foreach (var model in s.models)
                {
                    string entry;
                    if (model.importOptions == null
                        ? ValidEntry(model, out entry) && string.Equals(entry, full, StringComparison.OrdinalIgnoreCase)
                        : model.importOptions.Any(option => ValidOption(model, option, out entry) && string.Equals(entry, full, StringComparison.OrdinalIgnoreCase)))
                        return Path.GetFullPath(model.directory);
                }
                throw new InvalidDataException("File import không thuộc model đã tải.");
            });
        }
    }

    /// <summary>Per-import, bounded lookup in the selected model package; usable from MAXScript in any target Max.</summary>
    public sealed class TexturePathResolver
    {
        private readonly string root;
        private readonly string entryDirectory;
        private readonly Dictionary<string, List<string>> names = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public string LastStatus { get; private set; }

        public TexturePathResolver(string entryPath) : this(new DownloadedLibrary().RootForEntry(entryPath), entryPath) { }

        internal TexturePathResolver(string directory, string entryPath, int maximumEntries = 20000)
        {
            root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var entry = Path.GetFullPath(entryPath);
            if (!entry.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Import entry escapes package.");
            entryDirectory = Path.GetDirectoryName(entry);
            var pending = new Stack<string>(); pending.Push(directory);
            var count = 0;
            while (pending.Count > 0)
            {
                var current = pending.Pop();
                DownloadedLibrary.RejectReparse(current);
                foreach (var item in Directory.EnumerateFileSystemEntries(current))
                {
                    if (++count > maximumEntries) throw new InvalidDataException("Gói model vượt giới hạn kiểm tra texture.");
                    DownloadedLibrary.RejectReparse(item);
                    if (Directory.Exists(item)) { pending.Push(item); continue; }
                    var full = Path.GetFullPath(item);
                    files.Add(full.Substring(root.Length), full);
                    var name = Path.GetFileName(full);
                    List<string> candidates;
                    if (!names.TryGetValue(name, out candidates)) names.Add(name, candidates = new List<string>());
                    candidates.Add(full);
                }
            }
        }

        public string Resolve(string reference)
        {
            LastStatus = "missing";
            if (string.IsNullOrWhiteSpace(reference)) return "";
            var value = reference.Trim().Trim('"').Replace('/', '\\');
            try
            {
                if (!Path.IsPathRooted(value))
                {
                    foreach (var baseDirectory in new[] { entryDirectory, root })
                    {
                        var candidate = Path.GetFullPath(Path.Combine(baseDirectory, value));
                        string found;
                        if (candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                            && files.TryGetValue(candidate.Substring(root.Length), out found)) return Found(found);
                    }
                }
                else if (value.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    string found;
                    if (files.TryGetValue(value.Substring(root.Length), out found)) return Found(found);
                }
                List<string> candidates;
                if (names.TryGetValue(Path.GetFileName(value), out candidates))
                {
                    // Preserve the longest useful directory suffix from author-machine paths.
                    var parts = value.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
                    for (var length = parts.Length; length >= 2; length--)
                    {
                        var suffix = "\\" + string.Join("\\", parts.Skip(parts.Length - length));
                        var matches = candidates.Where(path => path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)).ToArray();
                        if (matches.Length == 1) return Found(matches[0]);
                        if (matches.Length > 1) { LastStatus = "ambiguous"; return ""; }
                    }
                    if (candidates.Count == 1) return Found(candidates[0]);
                    LastStatus = "ambiguous"; return "";
                }
                // Keep a valid, explicitly referenced local external asset; never probe UNC shares.
                if (Path.IsPathRooted(value) && !value.StartsWith("\\\\", StringComparison.Ordinal)
                    && value.Length > 2 && value[1] == ':' && File.Exists(value)) return Found(value);
            }
            catch (Exception e) when (e is ArgumentException || e is NotSupportedException || e is IOException || e is UnauthorizedAccessException) { }
            return "";
        }

        private string Found(string path)
        {
            DownloadedLibrary.RejectReparse(path);
            if (!File.Exists(path)) { LastStatus = "missing"; return ""; }
            LastStatus = "resolved";
            return Path.GetFullPath(path);
        }
    }
}
