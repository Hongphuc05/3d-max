using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MaxWebViewHost;

class StaticCatalogTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage,HttpResponseMessage> Reply;
        public Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> AsyncReply;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r,CancellationToken t) { return AsyncReply != null ? AsyncReply(r,t) : Task.FromResult(Reply(r)); }
    }
    static void Check(bool value,string name) { if(!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static void Reject(Action action,string name) { try { action(); } catch(InvalidDataException) { Console.WriteLine("PASS " + name); return; } throw new Exception(name); }
    static string Json(string preview="previews/a.png", string id="chair") { return "{\"version\":1,\"items\":[{\"id\":\""+id+"\",\"name\":\"Chair\",\"category\":\"Chairs\",\"preview\":\""+preview+"\",\"driveFileId\":\"abc_123456789\",\"fileName\":\"chair.zip\",\"sha256\":\""+new string('a',64)+"\"}]}"; }
    static void Main() { Run().GetAwaiter().GetResult(); }
    static async Task Run()
    {
        var root=Path.Combine(Path.GetTempPath(),"catalog-tests-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try {
            var uri=new Uri("https://example.github.io/library/catalog.json");
            Reject(()=>StaticCatalogService.Parse(Json("../secret.png"),uri),"preview traversal rejected");
            Reject(()=>StaticCatalogService.Parse(Json("https://evil.test/a.png"),uri),"foreign preview rejected");
            Reject(()=>StaticCatalogService.Parse(Json("previews/a.png","../bad"),uri),"unsafe id rejected");
            Reject(()=>StaticCatalogService.Parse(Json().Replace("chair.zip","chair.exe"),uri),"executable rejected");
            Reject(()=>StaticCatalogService.Parse(Json().Replace("abc_123456789","abc_123456789\\n"),uri),"control character id rejected");
            Reject(()=>StaticCatalogService.Parse(Json().Replace("chair.zip","CON.zip"),uri),"reserved filename rejected");
            Reject(()=>StaticCatalogService.Parse(Json().Replace("\"fileName\"","\"entryFile\":\"../chair.max\",\"fileName\""),uri),"unsafe entry path rejected");
            Reject(()=>StaticCatalogService.Parse(Json().Replace("\"version\":1","\"version\":2"),uri),"unknown version rejected");
            Check(StaticCatalogService.Parse("{\"version\":1,\"items\":[]}",uri).Length==0,"empty real catalog supported");
            Reject(()=>StaticCatalogService.Parse(Json().Replace(new string('a',64),""),uri),"checksum required");
            var bundled = Path.Combine(root, "library");
            Directory.CreateDirectory(Path.Combine(bundled, "previews"));
            File.WriteAllText(Path.Combine(bundled, "catalog.json"), Json());
            File.WriteAllBytes(Path.Combine(bundled, "previews", "a.png"), new byte[]{137,80,78,71,13,10,26,10});
            using(var service = new StaticCatalogService(bundled)) {
                var first = await service.RefreshAsync(CancellationToken.None);
                Check(first.items.Length == 1 && first.items[0].preview.StartsWith("https://app.3dsmood.local/library-previews/"), "bundled catalog loads and uses local preview URL");
                var key = Path.GetFileName(new Uri(first.items[0].preview).AbsolutePath);
                Check((await service.GetPreviewAsync(key, CancellationToken.None)).Length == 8, "first-run preview available offline");
                Check(service.Find("chair").driveFileId == "abc_123456789", "model maps to packaged Drive ID");
                try { await service.GetPreviewAsync("../a.png", CancellationToken.None); throw new Exception("invalid preview accepted"); } catch(InvalidDataException) { Check(true, "preview traversal rejected"); }
                File.Delete(Path.Combine(bundled, "previews", "a.png"));
                try { await service.GetPreviewAsync(key, CancellationToken.None); throw new Exception("missing preview accepted"); } catch(InvalidDataException) { Check(true, "missing preview rejected without network"); }
            }
            var fake=new Fake();
            Reject(()=>GoogleDriveDownloader.ValidateDownloadUri(new Uri("https://evil.test/file")),"download host allowlist");
            Reject(()=>GoogleDriveDownloader.ValidateDownloadUri(new Uri("http://drive.google.com/file")),"download requires https");
            Reject(()=>GoogleDriveDownloader.ValidateDownloadUri(new Uri("https://drive.google.com.evil.test/file")),"spoofed Google host rejected");
            var confirm=GoogleDriveDownloader.ConfirmationUri("<form action=\"https://drive.usercontent.google.com/download\" method=\"get\"><input name=\"confirm\" value=\"t\"><input name=\"id\" value=\"attacker\"><input name=\"uuid\" value=\"abc-123\"></form>","original");
            Check(confirm.Query.Contains("id=original") && !confirm.Query.Contains("attacker"),"confirmation keeps authoritative file id");
            Reject(()=>GoogleDriveDownloader.ConfirmationUri("<form action=\"https://evil.test/download\"><input name=\"confirm\" value=\"t\"></form>","original"),"confirmation foreign host rejected");
            var data=Encoding.UTF8.GetBytes("test-model-bytes");
            var model=StaticCatalogService.Parse(Json(),uri)[0]; model.sha256=StaticCatalogService.Hash(data);
            fake.Reply=r=>new HttpResponseMessage(HttpStatusCode.OK) {Content=new ByteArrayContent(data)};
            using(var drive=new GoogleDriveDownloader(new HttpClient(fake))) {
                var file=Path.Combine(root,"download.zip"); await drive.DownloadAsync(model,file,CancellationToken.None); Check(File.ReadAllBytes(file).Length==data.Length,"verified download");
                File.Delete(file); model.sha256=new string('b',64);
                try { await drive.DownloadAsync(model,file,CancellationToken.None); throw new Exception("hash accepted"); } catch(InvalidDataException) { Check(!File.Exists(file),"hash mismatch never publishes file"); }
                fake.Reply=r=>new HttpResponseMessage(HttpStatusCode.OK) {Content=new StringContent("<html>quota exceeded</html>",Encoding.UTF8,"text/html")};
                try { await drive.DownloadAsync(model,file,CancellationToken.None); throw new Exception("html accepted"); } catch(InvalidDataException) { Check(!File.Exists(file),"Drive HTML rejected"); }
                fake.Reply=r=>new HttpResponseMessage(HttpStatusCode.Redirect) {Headers={Location=new Uri("https://evil.test/package")}};
                try { await drive.DownloadAsync(model,file,CancellationToken.None); throw new Exception("redirect accepted"); } catch(InvalidDataException) { Check(!File.Exists(file),"unsafe redirect rejected"); }
                fake.Reply=r=>new HttpResponseMessage(HttpStatusCode.Forbidden);
                try { await drive.DownloadAsync(model,file,CancellationToken.None); throw new Exception("403 accepted"); } catch(InvalidDataException) { Check(!File.Exists(file),"Drive permission failure handled"); }
                fake.Reply=r=>{var response=new HttpResponseMessage(HttpStatusCode.OK) {Content=new ByteArrayContent(data)};response.Content.Headers.ContentLength=data.Length+1;return response;};
                try { await drive.DownloadAsync(model,file,CancellationToken.None); throw new Exception("truncation accepted"); } catch(InvalidDataException) { Check(!File.Exists(file),"truncated response rejected"); }
                using(var cancelled=new CancellationTokenSource()) {cancelled.Cancel();try {await drive.DownloadAsync(model,file,cancelled.Token);throw new Exception("cancel ignored");}catch(OperationCanceledException){Check(!File.Exists(file),"cancelled download not published");}}
            }
        } finally { Directory.Delete(root,true); }
    }
}
