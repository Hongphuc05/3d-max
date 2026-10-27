using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace MaxWebViewHost
{
    public sealed class GoogleDriveDownloader : IDisposable
    {
        private readonly HttpClient http;
        private const long MaximumBytes=4L*1024*1024*1024;
        public GoogleDriveDownloader() : this(SecureHttpTransport.CreateClient(false,true,TimeSpan.FromMinutes(30))) { }
        internal GoogleDriveDownloader(HttpClient http) { this.http=http; }
        internal static void ValidateDownloadUri(Uri uri)
        {
            var host=uri.DnsSafeHost;
            if(uri.Scheme!="https" || !uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)
                || !(host=="drive.google.com" || host=="drive.usercontent.google.com" || host=="drive.googleusercontent.com" || host.EndsWith(".googleusercontent.com",StringComparison.Ordinal)))
                throw new InvalidDataException("Google Drive trả về địa chỉ tải không được phép.");
        }
        public async Task DownloadAsync(CatalogModel model,string destination,CancellationToken token,Action<long,long?> progress=null)
        {
            using(var deadline=CancellationTokenSource.CreateLinkedTokenSource(token)) {
            deadline.CancelAfter(TimeSpan.FromMinutes(30)); token=deadline.Token;
            if(model==null || !Regex.IsMatch(model.driveFileId??"","\\A[A-Za-z0-9_-]{10,200}\\z") || !Regex.IsMatch(model.sha256??"","\\A[a-fA-F0-9]{64}\\z"))
                throw new InvalidDataException("Thông tin tải model không hợp lệ.");
            var uri=new Uri("https://drive.google.com/uc?export=download&id="+Uri.EscapeDataString(model.driveFileId));
            var temp=destination+"."+Guid.NewGuid().ToString("N")+".part";
            try {
                for(var step=0;step<8;step++) {
                    token.ThrowIfCancellationRequested(); ValidateDownloadUri(uri);
                    using(var response=await http.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,token).ConfigureAwait(false))
                    using(var abort=token.Register(()=>response.Dispose())) {
                        var status=(int)response.StatusCode;
                        if(status>=300 && status<400) {
                            if(response.Headers.Location==null) throw new InvalidDataException("Google Drive thiếu địa chỉ tải.");
                            uri=new Uri(uri,response.Headers.Location); continue;
                        }
                        if(!response.IsSuccessStatusCode) throw new InvalidDataException("Không tải được model từ Google Drive (HTTP "+status+"). Kiểm tra quyền chia sẻ hoặc hạn mức tải rồi thử lại.");
                        var type=response.Content.Headers.ContentType;
                        if(type!=null && (type.MediaType=="text/html" || type.MediaType=="application/xhtml+xml")) {
                            using(var body=await response.Content.ReadAsStreamAsync().ConfigureAwait(false)) {
                                var html=Encoding.UTF8.GetString(await StaticCatalogService.ReadBoundedAsync(body,256*1024,token).ConfigureAwait(false));
                                uri=ConfirmationUri(html,model.driveFileId); continue;
                            }
                        }
                        await SaveVerifiedAsync(response,temp,model.sha256,token,progress).ConfigureAwait(false);
                        token.ThrowIfCancellationRequested(); File.Move(temp,destination); return;
                    }
                }
                throw new InvalidDataException("Google Drive yêu cầu xác nhận nhiều lần. Kiểm tra quyền chia sẻ và hạn mức tải.");
            } catch(HttpRequestException) { throw new IOException("Không kết nối được Google Drive. Kiểm tra mạng rồi thử Import lại."); }
            finally { if(File.Exists(temp)) File.Delete(temp); }
            }
        }
        private static async Task SaveVerifiedAsync(HttpResponseMessage response,string path,string expected,CancellationToken token,Action<long,long?> progress)
        {
            var length=response.Content.Headers.ContentLength;
            if(length>MaximumBytes) throw new InvalidDataException("Model vượt giới hạn tải 4 GB.");
            using(var abort=token.Register(()=>response.Dispose()))
            using(var source=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
            using(var output=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            using(var hash=SHA256.Create()) {
                var buffer=new byte[65536]; long total=0; int count;
                while((count=await source.ReadAsync(buffer,0,buffer.Length,token).ConfigureAwait(false))>0) {
                    if(total==0 && Encoding.ASCII.GetString(buffer,0,Math.Min(count,512)).TrimStart().StartsWith("<",StringComparison.Ordinal))
                        throw new InvalidDataException("Google Drive trả về trang đăng nhập hoặc lỗi. File cần chia sẻ Anyone with the link và còn hạn mức tải.");
                    total+=count; if(total>MaximumBytes) throw new InvalidDataException("Model vượt giới hạn tải 4 GB.");
                    hash.TransformBlock(buffer,0,count,buffer,0);
                    await output.WriteAsync(buffer,0,count,token).ConfigureAwait(false);
                    if(progress!=null) progress(total,length);
                }
                hash.TransformFinalBlock(new byte[0],0,0);
                if(total==0 || (length.HasValue && total!=length.Value)) throw new InvalidDataException("Tải model chưa đầy đủ. Thử Import lại.");
                var actual=BitConverter.ToString(hash.Hash).Replace("-","");
                if(!string.Equals(actual,expected,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("File model không khớp thư viện trong bộ cài. Hãy liên hệ nhà cung cấp.");
            }
        }
        internal static Uri ConfirmationUri(string html,string id)
        {
            // Accept only Google's download-confirmation GET form and fixed scalar fields.
            // Never execute HTML/JavaScript or follow arbitrary links from an error page.
            foreach(Match form in Regex.Matches(html,"<form\\b([^>]*)>([\\s\\S]*?)</form>",RegexOptions.IgnoreCase)) {
                var attributes=Attributes(form.Groups[1].Value);
                string action,method;
                if(!attributes.TryGetValue("action",out action) || (attributes.TryGetValue("method",out method) && !string.Equals(method,"get",StringComparison.OrdinalIgnoreCase))) continue;
                Uri uri; if(!Uri.TryCreate(action,UriKind.Absolute,out uri)) continue;
                ValidateDownloadUri(uri);
                if(uri.Host!="drive.usercontent.google.com" || uri.AbsolutePath!="/download" || uri.Query!="") continue;
                var fields=new Dictionary<string,string>(StringComparer.Ordinal) {{"id",id},{"export","download"}};
                foreach(Match input in Regex.Matches(form.Groups[2].Value,"<input\\b([^>]*)>",RegexOptions.IgnoreCase)) {
                    var attrs=Attributes(input.Groups[1].Value); string name,value;
                    if(!attrs.TryGetValue("name",out name) || !attrs.TryGetValue("value",out value)) continue;
                    if((name=="confirm" || name=="uuid") && Regex.IsMatch(value,"\\A[A-Za-z0-9_-]{1,200}\\z")) fields[name]=value;
                }
                if(!fields.ContainsKey("confirm")) continue;
                return new Uri(uri.AbsoluteUri+"?"+string.Join("&",fields.Select(f=>Uri.EscapeDataString(f.Key)+"="+Uri.EscapeDataString(f.Value))));
            }
            throw new InvalidDataException("Google Drive chưa cho tải file: cần chia sẻ Anyone with the link, kiểm tra hạn mức tải hoặc trạng thái file. Thử lại sau hoặc liên hệ nhà cung cấp.");
        }
        private static Dictionary<string,string> Attributes(string text)
        {
            var result=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach(Match match in Regex.Matches(text,"([A-Za-z][A-Za-z0-9_-]*)\\s*=\\s*[\"']([^\"']*)[\"']")) result[match.Groups[1].Value]=WebUtility.HtmlDecode(match.Groups[2].Value);
            return result;
        }
        public void Dispose() { http.Dispose(); }
    }
}
