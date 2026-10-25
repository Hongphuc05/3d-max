import { S3Client,ListObjectsV2Command,GetObjectCommand } from '@aws-sdk/client-s3';
import { buildCatalog } from './pairing.js';
const failure=(code,status=503)=>Object.assign(new Error(code),{code,status});
const cleanEtag=value=>String(value || '').replace(/^"|"$/g,'');

export function classifyR2Error(error) {
  if(typeof error?.code==='string' && error.code.startsWith('R2_')) return error;
  const status=error?.$metadata?.httpStatusCode;
  return failure(status===404?'R2_OBJECT_NOT_FOUND':status===412?'R2_OBJECT_CHANGED':status===403?'R2_ACCESS_DENIED':'R2_UNAVAILABLE',status===404?404:status===412?409:503);
}

export class R2Provider {
  constructor({config,client}) {
    this.config=config;
    this.client=client || new S3Client({endpoint:config.endpoint,region:config.region,credentials:config.credentials,maxAttempts:4,
      requestHandler:{connectionTimeout:10000,requestTimeout:120000}});
  }
  checkKey(key) {
    if(typeof key!=='string' || !key.startsWith(this.config.rootPrefix) || key.includes('\u0000')) throw failure('R2_KEY_OUTSIDE_ROOT',400);
  }
  async request(command,{signal}={}) {
    try {return await this.client.send(command,{abortSignal:signal});}
    catch(error) {throw classifyR2Error(error);}
  }
  async listObjects(prefix=this.config.rootPrefix,{signal}={}) {
    this.checkKey(prefix);
    const objects=[],tokens=new Set();
    let token;
    do {
      const page=await this.request(new ListObjectsV2Command({Bucket:this.config.bucket,Prefix:prefix,
        MaxKeys:Math.min(1000,Math.max(1,Number(this.config.batchSize)||1000)),ContinuationToken:token}),{signal});
      for(const object of page.Contents || []) {
        if(typeof object.Key!=='string' || !object.Key.startsWith(prefix) || !Number.isSafeInteger(Number(object.Size)) || Number(object.Size)<0) throw failure('R2_INVALID_METADATA');
        objects.push({key:object.Key,size:Number(object.Size),etag:cleanEtag(object.ETag),lastModified:object.LastModified?new Date(object.LastModified).toISOString():null});
      }
      token=page.IsTruncated?page.NextContinuationToken:null;
      if(page.IsTruncated && (!token || tokens.has(token))) throw failure('R2_PAGINATION_INVALID');
      if(token) tokens.add(token);
    } while(token);
    return objects;
  }
  async hasObjects(prefix,{signal}={}) {
    this.checkKey(prefix);
    const page=await this.request(new ListObjectsV2Command({Bucket:this.config.bucket,Prefix:prefix,MaxKeys:1}),{signal});
    return Boolean(page.Contents?.length);
  }
  async scan({signal}={}) { return buildCatalog(await this.listObjects(this.config.rootPrefix,{signal}),this.config.rootPrefix); }
  async openObject(key,{signal,range,etag}={}) {
    this.checkKey(key);
    if(range && !/^bytes=\d+-\d*$/.test(range)) throw failure('R2_INVALID_RANGE',416);
    const response=await this.request(new GetObjectCommand({Bucket:this.config.bucket,Key:key,Range:range,IfMatch:etag?`"${cleanEtag(etag)}"`:undefined}),{signal});
    if(!response.Body) throw failure('R2_EMPTY_RESPONSE');
    return {data:response.Body,status:range?206:200,headers:{'content-length':String(response.ContentLength),
      'content-type':response.ContentType || 'application/octet-stream',etag:response.ETag || ''}};
  }
  async openDownload(model,options={}) {
    if(model.canDownload===false) throw failure('R2_DOWNLOAD_RESTRICTED',403);
    return this.openObject(model.archiveId,{...options,etag:model.checksum});
  }
  async openPreview(model,options={}) {return this.openObject(model.previewId,{...options,etag:model.previewMetadata?.etag});}
}
