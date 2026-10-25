import { createHash } from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function folderPaths(relative) {
  const parts=relative.split('/');
  return parts.slice(0,-1).map((_part,index)=>parts.slice(0,index+1).join('/')).filter(Boolean);
}

export function buildCatalog(objects,rootPrefix) {
  const folders=new Map(),groups=new Map(),seen=new Set();
  for(const object of objects) {
    if(typeof object.key!=='string' || !object.key.startsWith(rootPrefix)) continue;
    if(seen.has(object.key)) throw new Error('R2_DUPLICATE_OBJECT');
    seen.add(object.key);
    const relative=object.key.slice(rootPrefix.length);
    if(!relative) continue;
    for(const folder of folderPaths(relative)) {
      const slash=folder.lastIndexOf('/');
      folders.set(folder,{id:folder,path:folder,name:folder.slice(slash+1),parentId:slash<0?null:folder.slice(0,slash),depth:folder.split('/').length});
    }
    if(relative.endsWith('/')) continue;
    const slash=relative.lastIndexOf('/'),filename=relative.slice(slash+1);
    const match=filename.match(/\.(jpg|jpeg|zip|rar)$/i);
    if(!match) continue;
    const extension=match[0].toLowerCase(),basename=filename.slice(0,-match[0].length),folderId=relative.slice(0,Math.max(0,slash));
    const identity=JSON.stringify([folderId,basename]);
    const group=groups.get(identity) || {folderId,name:basename,previews:[],archives:[]};
    const member={...object,extension};
    groups.set(identity,{...group,[['.jpg','.jpeg'].includes(extension)?'previews':'archives']:[...group[['.jpg','.jpeg'].includes(extension)?'previews':'archives'],member]});
  }
  const models=[...groups.values()].map(group=>{
    const conflict=group.archives.length>1 || group.previews.length>1;
    const archive=group.archives.length===1?group.archives[0]:null,preview=group.previews.length===1?group.previews[0]:null;
    const status=conflict?'conflict':!archive?'missing_archive':!preview?'missing_preview':'ready';
    return {folderId:group.folderId,name:group.name,basename:group.name,status,archiveId:archive?.key || null,archiveExtension:archive?.extension || null,
      size:archive?.size ?? null,modifiedTime:archive?.lastModified || null,checksum:archive?.etag || null,canDownload:status==='ready',
      previewId:preview?.key || null,previewVersion:preview?hash([preview.key,preview.etag,preview.size,preview.lastModified]).slice(0,24):null,
      previewMetadata:preview?{size:preview.size,etag:preview.etag,lastModified:preview.lastModified}:null};
  });
  return {objects,folders:[...folders.values()].sort((a,b)=>a.path.localeCompare(b.path)),models:models.sort((a,b)=>`${a.folderId}/${a.name}`.localeCompare(`${b.folderId}/${b.name}`)),filesScanned:seen.size};
}
