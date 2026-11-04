using System;
using System.IO;
using System.Text;
using System.Threading;
using MaxWebViewHost;
class BundledCatalogTests {
 static void Main() {
  var root=Path.Combine(Path.GetTempPath(),"bundled-catalog-"+Guid.NewGuid().ToString("N"));
  Directory.CreateDirectory(Path.Combine(root,"previews"));
  try {
   File.WriteAllText(Path.Combine(root,"catalog.json"),"{\"version\":1,\"items\":[{\"id\":\"chair\",\"name\":\"Chair\",\"category\":\"Seats\",\"preview\":\"previews/a.png\",\"driveFileId\":\"abc_123456789\",\"fileName\":\"chair.zip\",\"sha256\":\""+new string('a',64)+"\"}]}");
   File.WriteAllBytes(Path.Combine(root,"previews","a.png"),new byte[]{137,80,78,71,13,10,26,10});
   using(var service=new StaticCatalogService(root)) {
    var snapshot=service.RefreshAsync(CancellationToken.None).GetAwaiter().GetResult();
    if(snapshot.items.Length!=1 || service.Find("chair").driveFileId!="abc_123456789") throw new Exception("catalog model");
    var key=Path.GetFileName(new Uri(snapshot.items[0].preview).AbsolutePath);
    if(service.GetPreviewAsync(key,CancellationToken.None).GetAwaiter().GetResult().Length!=8) throw new Exception("offline image");
    try { service.GetPreviewAsync("../a.png",CancellationToken.None).GetAwaiter().GetResult(); throw new Exception("unsafe preview accepted"); } catch(InvalidDataException) {}
   }
   Console.WriteLine("Bundled catalog offline tests passed.");
  } finally { Directory.Delete(root,true); }
 }
}
