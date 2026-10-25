import path from 'node:path';
import { Router } from 'express';
import { load, query } from './catalog.js';
import { requireAuth } from './auth.js';
import { requireJson, rateLimit } from './security.js';
import { loadDriveConfig } from './drive/config.js';
import { CatalogProvider, GoogleDriveCatalogProvider } from './drive/provider.js';
import { CatalogRepository } from './drive/repository.js';
import { PreviewCache } from './drive/preview-cache.js';
import { createSyncWorker } from './drive/sync.js';
import { createArchiveSender } from './download-stream.js';

const empty = () => ({ products: [], categories: [], bySlug: new Map(), files: new Map(), version: 0 });
export class LocalCatalogProvider extends CatalogProvider {
  constructor(file) { super(); this.file = file; }
  async scan() { try { return load(this.file); } catch (error) { if(error.code === 'ENOENT') return null; throw error; } }
}

export async function createCatalogRuntime({ pool, env = process.env, logger = console, driveProvider }) {
  const config = loadDriveConfig(env);
  if (!['local','google_drive'].includes(config.provider)) throw new Error('CATALOG_PROVIDER_INVALID');
  if (config.provider === 'local') {
    const provider = new LocalCatalogProvider(path.join(env.STORAGE_DIR || path.resolve(import.meta.dirname,'../../../storage'),'catalog.json'));
    const cat = await provider.scan();
    return { config, snapshot: async () => cat || empty(),
      status: async () => ({ provider:'local',version:0,state:cat?'ready':'not_synced',lastSuccessfulSync:null,syncing:false,error:cat?null:'CATALOG_UNAVAILABLE' }),
      available: async () => Boolean(cat), local:cat, start:()=>()=>{} };
  }
  const repository = config.folderId ? new CatalogRepository({pool,rootFolderId:config.folderId}) : null;
  const provider = driveProvider || new GoogleDriveCatalogProvider({config});
  const cache = new PreviewCache({directory:config.previewCacheDir,provider});
  const worker = repository && config.configured ? createSyncWorker({repository,provider,previewCache:cache,intervalMinutes:config.syncIntervalMinutes,logger}) : null;
  const status = async () => {
    const value = repository ? await repository.status() : {version:0,lastSuccessfulSync:null,syncing:false,state:'not_synced'};
    const {rootFolderId,lastError,...safe} = value;
    if(!config.configured) return {...safe,provider:'google_drive',state:'configuration_required',error:config.errors[0]};
    return safe;
  };
  return {config,repository,cache,worker,sendArchive:createArchiveSender(provider),status,
    snapshot:() => repository ? repository.snapshot() : Promise.resolve(empty()),
    available:async()=>Boolean((await status()).lastSuccessfulSync),
    start:() => worker ? worker.start() : () => {} };
}

export function catalogRouter(runtime) {
  const router = Router();
  router.get(['/catalog/version','/catalog/status'], async (_req,res) => {
    const status = await runtime.status();
    if(status.state === 'ready' && (status.modelCount ?? (await runtime.snapshot()).products.length) === 0) status.state='empty';
    res.json(status);
  });
  router.get('/categories',async(_req,res)=>res.json((await runtime.snapshot()).categories));
  router.get('/products',async(req,res)=>{
    if(runtime.config.provider === 'local' && !runtime.local) return res.status(503).json({error:'CATALOG_UNAVAILABLE'});
    const snapshot=await runtime.snapshot();res.json({...query(snapshot,req.query),version:snapshot.version});
  });
  router.get('/products/:slug',async(req,res)=>{
    const product=(await runtime.snapshot()).bySlug.get(req.params.slug);
    return product?res.json(product):res.status(404).json({error:'NOT_FOUND'});
  });
  router.get('/catalog/models/:id/preview',async(req,res,next)=>{
    const model=await runtime.repository?.find(req.params.id);
    if(!model?.cachedPreviewPath) return res.status(404).json({error:'PREVIEW_NOT_FOUND'});
    // Old URLs must not keep serving deleted or replaced previews.
    if(req.query.v && req.query.v !== model.previewVersion) return res.status(404).json({error:'PREVIEW_VERSION_EXPIRED'});
    res.set('ETag',`"${model.previewVersion}"`);
    res.set('Cache-Control','public, max-age=120, must-revalidate');
    res.set('X-Content-Type-Options','nosniff');
    if(req.headers['if-none-match'] === `"${model.previewVersion}"`)return res.status(304).end();
    res.sendFile(runtime.cache.resolve(model.cachedPreviewPath),error=>{
      if(!error)return;
      if(res.headersSent){res.destroy();return;}
      res.removeHeader('ETag');res.status(404).json({error:'PREVIEW_NOT_FOUND'});
    });
  });
  router.post('/admin/catalog/sync',rateLimit({limit:5}),requireJson,requireAuth,async(req,res)=>{
    const admins=(process.env.LICENSE_ADMIN_USER_IDS || '').split(',').map(x=>x.trim().toLowerCase());
    if(!admins.includes(req.user.id.toLowerCase()))return res.status(403).json({error:'FORBIDDEN'});
    if(!runtime.worker)return res.status(503).json({error:runtime.config.errors[0] || 'CATALOG_SYNC_UNAVAILABLE'});
    if(runtime.worker.syncing)return res.status(409).json({error:'SYNC_IN_PROGRESS'});
    void runtime.worker.sync().catch(()=>{});
    res.status(202).json({accepted:true});
  });
  return router;
}
