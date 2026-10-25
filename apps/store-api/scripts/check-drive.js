// Operator diagnostic: uses only the official Drive API, never publishes a URL/key.
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadDriveConfig } from '../src/drive/config.js';
import { GoogleDriveCatalogProvider } from '../src/drive/provider.js';
import { PreviewCache } from '../src/drive/preview-cache.js';

const config=loadDriveConfig();
if(!config.configured){console.error('Drive configuration required:',config.errors.join(', '));process.exitCode=1;}
else {
  const provider=new GoogleDriveCatalogProvider({config});
  try {
    const scan=await provider.scan();
    console.log(JSON.stringify({root:scan.folders[0].name,folders:scan.folders.length,files:scan.filesScanned,models:scan.models.length}));
    const jpg=scan.models.find(model=>model.preview?.mimeType==='image/jpeg');
    if(jpg){const cache=new PreviewCache({directory:config.previewCacheDir,provider});await cache.prepare(jpg);console.log('JPG preview download and image validation: passed');}
    else console.log('JPG preview: no paired JPEG found; not verified');
    if(process.argv.includes('--download-archive')){
      const archive=scan.models.filter(model=>['.rar','.zip'].includes(model.archiveExtension)&&model.canDownload).sort((a,b)=>Number(a.size)-Number(b.size))[0];
      if(!archive)throw Object.assign(new Error(),{code:'NO_DOWNLOADABLE_ZIP_RAR'});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30*60000);
      let bytes=0n;
      try{
        const response=await provider.openDownload(archive,{signal:controller.signal});
        await pipeline(response.data,new Writable({write(chunk,_encoding,done){bytes+=BigInt(chunk.length);done();}}),{signal:controller.signal});
        if(archive.size!=null&&bytes!==BigInt(archive.size))throw Object.assign(new Error(),{code:'DRIVE_ARCHIVE_SIZE_MISMATCH'});
        console.log(JSON.stringify({archiveExtension:archive.archiveExtension,streamedBytes:bytes.toString(),archiveDownload:'passed',retainedArchive:false}));
      }finally{clearTimeout(timer);controller.abort();}
    }
  }catch(error){console.error('Drive check failed:',/^[A-Z_]+$/.test(error.code||'')?error.code:'DRIVE_CHECK_FAILED');process.exitCode=1;}
}
