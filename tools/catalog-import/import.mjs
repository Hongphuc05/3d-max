import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, renameSync, unlinkSync, copyFileSync, openSync, closeSync, realpathSync, writeFileSync, lstatSync, statSync } from 'node:fs';
import { resolve, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../../library/validate-catalog.mjs';
import { createDriveApiLister } from './drive-api.mjs';

const FOLDER = 'application/vnd.google-apps.folder';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const MODEL = /\.(?:zip|rar|7z|max|fbx|obj)$/i;
const IMAGE = /\.(?:png|jpe?g|webp)$/i;
const limit = 4 * 1024 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const atomic = (path, data) => { mkdirSync(dirname(path), {recursive:true}); const tmp = `${path}.${process.pid}.${Date.now()}.tmp`; try { const fd = openSync(tmp,'wx'); try { writeFileSync(fd,data); } finally { closeSync(fd); } renameSync(tmp,path); } finally { if (existsSync(tmp)) unlinkSync(tmp); } };

export function parseListing(html, {folderId} = {}) {
 const match = /window\['_DRIVE_ivd'\]\s*=\s*'([^']*)'/.exec(html);
 if (!match || match[1].length > 16 * 1024 * 1024) throw new Error('Drive folder listing is unavailable; check access and quota.');
 let payload,rows;
 try {
  const literal = match[1].replace(/\\x([a-fA-F0-9]{2})/g, (_,n) => `\\u00${n}`);
  payload = JSON.parse(JSON.parse(`"${literal}"`)); rows = payload[0];
 } catch { throw new Error('Drive folder listing has an unsupported format.'); }
 if (rows === null && ID.test(folderId ?? '') && Array.isArray(payload) && payload.length === 6
     && payload.slice(0,4).every(value=>value === null) && Array.isArray(payload[4]) && payload[5] === 1
     && JSON.stringify(payload[4]).includes(`"${folderId}"`)) return null;
 if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Invalid or oversized folder listing.');
 return rows.map(row => {
  if (!Array.isArray(row) || !ID.test(row[0] ?? '') || typeof row[2] !== 'string' || typeof row[3] !== 'string') throw new Error('Invalid Drive item metadata.');
  return {id:row[0],name:row[2],mime:row[3],size:row[13],modified:row[10]};
 });
}
export function parseEmbeddedEmpty(html) {
 if(typeof html !== 'string' || !/<title>[^<]+<\/title>/i.test(html) || !/<\/body>\s*<\/html>\s*$/i.test(html)
    || !/<div\s+id="flip-contents"/i.test(html) || !/<div\s+class="flip-entries"\s*>\s*<\/div>/i.test(html)
    || /class="flip-entry(?:\s|")/i.test(html)) throw new Error('Embedded folder view does not confirm an empty folder.');
 return true;
}

