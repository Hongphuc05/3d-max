import express, { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit, requireJson } from './security.js';

const actions = new Set(['PutObject','CopyObject','CompleteMultipartUpload','DeleteObject','LifecycleDeletion']);
const digest = value => createHash('sha256').update(value).digest();
function authorize(secret, header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(secret),digest(header.slice(7)));
}
function validEvent(event) {
  return event && !Array.isArray(event) && actions.has(event.action) &&
    typeof event.account === 'string' && typeof event.bucket === 'string' &&
    typeof event.object?.key === 'string' && event.object.key.length > 0 &&
    Buffer.byteLength(event.object.key,'utf8') <= 1024 && !event.object.key.includes('\0') &&
    (event.object.size === undefined || (Number.isSafeInteger(event.object.size) && event.object.size >= 0)) &&
    (event.object.eTag === undefined || (typeof event.object.eTag === 'string' && event.object.eTag.length <= 256)) &&
    typeof event.eventTime === 'string' && event.eventTime.length <= 64 && Number.isFinite(Date.parse(event.eventTime));
}

export function r2WebhookRouter(runtime) {
  const router=Router();
  router.post('/',rateLimit({limit:6000}), (req,res,next)=>{
    const secret=runtime.config.webhookSecret;
    if (!secret || !runtime.repository) return res.status(503).json({error:'R2_WEBHOOK_UNAVAILABLE'});
    if (!authorize(secret,req.headers.authorization)) return res.status(401).json({error:'UNAUTHORIZED'});
    next();
  },requireJson,express.json({limit:'64kb'}),async(req,res)=>{
    const event=req.body;
    if (!validEvent(event)) return res.status(400).json({error:'INVALID_R2_EVENT'});
    if (runtime.config.accountId && event.account !== runtime.config.accountId) return res.status(403).json({error:'R2_ACCOUNT_MISMATCH'});
    if (event.bucket !== runtime.config.bucket || !event.object.key.startsWith(runtime.config.rootPrefix)) return res.json({ignored:true});
    try {
      const result=await runtime.repository.ingestEvents([event]);
      res.status(202).json({accepted:true,...result});
    } catch {
      // Queue must retry when the inbox transaction could not commit.
      res.status(503).json({error:'R2_EVENT_NOT_STORED'});
    }
  });
  return router;
}

export function catalogEventStream(runtime,{pollMs=1000,heartbeatMs=15000,maxClients=200}={}) {
  let active=0;
  return (req,res)=>{
    if(active>=maxClients) return res.status(503).json({error:'CATALOG_EVENTS_BUSY'});
    active++;
    res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive','X-Accel-Buffering':'no'});
    res.flushHeaders();res.write('retry: 2000\n\n');
    let closed=false,running=false,last;
    const close=()=>{
      if(closed)return;closed=true;active--;clearInterval(poll);clearInterval(heartbeat);res.end();
    };
    const write=value=>{if(!closed && !res.write(value))close();};
    const refresh=async()=>{
      if(closed||running)return;running=true;
      try {
        const status=runtime.eventVersion ? await runtime.eventVersion() : await runtime.status();
        const identity=`${status.provider}:${status.catalogKey || ''}:${status.version}`;
        if(!closed && last!==identity){
          write(`event: catalog.changed\ndata: ${JSON.stringify({version:status.version})}\n\n`);last=identity;
        }
      } catch {close();} finally {running=false;}
    };
    const poll=setInterval(()=>void refresh(),pollMs);
    const heartbeat=setInterval(()=>write(': heartbeat\n\n'),heartbeatMs);
    req.once('close',close);void refresh();
  };
}
