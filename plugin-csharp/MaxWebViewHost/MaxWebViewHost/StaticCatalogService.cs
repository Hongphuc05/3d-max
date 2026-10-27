using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Text;
using System.Text.RegularExpressions;

namespace MaxWebViewHost
{
    public sealed class CatalogModel
    {
        public string id { get; set; }
        public string name { get; set; }
        public string category { get; set; }
        public string preview { get; set; }
        public string driveFileId { get; set; }
        public string fileName { get; set; }
        public string sha256 { get; set; }
        public string entryFile { get; set; }
    }
    public sealed class CatalogViewItem
    {
        public string id { get; set; }
        public string name { get; set; }
        public string category { get; set; }
        public string preview { get; set; }
    }
    public sealed class CatalogSnapshot
    {
        public int version { get; set; }
        public CatalogViewItem[] items { get; set; }
        public bool offline { get; set; }
        public string message { get; set; }
    }
    public sealed class StaticCatalogService : IDisposable
    {
        private sealed class Document { public int version { get; set; } public CatalogModel[] items { get; set; } }
        private static readonly Uri CatalogBase = new Uri("https://app.3dsmood.local/bundled-library/catalog.json");
        private readonly string directory;
        private volatile CatalogModel[] models = new CatalogModel[0];
        private const int CatalogLimit = 8 * 1024 * 1024;
        private const int PreviewLimit = 2 * 1024 * 1024;
        public StaticCatalogService(string libraryDirectory)
        {
            if (string.IsNullOrWhiteSpace(libraryDirectory)) throw new InvalidDataException("Thiếu thư viện trong bộ cài.");
            directory = Path.GetFullPath(libraryDirectory);
        }
        public static CatalogModel[] Parse(string json,Uri baseUri)
        {
            try {
                if(json==null || Encoding.UTF8.GetByteCount(json)>CatalogLimit) throw new InvalidDataException("Catalog quá lớn.");
                var document=new JavaScriptSerializer { MaxJsonLength=CatalogLimit, RecursionLimit=16 }.Deserialize<Document>(json);
                if(document==null || document.version!=1 || document.items==null || document.items.Length>10000)
                    throw new InvalidDataException("Phiên bản hoặc cấu trúc catalog không hợp lệ.");
                var ids=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach(var item in document.items) {
                    if(item==null || !Match(item.id,"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$") || !ids.Add(item.id)
                        || string.IsNullOrWhiteSpace(item.name) || item.name.Length>200 || string.IsNullOrWhiteSpace(item.category) || item.category.Length>200
                        || !Match(item.driveFileId,"^[A-Za-z0-9_-]{10,200}$") || !Match(item.sha256,"^[a-fA-F0-9]{64}$")
                        || !SafeRelative(item.fileName) || item.fileName.Contains("/") || item.fileName.Length>200
                        || !AllowedExtension(item.fileName,new[]{".zip",".rar",".7z",".max",".fbx",".obj"})
                        || !SafeRelative(item.preview) || !AllowedExtension(item.preview,new[]{".png",".jpg",".jpeg",".webp"})
                        || (!string.IsNullOrEmpty(item.entryFile) && (!SafeRelative(item.entryFile) || !AllowedExtension(item.entryFile,new[]{".max",".fbx",".obj"}))))
                        throw new InvalidDataException("Thông tin model trong catalog không hợp lệ.");
                    var previewUri=new Uri(baseUri,item.preview);
                    if(previewUri.GetLeftPart(UriPartial.Authority)!=baseUri.GetLeftPart(UriPartial.Authority)) throw new InvalidDataException("Ảnh preview phải cùng nguồn catalog.");
                }
                return document.items;
            } catch(ArgumentException) { throw new InvalidDataException("Không đọc được JSON catalog."); }
              catch(InvalidOperationException) { throw new InvalidDataException("Không đọc được JSON catalog."); }
        }
        private static bool Match(string value,string expression) { return value!=null && !value.Any(char.IsControl) && Regex.IsMatch(value,expression); }
        private static bool AllowedExtension(string value,string[] allowed) { return allowed.Contains(Path.GetExtension(value).ToLowerInvariant()); }
        internal static bool SafeRelative(string path)
        {
            if(string.IsNullOrEmpty(path) || path.Length>512 || path.IndexOfAny(new[]{'\\',':','%','?','#'})>=0) return false;
            return path.Split('/').All(p=>p.Length>0 && p!="." && p!=".." && !p.EndsWith(".") && !p.EndsWith(" ")
                && p.IndexOfAny(Path.GetInvalidFileNameChars())<0 && !Regex.IsMatch(p.Split('.')[0],"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$",RegexOptions.IgnoreCase));
        }
        public CatalogModel Find(string id)
        {
            var item=models.FirstOrDefault(m=>string.Equals(m.id,id,StringComparison.Ordinal));
            if(item==null) throw new InvalidDataException("Model không có trong thư viện đã cài.");
            return new CatalogModel { id=item.id,name=item.name,category=item.category,preview=item.preview,driveFileId=item.driveFileId,fileName=item.fileName,sha256=item.sha256,entryFile=item.entryFile };
        }
        public Task<CatalogSnapshot> RefreshAsync(CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var path = Path.Combine(directory, "catalog.json");
            if (!File.Exists(path) || new FileInfo(path).Length > CatalogLimit)
                throw new InvalidDataException("Bộ cài thiếu catalog. Hãy cài lại phiên bản đầy đủ.");
            var parsed = Parse(File.ReadAllText(path, Encoding.UTF8), CatalogBase);
            models = parsed;
            var views = parsed.Select(item => new CatalogViewItem {
                id = item.id, name = item.name, category = item.category,
                preview = "https://app.3dsmood.local/library-previews/" + PreviewKey(item.preview)
            }).ToArray();
            return Task.FromResult(new CatalogSnapshot { version=1, items=views, offline=false, message="" });
        }
        private static string PreviewKey(string preview)
        {
            return Hash(Encoding.UTF8.GetBytes(preview)) + Path.GetExtension(preview).ToLowerInvariant();
        }
        public Task<byte[]> GetPreviewAsync(string key, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (key == null || !Regex.IsMatch(key, "\\A[a-f0-9]{64}\\.(png|jpg|jpeg|webp)\\z"))
                throw new InvalidDataException("Ảnh preview không hợp lệ.");
            var item = models.FirstOrDefault(candidate => PreviewKey(candidate.preview) == key);
            if (item == null) throw new InvalidDataException("Ảnh preview không có trong catalog.");
            var path = Path.GetFullPath(Path.Combine(directory, item.preview.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(directory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || !File.Exists(path) || new FileInfo(path).Length > PreviewLimit)
                throw new InvalidDataException("Bộ cài thiếu ảnh preview.");
            var bytes = File.ReadAllBytes(path);
            ValidateImage(bytes, item.preview);
            return Task.FromResult(bytes);
        }
        internal static async Task<byte[]> ReadBoundedAsync(Stream source,int limit,CancellationToken token)
        {
            using(var output=new MemoryStream()) { var buffer=new byte[32768]; int count;
                while((count=await source.ReadAsync(buffer,0,buffer.Length,token).ConfigureAwait(false))>0) { if(output.Length+count>limit) throw new InvalidDataException("Nội dung vượt giới hạn."); output.Write(buffer,0,count); }
                return output.ToArray(); }
        }
        private static string ImageType(string path) { var ext=Path.GetExtension(path).ToLowerInvariant(); return ext==".png"?"image/png":ext==".webp"?"image/webp":"image/jpeg"; }
        private static void ValidateImage(byte[] data,string path)
        {
            var type=ImageType(path);
            var valid=type=="image/png" ? data.Length>=8 && data.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10})
                : type=="image/jpeg" ? data.Length>=3 && data[0]==255 && data[1]==216 && data[2]==255
                : data.Length>=12 && Encoding.ASCII.GetString(data,0,4)=="RIFF" && Encoding.ASCII.GetString(data,8,4)=="WEBP";
            if(!valid) throw new InvalidDataException("Preview không phải ảnh hợp lệ.");
        }
        internal static bool Recoverable(Exception e) { return e is InvalidDataException || e is IOException || e is HttpRequestException || e is OperationCanceledException || e is UnauthorizedAccessException || e is ArgumentException || e is InvalidOperationException; }
        internal static string Hash(byte[] data) { using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(data)).Replace("-","").ToLowerInvariant(); }
        public void Dispose() { }
    }
}
