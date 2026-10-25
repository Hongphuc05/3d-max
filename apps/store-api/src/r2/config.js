const DEFAULT_SYNC_INTERVAL_SECONDS=600;
const DEFAULT_BATCH_SIZE=1000;

function readBoolean(env,name,fallback,errors) {
  const value=env[name];
  if(value===undefined || value==='')return fallback;
  if(String(value).toLowerCase()==='true')return true;
  if(String(value).toLowerCase()==='false')return false;
  errors.push(`${name}_INVALID`);
  return fallback;
}

function readInteger(env,name,fallback,{min=1,max=Number.MAX_SAFE_INTEGER}={},errors) {
  const error=`${name.replace(/_SECONDS$/,'')}_INVALID`;
  const value=env[name];
  if(value===undefined || value==='')return fallback;
  if(!/^\d+$/.test(String(value))) { errors.push(error); return fallback; }
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed) || parsed<min || parsed>max) { errors.push(error); return fallback; }
  return parsed;
}

export function loadR2Config(env=process.env) {
  const errors=[];
  const endpoint=env.R2_ENDPOINT || '';
  const rootPrefix=env.R2_SYNC_ROOT_PREFIX || env.R2_ROOT_PREFIX || '3DSMOOD/';
  try {
    const url=new URL(endpoint);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error();
  } catch { errors.push('R2_ENDPOINT_REQUIRED'); }
  if(!env.R2_BUCKET?.trim())errors.push('R2_BUCKET_REQUIRED');
  if(!rootPrefix.endsWith('/') || rootPrefix.startsWith('/') || rootPrefix.includes('\u0000'))errors.push('R2_ROOT_PREFIX_INVALID');
  if(!env.R2_READ_ACCESS_KEY_ID || !env.R2_READ_SECRET_ACCESS_KEY)errors.push('R2_READ_CREDENTIALS_REQUIRED');
  if(!env.R2_REGION)errors.push('R2_REGION_REQUIRED');

  const syncEnabled=readBoolean(env,'R2_SYNC_ENABLED',true,errors);
  const syncOnStartup=readBoolean(env,'R2_SYNC_ON_STARTUP',true,errors);
  const webhookEnabled=readBoolean(env,'R2_WEBHOOK_ENABLED',false,errors);
  const syncIntervalSeconds=readInteger(env,'R2_SYNC_INTERVAL_SECONDS',DEFAULT_SYNC_INTERVAL_SECONDS,{min:1,max:86400},errors);
  const batchSize=readInteger(env,'R2_SYNC_BATCH_SIZE',DEFAULT_BATCH_SIZE,{min:1,max:1000},errors);
  return {provider:'r2',accountId:env.R2_ACCOUNT_ID || '',bucket:env.R2_BUCKET || '',rootPrefix,
    webhookEnabled,webhookSecret:webhookEnabled?(env.R2_EVENT_WEBHOOK_SECRET || ''):'',
    endpoint,region:env.R2_REGION || '',credentials:{accessKeyId:env.R2_READ_ACCESS_KEY_ID || '',secretAccessKey:env.R2_READ_SECRET_ACCESS_KEY || ''},
    syncEnabled,syncOnStartup,syncIntervalSeconds,batchSize,configured:errors.length===0,errors};
}