export function pairFiles(entries) {
 const models = entries.filter(e=>MODEL.test(e.name));
 const images = entries.filter(e=>IMAGE.test(e.name));
 const result=[];
 for (const archive of models) {
  const name=archive.name.slice(0,-extname(archive.name).length);
  const peers=models.filter(e=>e.name.slice(0,-extname(e.name).length).toLowerCase()===name.toLowerCase());
  const matches=images.filter(e=>e.name.slice(0,-extname(e.name).length)===name);
  if(peers.length!==1 || matches.length>1) throw new Error(`Ambiguous model or preview: ${name}`);
  result.push({archive,preview:matches[0] ?? null,name});
 }
 return result;
}
export function validateImage(data,extension) {
 const e=extension.toLowerCase();
 const valid=data.length<=2*1024*1024 && (e==='.png' ? data.length>=8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
 : e==='.webp' ? data.length>=12 && data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP'
 : ['.jpg','.jpeg'].includes(e) && data.length>=3 && data[0]===255 && data[1]===216 && data[2]===255);
 if(!valid) throw new Error('Invalid or oversized preview image.');
}
export function downloadUrl(value) {
 const url=new URL(value); const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:' || url.port || url.username || url.password || url.hash || !(host==='drive.google.com' || host==='drive.usercontent.google.com' || host==='drive.googleusercontent.com' || host.endsWith('.googleusercontent.com'))) throw new Error('Drive returned an unsafe download URL.');
 return url;
}
export function parseConfirmation(html,id) {
 for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
  const attr = s => Object.fromEntries([...s.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2].replaceAll('&amp;','&')]));
  const form=attr(match[1]); let url;
  try { url=downloadUrl(form.action); } catch { continue; }
  if(url.hostname!=='drive.usercontent.google.com' || url.pathname!=='/download' || url.search || (form.method && form.method.toLowerCase()!=='get')) continue;
  const fields={}; for(const input of match[2].matchAll(/<input\b([^>]*)>/gi)) { const a=attr(input[1]); if(['confirm','uuid'].includes(a.name) && /^[A-Za-z0-9_-]{1,200}$/.test(a.value??'')) fields[a.name]=a.value; }
  if(!fields.confirm) continue;
  url.search=new URLSearchParams({id,export:'download',...fields}).toString(); return url.href;
 }
 throw new Error('Drive returned a login, quota, or unsupported confirmation page. Check file sharing and wait before retrying.');
}
async function checkedFetch(uri,options={}) {
 const response=await fetch(uri,{...options,redirect:'manual',signal:AbortSignal.timeout(30000)});
 if(!response.ok) {const error=new Error(`Drive HTTP ${response.status}; check access or quota before retrying.`); error.transient=response.status>=500; throw error;}
 return response;
}
export async function list(id) {
 const response=await checkedFetch(`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`);
 const html=(await collect(response,16*1024*1024)).toString('utf8');
 const result=parseListing(html,{folderId:id});
 if(result!==null) return result;
 const embedded=await checkedFetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`);
 const view=(await collect(embedded,16*1024*1024)).toString('utf8');
 parseEmbeddedEmpty(view);
 const mainTitle=/<title>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/ - Google Drive$/,'');
 const embeddedTitle=/<title>([^<]+)<\/title>/i.exec(view)?.[1];
 if(!mainTitle || mainTitle!==embeddedTitle) throw new Error('Empty folder view does not match the requested folder.');
 return [];
}
export async function download(id,max,consume) {
 if(!ID.test(id)) throw new Error('Invalid file ID.');
 let uri=new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
 for(let step=0;step<8;step++) {
  downloadUrl(uri);
  const response=await fetch(uri,{redirect:'manual',signal:AbortSignal.timeout(30*60*1000)});
  if(response.status>=300 && response.status<400) { const location=response.headers.get('location'); if(!location) throw new Error('Drive redirect has no destination.'); await response.body?.cancel(); uri=downloadUrl(new URL(location,uri)); continue; }
  if(!response.ok) { await response.body?.cancel(); const error=new Error(`Drive HTTP ${response.status}; check sharing and quota before retrying.`); error.transient=response.status>=500; throw error; }
  const type=response.headers.get('content-type') ?? '';
  if(/(?:text\/html|application\/xhtml\+xml)/i.test(type)) {
   const declared=Number(response.headers.get('content-length')); if(declared>256*1024) throw new Error('Drive confirmation page too large.');
   const bytes=await collect(response,256*1024); uri=new URL(parseConfirmation(bytes.toString('utf8'),id)); continue;
  }
  const expected=response.headers.has('content-length') ? Number(response.headers.get('content-length')) : null;
  if(expected!==null && (!Number.isSafeInteger(expected) || expected>max)) { await response.body?.cancel(); throw new Error('Drive file too large.'); }
  let count=0, first=true;
  for await(const chunk of response.body) { count+=chunk.length; if(count>max) throw new Error('Drive file exceeds configured limit.'); if(first) {first=false;if(Buffer.from(chunk).toString('ascii',0,Math.min(100,chunk.length)).trimStart().startsWith('<')) throw new Error('Drive returned HTML instead of file.');} consume(chunk); }
  if(!count || (expected!==null && count!==expected)) throw new Error('Drive file is empty or truncated.');
  return count;
 }
 throw new Error('Too many Drive redirects or confirmations.');
}
async function collect(response,max) { const parts=[]; let count=0; for await(const chunk of response.body) {count+=chunk.length;if(count>max)throw new Error('Response too large.');parts.push(Buffer.from(chunk));} return Buffer.concat(parts); }
export async function retryTransient(action, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
 for(let attempt=0;;attempt++) {
  try { return await action(); }
  catch(error) {
   if(attempt>=2 || !(error.transient || error instanceof TypeError || error.name==='TimeoutError')) throw error;
   await pause(500 * (2**attempt));
  }
 }
}
export async function crawl(root, listFolder=list) {
 const todo=[{id:root,path:[]}], seen=new Set(), found=[];
 while(todo.length) {
  const dir=todo.shift(); if(seen.has(dir.id)) throw new Error('Folder cycle or duplicate folder detected.'); seen.add(dir.id);
  if(seen.size>2000) throw new Error('Too many folders.');
  let rows,pairs;
  try { rows=await retryTransient(()=>listFolder(dir.id)); pairs=pairFiles(rows); }
  catch(error) { throw new Error(`Folder ${dir.path.join(' / ') || '(root)'} [${dir.id}]: ${error.message}`); }
  for(const pair of pairs) {
   if(!pair.preview) console.warn(`WARNING: no matching preview for ${[...dir.path,pair.name].join(' / ')}; retaining existing preview when available, otherwise using labeled placeholder.`);
   found.push({...pair,category:dir.path.join(' / ') || 'Library'});
  }
  for(const entry of rows.filter(e=>e.mime===FOLDER)) todo.push({id:entry.id,path:[...dir.path,entry.name]});
  console.log(`Scanned ${seen.size} folders, found ${found.length} models`);
 }
 return found;
}
function inside(path,root) {const r=relative(resolve(root),resolve(path));return r==='' || (!r.startsWith('..'+(process.platform==='win32'?'\\':'/')) && r!=='..' && !isAbsolute(r));}
function readPreviousPreview(pub, previous) {
 const path=resolve(pub,previous.preview);
 if(!inside(path,pub) || !existsSync(path) || lstatSync(path).isSymbolicLink() || !inside(realpathSync(path),realpathSync(pub)) || !statSync(path).isFile() || statSync(path).size>2*1024*1024) throw new Error(`Existing preview missing or unsafe: ${previous.id}`);
 const data=readFileSync(path); validateImage(data,extname(previous.preview)); return data;
}
async function run() {
 const options=parseArguments(process.argv.slice(2));
 const root=options.folder, cache=resolve(options.cache), out=resolve(options.out), pub=dirname(out);
 if(!ID.test(root)) throw new Error('Invalid folder ID.');
 if(inside(cache,pub) || inside(pub,cache)) throw new Error('Cache must be outside the published folder.');
 mkdirSync(cache,{recursive:true}); mkdirSync(pub,{recursive:true});
 if(inside(realpathSync(cache),realpathSync(pub)) || inside(realpathSync(pub),realpathSync(cache))) throw new Error('Resolved cache must be outside the published folder.');
 const lock=resolve(cache,'import.lock'); let fd; try {fd=openSync(lock,'wx');} catch {throw new Error('Another import may be running; check before removing import.lock.');}
 try {
  const before=existsSync(out)?hash(readFileSync(out)):null;
  const existing=existsSync(out)?JSON.parse(readFileSync(out,'utf8')):{version:1,items:[]}; validateCatalog(existing);
  if(new Set(existing.items.map(item=>item.driveFileId)).size!==existing.items.length) throw new Error('Existing catalog has duplicate Drive file IDs; resolve before importing.');
  const statePath=resolve(cache,`state-${hash(root)}.json`); let state={}; if(existsSync(statePath)) state=JSON.parse(readFileSync(statePath,'utf8'));
  const apiKey=process.env.GOOGLE_DRIVE_API_KEY;
  if(options.listSource==='drive-api' && !apiKey) throw new Error('GOOGLE_DRIVE_API_KEY is required when --list-source drive-api is selected.');
  const useApi=options.listSource==='drive-api' || (options.listSource==='auto' && Boolean(apiKey));
  const listFolder=useApi?createDriveApiLister({apiKey}):list;
  const pairs=await crawl(root,listFolder);
  if(options.expectedModels!==null && pairs.length!==options.expectedModels) throw new Error(`Found ${pairs.length} model pairs, expected exactly ${options.expectedModels}; catalog was not modified. Check Drive inventory and listing completeness.`);
  if(options.minimumModels!==null && pairs.length<options.minimumModels) throw new Error(`Found ${pairs.length} model pairs, below the safety minimum ${options.minimumModels}; catalog was not modified. Review the Drive listing before lowering the minimum.`);
  const placeholder=readFileSync(fileURLToPath(new URL('./placeholder.png',import.meta.url))); validateImage(placeholder,'.png');
  const items=[];
  for(const pair of pairs) {
   const a=pair.archive,p=pair.preview,previous=existing.items.find(i=>i.driveFileId===a.id);
   const imageExt=p?extname(p.name):previous?extname(previous.preview):'.png'; if(!Number.isSafeInteger(a.size) || a.size<1 || a.size>limit || (p && (!Number.isSafeInteger(p.size) || p.size<1 || p.size>2*1024*1024))) throw new Error(`Invalid advertised file size: ${pair.name}`);
   const archiveKey=`archive-${hash(`${a.id}|${a.size}|${a.modified}`)}`;
   const previewKey=`preview-${hash(p ? `${p.id}|${p.size}|${p.modified}` : previous ? `retained|${a.id}` : `placeholder|${hash(placeholder)}`)}`;
   const archiveState=state[archiveKey]; const previewState=state[previewKey]; const imagePath=resolve(cache,`${previewKey}.preview`);
   let sha=/^[a-f0-9]{64}$/.test(archiveState?.sha256??'') ? archiveState.sha256 : null;
   if(!sha) {
    console.log(`Hashing ${pair.name} (${a.size} bytes)`);
    sha=await retryTransient(async()=>{const digest=createHash('sha256'); const count=await download(a.id,limit,c=>digest.update(c)); if(count!==a.size) throw new Error(`Drive file size changed: ${pair.name}`); return digest.digest('hex');});
   }
   let image;
   if(!p && previous) {
    image=readPreviousPreview(pub,previous); atomic(imagePath,image);
   } else if(previewState && /^[a-f0-9]{64}$/.test(previewState.previewHash??'') && existsSync(imagePath)) {
    image=readFileSync(imagePath); validateImage(image,imageExt); if(hash(image)!==previewState.previewHash) throw new Error('Cached preview is corrupt.');
   } else {
    image=p ? await retryTransient(async()=>{const parts=[]; const countImage=await download(p.id,2*1024*1024,c=>parts.push(Buffer.from(c))); if(countImage!==p.size) throw new Error(`Preview size changed: ${pair.name}`); return Buffer.concat(parts);}) : placeholder;
    validateImage(image,imageExt); atomic(imagePath,image);
   }
   state={...state,[archiveKey]:{sha256:sha},[previewKey]:{previewHash:hash(image)}}; atomic(statePath,JSON.stringify(state));
   const imageName=!p && previous ? previous.preview : `previews/${hash(image)}${imageExt.toLowerCase()}`;
   items.push({id:previous?.id ?? `drive-${hash(a.id).slice(0,24)}`,name:previous?.name ?? pair.name,category:previous?.category ?? pair.category,preview:imageName,driveFileId:a.id,fileName:a.name,sha256:sha,...(previous?.entryFile?{entryFile:previous.entryFile}:{})});
  }
  const catalog={version:1,items}; validateCatalog(catalog);
  if((existsSync(out)?hash(readFileSync(out)):null)!==before) throw new Error('Catalog changed during import; no catalog replaced.');
  for(let i=0;i<pairs.length;i++) { const pair=pairs[i], a=pair.archive, p=pair.preview, previous=existing.items.find(item=>item.driveFileId===a.id); const previewKey=`preview-${hash(p ? `${p.id}|${p.size}|${p.modified}` : previous ? `retained|${a.id}` : `placeholder|${hash(placeholder)}`)}`; const path=resolve(pub,items[i].preview); mkdirSync(dirname(path),{recursive:true}); if(existsSync(path)) {if(hash(readFileSync(path))!==state[previewKey].previewHash)throw new Error('Existing preview conflicts with computed hash.');} else copyFileSync(resolve(cache,`${previewKey}.preview`),path,1); }
  atomic(out,JSON.stringify(catalog,null,2)+'\n'); console.log(`Published locally ${items.length} verified models: ${out}`);
 } finally {closeSync(fd);unlinkSync(lock);}
}
export function parseArguments(args) {
 const options={};
 for(let index=0;index<args.length;index+=2) {
  const name=args[index], value=args[index+1];
  if(!['--folder','--cache','--out','--expected-models','--minimum-models','--list-source'].includes(name) || options[name]!==undefined || !value || value.startsWith('--'))
   throw new Error('Usage: node tools/catalog-import/import.mjs --folder FOLDER_ID --cache PATH --out library/public/catalog.json (--expected-models COUNT | --minimum-models COUNT) [--list-source auto|drive-api|html]');
  options[name]=value;
 }
 const expected=options['--expected-models']; const minimum=options['--minimum-models'];
 if(!options['--folder'] || !options['--cache'] || !options['--out'] || Boolean(expected)===Boolean(minimum))
  throw new Error('Provide --folder, --cache, --out and exactly one of --expected-models or --minimum-models.');
 const count=expected??minimum;
 if(!/^[1-9][0-9]{0,4}$/.test(count)) throw new Error('Model count must be an integer from 1 to 99999.');
 const listSource=options['--list-source']??'auto';
 if(!['auto','drive-api','html'].includes(listSource)) throw new Error('Invalid --list-source; use auto, drive-api or html.');
 return {folder:options['--folder'],cache:options['--cache'],out:options['--out'],expectedModels:expected?Number(expected):null,minimumModels:minimum?Number(minimum):null,listSource};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) run().catch(error=>{console.error(error.message);process.exitCode=1;});
