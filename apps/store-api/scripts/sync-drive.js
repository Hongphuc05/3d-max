import { pool } from '../src/db.js';
import { createCatalogRuntime } from '../src/catalog-runtime.js';

try {
  const runtime=await createCatalogRuntime({pool});
  if(!runtime.worker)throw Object.assign(new Error(),{code:runtime.config.errors[0] || 'GOOGLE_DRIVE_CONFIGURATION_REQUIRED'});
  console.log('Starting Google Drive sync; the previous successful catalog stays available.');
  console.log(JSON.stringify(await runtime.worker.sync()));
}catch(error){
  console.error('Drive sync failed:',/^[A-Z_]+$/.test(error.code || '')?error.code:'CATALOG_SYNC_FAILED');
  if(/^[\w-]+$/.test(error.sourceFileId || ''))console.error('Preview source file requiring attention:',error.sourceFileId);
  process.exitCode=1;
}
finally{await pool.end();}
