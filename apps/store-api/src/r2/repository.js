import { createHash } from 'node:crypto';
import { buildCatalog,folderPaths } from './pairing.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const LOCK_NAMESPACE=727009;
const safeCode=error=>/^R2_[A-Z_]+$/.test(error?.code || '')?error.code:'R2_CATALOG_SYNC_FAILED';
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_value,index)=>items.slice(index*size,(index+1)*size));
const modified=value=>value?new Date(value).toISOString():null;
const objectIdentity=object=>[object.key,Number(object.size||0),object.etag || '',modified(object.lastModified)];
export function planObjectDiff(previous,incoming) {
  const oldByKey=new Map(previous.map(object=>[object.key,object]));
  const newByKey=new Map(incoming.map(object=>[object.key,object]));
  const upserts=incoming.filter(object=>{
    const old=oldByKey.get(object.key);
    return !old || JSON.stringify(objectIdentity(old))!==JSON.stringify(objectIdentity(object));
  });
  const removedKeys=previous.filter(object=>!newByKey.has(object.key)).map(object=>object.key).sort();
  return {upserts,removedKeys,changed:Boolean(upserts.length||removedKeys.length)};
}
export const eventIdentity=event=>hash([event.account,event.bucket,event.action,event.object?.key,event.object?.size ?? null,event.object?.eTag || null,event.eventTime]);
const categoryId=path=>hash(['r2-category',path]).slice(0,12);

function internalModel(model) {
  return {id:model.id,slug:model.id,name:model.name,archiveId:model.archive_file_id,archiveExtension:model.archive_extension,
    folderId:model.folder_id,size:model.file_size==null?null:Number(model.file_size),modifiedTime:model.modified_time,
    checksum:model.checksum,canDownload:model.can_download && model.model_status==='ready',status:model.model_status,
    previewId:model.preview_file_id,previewVersion:model.preview_version,previewMetadata:model.preview_metadata};
}

export function buildSnapshot({folders,models,version}) {
  const byPath=new Map(folders.map(folder=>[folder.folder_id,folder]));
  const products=models.map(model=>{
    const folder=byPath.get(model.folder_id);
    const paths=model.folder_id?folderPaths(`${model.folder_id}/`):[];
    const preview=model.preview_file_id && model.preview_version?`/api/catalog/models/${model.id}/preview?v=${encodeURIComponent(model.preview_version)}`:null;
    return {id:model.id,slug:model.id,name:model.name,category:folder?categoryId(folder.folder_id):null,
      subcategory:folder?.name || '',folderId:folder?categoryId(folder.folder_id):null,folderPath:model.folder_id,
      folderIds:paths.map(categoryId),price:0,thumb:preview,image:preview,status:model.model_status,
      downloadable:model.can_download && model.model_status==='ready',info:{sizeMB:model.file_size==null?null:Math.round(Number(model.file_size)/1048576),
        archiveExtension:model.archive_extension,renderers:[],formats:[],hasTextures:null}};
  });
  const counts=new Map();
  for(const product of products) for(const id of product.folderIds) counts.set(id,(counts.get(id)||0)+1);
  const children=new Map();
  for(const folder of folders) children.set(folder.parent_folder_id,[...(children.get(folder.parent_folder_id)||[]),folder]);
  const category=folder=>({id:categoryId(folder.folder_id),name:folder.name,path:folder.folder_path,depth:folder.depth,
    count:counts.get(categoryId(folder.folder_id))||0,children:(children.get(folder.folder_id)||[]).map(category)});
  return {products,categories:folders.filter(folder=>!byPath.has(folder.parent_folder_id)).map(category),
    bySlug:new Map(products.map(product=>[product.slug,product])),files:new Map(models.map(model=>[model.id,internalModel(model)])),version:Number(version||0)};
}

