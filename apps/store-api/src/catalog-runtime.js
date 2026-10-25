import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Router } from 'express';
import { load, query } from './catalog.js';
import { requireAuth } from './auth.js';
import { requireJson, rateLimit } from './security.js';
import { loadR2Config } from './r2/config.js';
import { R2Provider } from './r2/provider.js';
import { R2CatalogRepository } from './r2/repository.js';
import { createSyncWorker } from './r2/sync.js';
import { createCatalogEventBus } from './r2/events.js';
import { createArchiveSender } from './download-stream.js';
import { catalogEventStream } from './r2-http.js';

const empty = () => ({ products: [], categories: [], bySlug: new Map(), files: new Map(), version: 0 });
export class LocalCatalogProvider {
  constructor(file) { this.file = file; }
  async scan() { try { return load(this.file); } catch (error) { if(error.code === 'ENOENT') return null; throw error; } }
}

export async function createCatalogRuntime({ pool, env = process.env, logger = console, r2Provider }) {
  if (env.CATALOG_PROVIDER === 'local') {
    const provider = new LocalCatalogProvider(path.join(env.STORAGE_DIR || path.resolve(import.meta.dirname,'../../../storage'),'catalog.json'));
    const cat = await provider.scan();
    return { config:{provider:'local',configured:true,errors:[]}, snapshot: async () => cat || empty(),
      status: async () => ({ provider:'local',version:0,state:cat?'ready':'not_synced',lastSuccessfulSync:null,syncing:false,error:cat?null:'CATALOG_UNAVAILABLE' }),
      available: async () => Boolean(cat), local:cat, start:()=>()=>{} };
  }
  const config=loadR2Config(env);
  const repository=new R2CatalogRepository({pool,config});
  const eventBus=createCatalogEventBus({pool,logger});
  const provider=config.configured ? r2Provider || new R2Provider({config}) : null;
  const canAdminSync=user=>{
    const adminIds=new Set((env.LICENSE_ADMIN_USER_IDS || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
    return Boolean(user?.id && adminIds.has(String(user.id).toLowerCase()));
  };
  const worker=provider ? createSyncWorker({repository,provider,config,logger}) : null;
  const status=async()=>{
    const value=await repository.status();
    return config.configured ? value : {...value,provider:'r2',state:'configuration_required',error:config.errors[0]};
  };
  const start=()=>{
    const eventListenerReady=eventBus.start();
    const stopWorker=worker ? worker.start() : async()=>{};
    return async()=>{await stopWorker();await eventListenerReady;await eventBus.stop();};
  };
  return {config,repository,provider,worker,canAdminSync,sendArchive:provider ? createArchiveSender(provider) : undefined,status,
    snapshot:()=>repository.snapshot(),available:async()=>Boolean(config.configured && (await status()).initialSyncComplete),
    subscribeCatalogEvents:eventBus.subscribe,
    eventVersion:async()=>{
      const {rows}=await pool.query('select catalog_version from catalog_sources where provider=$1 and root_folder_id=$2',repository.source);
      return {provider:'r2',catalogKey:repository.lockKey,version:Number(rows[0]?.catalog_version || 0)};
    },
    start};
}

async function sendPreview(runtime,req,res) {
  const model=await runtime.repository?.find(req.params.id);
  if(!model?.previewId || !runtime.provider) return res.status(404).json({error:'PREVIEW_NOT_FOUND'});
  if(req.query.v && req.query.v !== model.previewVersion) return res.status(404).json({error:'PREVIEW_VERSION_EXPIRED'});
  const etag='"'+model.previewVersion+'"';
  res.set({'ETag':etag,'Cache-Control':'public, max-age=120, must-revalidate','X-Content-Type-Options':'nosniff'});
  if(req.headers['if-none-match']===etag)return res.status(304).end();
  const controller=new AbortController();
  const disconnect=()=>{if(!res.writableFinished)controller.abort();};
  res.once('close',disconnect);
  const timeout=setTimeout(()=>controller.abort(),30000);
  let upstream;
  try {
    const result=await runtime.provider.openPreview(model,{signal:controller.signal});upstream=result.data;
    const length=Number(result.headers?.['content-length']);
    if(Number.isFinite(length) && length>20*1024*1024)throw Object.assign(new Error('PREVIEW_TOO_LARGE'),{code:'PREVIEW_TOO_LARGE',status:502});
    let bytes=0;
    const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>20*1024*1024?Object.assign(new Error('PREVIEW_TOO_LARGE'),{code:'PREVIEW_TOO_LARGE',status:502}):null,chunk);}});
    res.type('image/jpeg');
    await pipeline(upstream,bounded,res,{signal:controller.signal});
  } catch(error){
    if(res.headersSent || res.destroyed){res.destroy();return;}
    res.removeHeader('ETag');res.set('Cache-Control','no-store');throw error;
  } finally {clearTimeout(timeout);res.removeListener('close',disconnect);controller.abort();upstream?.destroy();}
}

export function catalogRouter(runtime) {
  const router = Router();
  router.get(['/catalog/version','/catalog/status'], async (_req,res) => {
    const status = await runtime.status();
    if(status.state === 'ready' && (status.modelCount ?? (await runtime.snapshot()).products.length) === 0) status.state='empty';
    res.json(status);
  });
  router.get('/catalog/events',catalogEventStream(runtime));
  router.get(['/categories','/categories/tree'],async(_req,res)=>res.json((await runtime.snapshot()).categories));
  router.get(['/products','/models'],async(req,res)=>{
    if(runtime.config.provider === 'local' && !runtime.local) return res.status(503).json({error:'CATALOG_UNAVAILABLE'});
    const snapshot=await runtime.snapshot();res.json({...query(snapshot,req.query),version:snapshot.version});
  });
  router.get(['/products/:slug','/models/:slug'],async(req,res)=>{
    const product=(await runtime.snapshot()).bySlug.get(req.params.slug);
    return product?res.json(product):res.status(404).json({error:'NOT_FOUND'});
  });
  router.get('/catalog/models/:id/preview',async(req,res)=>sendPreview(runtime,req,res));
  router.get('/admin/catalog/sync/permission',requireAuth,(req,res)=>res.json({allowed:Boolean(runtime.worker && runtime.canAdminSync?.(req.user))}));
  router.post('/admin/catalog/sync',rateLimit({limit:5}),requireJson,requireAuth,async(req,res)=>{
    if(!runtime.canAdminSync?.(req.user))return res.status(403).json({error:'FORBIDDEN'});
    if(!runtime.worker)return res.status(503).json({error:runtime.config.errors[0] || 'CATALOG_SYNC_UNAVAILABLE'});
    if(runtime.worker.syncing)return res.status(409).json({error:'SYNC_IN_PROGRESS'});
    void runtime.worker.sync().catch(()=>{});
    res.status(202).json({accepted:true});
  });
  router.post('/admin/catalog/retry-dead-events',rateLimit({limit:5}),requireJson,requireAuth,async(req,res)=>{
    if(!runtime.canAdminSync?.(req.user))return res.status(403).json({error:'FORBIDDEN'});
    if(!runtime.worker || !runtime.repository)return res.status(503).json({error:runtime.config.errors[0] || 'CATALOG_RETRY_UNAVAILABLE'});
    try {
      const result=await runtime.repository.retryDead();
      res.status(202).json({accepted:true,...result});
    } catch {
      res.status(503).json({error:'CATALOG_RETRY_UNAVAILABLE'});
    }
  });
  return router;
}