export class R2CatalogRepository {
  constructor({pool,config}) {
    this.pool=pool;this.config=config;this.source=['r2',`${config.bucket}/${config.rootPrefix}`];this.lockKey=this.source.join(':');
  }
  async acquireLock() {
    const client=await this.pool.connect();
    try {
      const {rows}=await client.query('select pg_try_advisory_lock($1,hashtext($2)) as locked',[LOCK_NAMESPACE,this.lockKey]);
      if(!rows[0].locked){client.release();return null;}
      return {client,release:async()=>{try{await client.query('select pg_advisory_unlock($1,hashtext($2))',[LOCK_NAMESPACE,this.lockKey]);}finally{client.release();}}};
    } catch(error){client.release();throw error;}
  }
  async ensureSource(client) {await client.query('insert into catalog_sources(provider,root_folder_id) values($1,$2) on conflict do nothing',this.source);}
  async snapshot() {
    const {rows}=await this.pool.query(`select
      coalesce((select jsonb_agg(f order by folder_path) from catalog_folders f where provider=$1 and root_folder_id=$2 and status='active'),'[]') as folders,
      coalesce((select jsonb_agg(m order by name,id) from catalog_models m where provider=$1 and root_folder_id=$2 and status='active'),'[]') as models,
      (select catalog_version from catalog_sources where provider=$1 and root_folder_id=$2) as version`,this.source);
    return buildSnapshot(rows[0]);
  }
  async find(id) {
    if(!/^[a-f0-9]{12}$/.test(id || ''))return null;
    const {rows}=await this.pool.query("select * from catalog_models where provider=$1 and root_folder_id=$2 and id=$3 and status='active'",[...this.source,id]);
    return rows[0]?internalModel(rows[0]):null;
  }
  async status() {
    const {rows}=await this.pool.query(`select s.*,
      exists(select 1 from pg_locks where locktype='advisory' and granted and classid=$3::oid and objid=(hashtext($4)::bigint & 4294967295)::oid and objsubid=2
      and database=(select oid from pg_database where datname=current_database())) as syncing
      from catalog_sources s where provider=$1 and root_folder_id=$2`,[...this.source,LOCK_NAMESPACE,this.lockKey]);
    const row=rows[0];
    const counts=(await this.pool.query(`select model_status,count(*)::integer as count from catalog_models where provider=$1 and root_folder_id=$2 and status='active' group by model_status`,this.source)).rows;
    const inbox=(await this.pool.query(`select status,count(*)::integer as count from r2_event_inbox where bucket=$1 and root_prefix=$2 and status<>'processed' group by status`,[this.config.bucket,this.config.rootPrefix])).rows;
    return {provider:'r2',version:Number(row?.catalog_version||0),catalogKey:hash(this.source).slice(0,24),lastSuccessfulSync:row?.last_successful_sync || null,
      syncing:Boolean(row?.syncing),state:row?.syncing?'syncing':row?.last_error?'error':row?.last_full_sync_at?'ready':'not_synced',
      error:row?.last_error || null,report:row?.sync_report || null,modelCount:counts.reduce((sum,item)=>sum+item.count,0),
      modelStatuses:Object.fromEntries(counts.map(item=>[item.model_status,item.count])),pendingEvents:inbox.find(item=>item.status==='pending')?.count || 0,
      deadEvents:inbox.find(item=>item.status==='dead')?.count || 0,initialSyncComplete:Boolean(row?.last_full_sync_at),
      lastFullSync:row?.last_full_sync_at || null};
  }
  async ingestEvents(events) {
    const filtered=events.filter(event=>event.bucket===this.config.bucket && typeof event.object?.key==='string' && event.object.key.startsWith(this.config.rootPrefix));
    const records=filtered.map(event=>({id:eventIdentity(event),key:event.object.key,payload:event}));
    const result=await this.pool.query(`insert into r2_event_inbox(id,bucket,root_prefix,object_key,payload)
      select x.id,$1,$2,x.key,x.payload from jsonb_to_recordset($3::jsonb) as x(id text,key text,payload jsonb) on conflict(id) do nothing`,[this.config.bucket,this.config.rootPrefix,JSON.stringify(records)]);
    return {accepted:result.rowCount,duplicates:filtered.length-result.rowCount,ignored:events.length-filtered.length};
  }
  async sync(provider,{signal}={}) {
    const lock=await this.acquireLock();if(!lock)return {skipped:true,reason:'SYNC_IN_PROGRESS'};
    let syncId;
    try {
      await this.ensureSource(lock.client);
      await lock.client.query(`update catalog_sync_runs set status='failed',finished_at=now(),error_code='SYNC_INTERRUPTED' where provider=$1 and root_folder_id=$2 and status='running'`,this.source);
      syncId=(await lock.client.query("insert into catalog_sync_runs(provider,root_folder_id,status) values($1,$2,'running') returning id",this.source)).rows[0].id;
      await lock.client.query('update catalog_sources set last_sync_started_at=now(),last_error=null where provider=$1 and root_folder_id=$2',this.source);
      const objects=await provider.listObjects(this.config.rootPrefix,{signal});
      return await this.publish(lock.client,objects,this.config.rootPrefix,{syncId,fullSync:true});
    } catch(error) {
      if(syncId) await lock.client.query(`update catalog_sync_runs set status='failed',finished_at=now(),error_code=$2 where id=$1`,[syncId,safeCode(error)]);
      await lock.client.query('update catalog_sources set last_error=$3 where provider=$1 and root_folder_id=$2',[...this.source,safeCode(error)]);
      throw error;
    } finally{await lock.release();}
  }
  async processPending(provider,{signal,limit=50}={}) {
    const lock=await this.acquireLock();if(!lock)return {skipped:true};
    let processed=0,failed=0;
    try {
      const {rows}=await lock.client.query(`select * from r2_event_inbox where bucket=$1 and root_prefix=$2 and status='pending' and next_attempt_at<=now() order by received_at,id limit $3`,[this.config.bucket,this.config.rootPrefix,limit]);
      const groups=new Map();
      for(const row of rows) {
        const key=row.object_key;
        const scope=key.endsWith('/')?key:key.slice(0,key.lastIndexOf('/')+1);
        groups.set(scope,[...(groups.get(scope)||[]),row.id]);
      }
      for(const [scope,eventIds] of groups) {
        try {
          // Events are hints: always list current R2 metadata, never apply stale payload state.
          const objects=await provider.listObjects(scope,{signal});
          const aliveAncestors=[];
          const relative=scope.slice(this.config.rootPrefix.length);
          for(const ancestor of folderPaths(relative)) {
            if(await provider.hasObjects(`${this.config.rootPrefix}${ancestor}/`,{signal}))aliveAncestors.push(ancestor);
          }
          await this.publish(lock.client,objects,scope,{eventIds,aliveAncestors});processed+=eventIds.length;
        } catch(error) {
          await lock.client.query(`update r2_event_inbox set attempts=attempts+1,last_error=$2,
            status=case when attempts+1>=10 then 'dead' else 'pending' end,
            next_attempt_at=now()+make_interval(secs=>least(3600,power(2,least(attempts+1,12))::integer)) where id=any($1::text[])`,[eventIds,safeCode(error)]);
          failed+=eventIds.length;
        }
      }
      return {processed,failed};
    } finally{await lock.release();}
  }
  async retryDead() {
    const result=await this.pool.query(`update r2_event_inbox set status='pending',attempts=0,next_attempt_at=now(),last_error=null where bucket=$1 and root_prefix=$2 and status='dead'`,[this.config.bucket,this.config.rootPrefix]);
    return {retried:result.rowCount};
  }
  async publish(client,objects,scope,{syncId,eventIds=[],aliveAncestors=[],fullSync=false}={}) {
    const scan=buildCatalog(objects,this.config.rootPrefix);
    await client.query('begin');
    try {
      await this.ensureSource(client);
      const previous=(await client.query('select * from catalog_sources where provider=$1 and root_folder_id=$2 for update',this.source)).rows[0];
      const old=(await client.query(`select object_key as key,size::float8 as size,etag,last_modified as "lastModified" from r2_objects
        where bucket=$1 and availability='active' and left(object_key,length($2))=$2 order by object_key`,[this.config.bucket,scope])).rows;
      const diff=planObjectDiff(old,objects);
      const initialFullSync=fullSync && !previous.last_full_sync_at;
      // A sync run anchors category/model provenance; event publications use their own run.
      if(!syncId)syncId=(await client.query("insert into catalog_sync_runs(provider,root_folder_id,status) values($1,$2,'running') returning id",this.source)).rows[0].id;
      await this.replaceObjects(client,diff.upserts,diff.removedKeys,scope);
      let foldersChanged=0,modelsChanged=0,foldersRemoved=0;
      if(diff.changed || initialFullSync) {
        foldersChanged=await this.upsertFolders(client,scan.folders,syncId);
        modelsChanged=await this.replaceModels(client,scan.models,scope,syncId);
        foldersRemoved=await this.pruneFolders(client,aliveAncestors);
      }
      const changed=initialFullSync || foldersChanged>0 || modelsChanged>0 || foldersRemoved>0;
      const report={filesScanned:objects.length,foldersScanned:scan.folders.length,modelsScanned:scan.models.length,
        ready:scan.models.filter(model=>model.status==='ready').length,missing_preview:scan.models.filter(model=>model.status==='missing_preview').length,
        missing_archive:scan.models.filter(model=>model.status==='missing_archive').length,conflict:scan.models.filter(model=>model.status==='conflict').length,
        objectsChanged:diff.upserts.length+diff.removedKeys.length,changed,version:Number(previous.catalog_version)+Number(changed)};
      await client.query(`update catalog_sources set catalog_version=$3,last_successful_sync=now(),
        last_full_sync_at=case when $5::boolean then now() else catalog_sources.last_full_sync_at end,
        last_error=null,sync_report=$4,updated_at=now() where provider=$1 and root_folder_id=$2`,[...this.source,report.version,report,fullSync]);
      await client.query(`update catalog_sync_runs set status='succeeded',finished_at=now(),duration_ms=greatest(0,extract(epoch from(now()-started_at))*1000),report=$2 where id=$1`,[syncId,report]);
      if(eventIds.length)await client.query("update r2_event_inbox set status='processed',processed_at=now(),last_error=null where id=any($1::text[])",[eventIds]);
      // NOTIFY is delivered only after commit and can be consumed across API processes.
      if(changed)await client.query("select pg_notify('r2_catalog_changed',$1)",[JSON.stringify({version:report.version})]);
      await client.query('commit');return report;
    } catch(error){await client.query('rollback');throw error;}
  }
  async replaceObjects(client,objects,removedKeys,scope) {
    const batchSize=this.config.batchSize || 1000;
    for(const batch of chunks(removedKeys,batchSize)) {
      await client.query("update r2_objects set availability='removed',updated_at=now() where bucket=$1 and left(object_key,length($2))=$2 and object_key=any($3::text[]) and availability='active'",[this.config.bucket,scope,batch]);
    }
    const records=objects.map(object=>{
      const relative=object.key.slice(this.config.rootPrefix.length),trimmed=relative.endsWith('/')?relative.slice(0,-1):relative;
      const category=relative.endsWith('/')?trimmed:trimmed.slice(0,Math.max(0,trimmed.lastIndexOf('/')));
      return {...object,category,type:relative.endsWith('/')?'marker':/\.(jpg|jpeg)$/i.test(relative)?'preview':/\.(zip|rar)$/i.test(relative)?'archive':'other',size:Number(object.size||0)};
    });
    for(const batch of chunks(records,batchSize)) {
      await client.query(`insert into r2_objects(bucket,object_key,category_path,object_type,size,etag,last_modified)
        select $1,x.key,x.category,x.type,x.size,x.etag,x."lastModified" from jsonb_to_recordset($2::jsonb) as x(key text,category text,type text,size bigint,etag text,"lastModified" timestamptz)
        on conflict(bucket,object_key) do update set category_path=excluded.category_path,object_type=excluded.object_type,size=excluded.size,etag=excluded.etag,
        last_modified=excluded.last_modified,availability='active',updated_at=now()
        where r2_objects.category_path is distinct from excluded.category_path or r2_objects.object_type is distinct from excluded.object_type
          or r2_objects.size is distinct from excluded.size or r2_objects.etag is distinct from excluded.etag
          or r2_objects.last_modified is distinct from excluded.last_modified or r2_objects.availability is distinct from 'active'`,[this.config.bucket,JSON.stringify(batch)]);
    }
  }
  async upsertFolders(client,folders,syncId) {
    let changed=0;
    for(const batch of chunks(folders,this.config.batchSize || 1000)) {
      const result=await client.query(`insert into catalog_folders(provider,root_folder_id,folder_id,parent_folder_id,name,folder_path,depth,last_seen_sync_id)
        select $1,$2,x.id,x."parentId",x.name,x.path,x.depth,$4 from jsonb_to_recordset($3::jsonb) as x(id text,"parentId" text,name text,path text,depth integer)
        on conflict(provider,root_folder_id,folder_id) do update set parent_folder_id=excluded.parent_folder_id,name=excluded.name,
        folder_path=excluded.folder_path,depth=excluded.depth,last_seen_sync_id=excluded.last_seen_sync_id,status='active',updated_at=now()
        where catalog_folders.parent_folder_id is distinct from excluded.parent_folder_id or catalog_folders.name is distinct from excluded.name
          or catalog_folders.folder_path is distinct from excluded.folder_path or catalog_folders.depth is distinct from excluded.depth
          or catalog_folders.status is distinct from 'active'`,[...this.source,JSON.stringify(batch),syncId]);
      changed+=result.rowCount || 0;
    }
    return changed;
  }
  async replaceModels(client,models,scope,syncId) {
    const folder=scope.slice(this.config.rootPrefix.length).replace(/\/$/,'');
    await this.adoptLegacyIds(client,models);
    const existing=(await client.query(`select id,folder_id as "folderId",basename,content_hash as "contentHash",status from catalog_models
      where provider=$1 and root_folder_id=$2 and ($3='' or folder_id=$3 or left(folder_id,length($3)+1)=$3||'/') and status='active'`,[...this.source,folder])).rows;
    const identity=model=>JSON.stringify([model.folderId,model.basename]);
    const existingByIdentity=new Map(existing.map(model=>[identity(model),model]));
    const records=models.map(model=>{
      const previous=existingByIdentity.get(identity(model));
      return {...model,id:previous?.id || hash([...this.source,model.folderId,model.basename]).slice(0,12),contentHash:hash(model)};
    });
    const currentIdentities=new Set(records.map(identity));
    const removed=existing.filter(model=>!currentIdentities.has(identity(model))).map(model=>model.id);
    let changed=0;
    const batchSize=this.config.batchSize || 1000;
    for(const batch of chunks(removed,batchSize)) {
      const result=await client.query("update catalog_models set status='removed',can_download=false,updated_at=now() where id=any($1::text[]) and status='active'",[batch]);
      changed+=result.rowCount || 0;
    }
    const upserts=records.filter(model=>{
      const previous=existingByIdentity.get(identity(model));
      return !previous || previous.status!=='active' || previous.contentHash!==model.contentHash;
    });
    for(const batch of chunks(upserts,batchSize)) {
      const result=await client.query(`insert into catalog_models(id,provider,root_folder_id,folder_id,archive_file_id,name,archive_extension,file_size,
        modified_time,checksum,can_download,preview_file_id,preview_metadata,preview_version,content_hash,basename,model_status,last_seen_sync_id)
        select x.id,$1,$2,x."folderId",x."archiveId",x.name,x."archiveExtension",x.size,x."modifiedTime",x.checksum,x."canDownload",x."previewId",x."previewMetadata",x."previewVersion",x."contentHash",x.basename,x.status,$4
        from jsonb_to_recordset($3::jsonb) as x(id text,"folderId" text,"archiveId" text,name text,"archiveExtension" text,size bigint,"modifiedTime" timestamptz,checksum text,
        "canDownload" boolean,"previewId" text,"previewMetadata" jsonb,"previewVersion" text,"contentHash" text,basename text,status text)
        on conflict(provider,root_folder_id,folder_id,basename) where provider='r2' do update set archive_file_id=excluded.archive_file_id,name=excluded.name,
        archive_extension=excluded.archive_extension,file_size=excluded.file_size,modified_time=excluded.modified_time,checksum=excluded.checksum,
        can_download=excluded.can_download,preview_file_id=excluded.preview_file_id,preview_metadata=excluded.preview_metadata,preview_version=excluded.preview_version,
        content_hash=excluded.content_hash,model_status=excluded.model_status,status='active',last_seen_sync_id=excluded.last_seen_sync_id,updated_at=now()
        where catalog_models.content_hash is distinct from excluded.content_hash or catalog_models.status is distinct from 'active'`,[...this.source,JSON.stringify(batch),syncId]);
      changed+=result.rowCount || 0;
    }
    return changed;
  }
  async adoptLegacyIds(client,models) {
    // Match only a unique old path/basename identity; ambiguous legacy entries remain untouched.
    const candidates=(await client.query(`select m.id,m.name,f.folder_path from catalog_models m join catalog_folders f
      on f.provider=m.provider and f.root_folder_id=m.root_folder_id and f.folder_id=m.folder_id where m.provider='google_drive'`)).rows;
    if(!candidates.length)return;
    for(const model of models) {
      const matches=candidates.filter(row=>row.name===model.basename && (row.folder_path===model.folderId || row.folder_path.endsWith(`/${model.folderId}`)));
      if(matches.length!==1)continue;
      await client.query(`update catalog_models set provider=$2,root_folder_id=$3,folder_id=$4,basename=$5,archive_file_id=null
        where id=$1 and provider='google_drive' and not exists(select 1 from catalog_models where provider=$2 and root_folder_id=$3 and folder_id=$4 and basename=$5)`,[matches[0].id,...this.source,model.folderId,model.basename]);
    }
  }
  async pruneFolders(client,aliveAncestors) {
    const result=await client.query(`update catalog_folders f set status='removed',updated_at=now() where f.provider=$1 and f.root_folder_id=$2 and f.status='active'
      and not(f.folder_id=any($4::text[])) and not exists(select 1 from r2_objects o where o.bucket=$3 and o.availability='active'
      and (o.category_path=f.folder_id or left(o.category_path,length(f.folder_id)+1)=f.folder_id||'/'))`,[...this.source,this.config.bucket,aliveAncestors]);
    return result.rowCount || 0;
  }
}
