import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { GoogleDriveCatalogProvider, DriveError, classifyDriveError } from './provider.js';
import { loadDriveConfig } from './config.js';
import { pairFiles } from './pairing.js';

const folder = (id, name = id, parents = []) => ({ id, name, parents, mimeType: 'application/vnd.google-apps.folder' });
const file = (id, name, parents = ['root']) => ({ id, name, parents, mimeType: name.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream', size: '42', modifiedTime: '2026-01-01T00:00:00Z', capabilities: { canDownload: true } });
const config = { folderId: 'root', apiKey: 'test', requestTimeoutMs: 100, retries: 2 };

test('config defaults to Drive without manufacturing a missing key, accepts resource keys and validates source URL', () => {
  const c = loadDriveConfig({ GOOGLE_DRIVE_FOLDER_URL: 'https://drive.google.com/drive/folders/root?resourcekey=key' });
  assert.equal(c.provider, 'google_drive');
  assert.equal(c.folderId, 'root');
  assert.equal(c.resourceKey, 'key');
  assert.equal(c.configured, false);
  assert.ok(c.errors.includes('GOOGLE_DRIVE_API_KEY_REQUIRED'));
  assert.equal(loadDriveConfig({ GOOGLE_DRIVE_FOLDER_URL: 'https://evil.test/drive/folders/root', GOOGLE_DRIVE_API_KEY: 'key' }).configured, false);
  assert.equal(loadDriveConfig({ CATALOG_PROVIDER: 'local' }).provider, 'local');
});

test('stream response errors and SDK timeouts retain safe quota/restriction classifications',()=>{
  for(const [reason,code] of [['downloadQuotaExceeded','DRIVE_QUOTA_EXCEEDED'],['downloadRestricted','DRIVE_DOWNLOAD_RESTRICTED'],['accessNotConfigured','GOOGLE_DRIVE_API_DISABLED']]) {
    const error={response:{status:403},config:{responseType:'stream'},message:JSON.stringify({error:{errors:[{reason}]}})};
    assert.equal(classifyDriveError(error).code,code);
  }
  assert.equal(classifyDriveError({code:'TimeoutError'}).code,'DRIVE_TIMEOUT');
  assert.equal(classifyDriveError({message:'private-key',response:{status:403}}).message,'DRIVE_PERMISSION_DENIED');
  assert.equal(classifyDriveError({message:'<html><title>Sorry...</title>Your computer or network may be sending automated queries.</html>',config:{responseType:'stream'},response:{status:403}}).code,'DRIVE_AUTOMATED_REQUESTS_BLOCKED');
});

test('source validation rejects malformed config, root, pagination metadata and unsafe resource keys',async()=>{
  const bad=loadDriveConfig({GOOGLE_DRIVE_FOLDER_ID:'root',GOOGLE_DRIVE_FOLDER_URL:'https://drive.google.com/drive/folders/other',GOOGLE_DRIVE_API_KEY:'test',GOOGLE_DRIVE_SYNC_INTERVAL_MINUTES:'NaN',GOOGLE_DRIVE_RESOURCE_KEY:'bad/key'});
  assert.equal(bad.configured,false);assert.ok(bad.errors.includes('GOOGLE_DRIVE_FOLDER_ID_MISMATCH'));
  const p=new GoogleDriveCatalogProvider({config,drive:{files:{get:async()=>({data:file('root','not-folder.rar')}),list:async()=>({data:{files:[{id:'x',name:'x.zip',mimeType:'file',parents:['wrong']}]}})}}});
  await assert.rejects(p.scan(),{code:'DRIVE_ROOT_IS_NOT_FOLDER'});
  await assert.rejects(p.listFolder({id:'root'}),{code:'DRIVE_INVALID_METADATA'});
  await assert.rejects(p.getMetadata({id:'root',resourceKey:'bad/key'}),{code:'DRIVE_INVALID_RESOURCE_KEY'});
  assert.equal(classifyDriveError({response:{status:503}}).code,'DRIVE_UNAVAILABLE');
  assert.equal(classifyDriveError({response:{status:403,data:{error:{details:[{reason:'API_KEY_SERVICE_BLOCKED'}]}}}}).code,'GOOGLE_DRIVE_API_KEY_RESTRICTED');
});

test('automated-request protection stops the operation without immediate retry or bypass',async()=>{
  let calls=0;
  const provider=new GoogleDriveCatalogProvider({config,sleep:async()=>assert.fail('must stop and wait for the next scheduled sync'),drive:{files:{get:async()=>{
    calls++;throw {message:'<html><title>Sorry...</title>Your network may be sending automated queries.</html>',config:{responseType:'stream'},response:{status:403}};
  }}}});
  await assert.rejects(provider.openDownload({id:'preview'}),{code:'DRIVE_AUTOMATED_REQUESTS_BLOCKED',status:503});
  assert.equal(calls,1);
});

test('pairing normalizes Unicode/space/case, uses deterministic priorities, never pairs across folders', () => {
  const warnings = [];
  const rows = pairFiles([file('b', ' CAFÉ  Lamp.RAR'), file('a', ' café lamp.ZIP'), file('p2', 'cafe\u0301 lamp.PNG'), file('p1', 'Café lamp.JPG'), file('orphan', 'other.JPG'), file('alone', 'café lamp.7Z', ['other'])], { warn: x => warnings.push(x) });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(x => x.folderId === 'root').archiveId, 'a');
  assert.equal(rows.find(x => x.folderId === 'root').preview.id, 'p1');
  assert.equal(rows.find(x => x.folderId === 'other').preview, null);
  assert.equal(warnings.length, 2);
});

test('recursive traversal drains pagination, carries resource keys and returns metadata without modifying source', async () => {
  const requests = [];
  const drive = { files: {
    get: async () => ({ data: { ...folder('root', 'Wall light'), resourceKey: 'rk' } }),
    list: async (args, options) => {
      requests.push({ args, options });
      if (args.q.includes("'root'")) return args.pageToken ? { data: { files: [file('p', 'lamp.JPG')] } } : { data: { files: [{ ...folder('nested', 'Sub', ['root']), resourceKey: 'nk' }, file('a', 'lamp.RAR')], nextPageToken: 'page2' } };
      return { data: { files: [file('z', 'Chair.7z', ['nested'])] } };
    },
  } };
  const result = await new GoogleDriveCatalogProvider({ config, drive }).scan();
  assert.deepEqual(result.folders.map(x => x.path), ['Wall light', 'Wall light/Sub']);
  assert.equal(result.models.length, 2);
  assert.equal(result.filesScanned, 4);
  assert.equal(result.models[0].preview.id, 'p');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers['X-Goog-Drive-Resource-Keys'], 'root/rk');
  assert.equal(requests[2].options.headers['X-Goog-Drive-Resource-Keys'], 'nested/nk');
});

test('partial scan, incompleteSearch and repeated pagination token fail instead of returning a deletion snapshot', async () => {
  for (const list of [async () => { throw { response: { status: 403 } }; }, async () => ({ data: { files: [], incompleteSearch: true } }), async () => ({ data: { files: [], nextPageToken: 'repeat' } })]) {
    const provider = new GoogleDriveCatalogProvider({ config, drive: { files: { get: async () => ({ data: folder('root') }), list } }, sleep: async () => {} });
    await assert.rejects(provider.scan(), DriveError);
  }
});

test('quota failures retry exponentially; permission/auth/resource-key/restriction failures remain distinct and redact provider errors', async () => {
  const delays = [];
  let calls = 0;
  const provider = new GoogleDriveCatalogProvider({ config, sleep: async ms => delays.push(ms), random: () => 0, drive: { files: { get: async () => {
    if (++calls < 3) throw { response: { status: 429 } };
    return { data: folder('root') };
  } } } });
  assert.equal((await provider.getMetadata({ id: 'root' })).id, 'root');
  assert.deepEqual(delays, [1000, 2000]);
  for (const [status, reason, code] of [[401, '', 'DRIVE_AUTHENTICATION_REQUIRED'], [403, 'insufficientFilePermissions', 'DRIVE_PERMISSION_DENIED'], [404, '', 'DRIVE_FILE_OR_RESOURCE_KEY_NOT_FOUND'], [403, 'downloadRestricted', 'DRIVE_DOWNLOAD_RESTRICTED']]) {
    const p = new GoogleDriveCatalogProvider({ config, drive: { files: { get: async () => { throw { message: 'secret API key', response: { status, data: { error: { errors: [{ reason }] } } } }; } } } });
    await assert.rejects(p.getMetadata({ id: 'root' }), err => err.code === code && !err.message.includes('secret'));
  }
});

test('download streams with abort/resource-key headers and never acknowledges restrictions', async () => {
  let seen;
  const data = Readable.from(['archive']);
  const p = new GoogleDriveCatalogProvider({ config, drive: { files: { get: async (args, options) => { seen = { args, options }; return { data, status: 200, headers: { 'content-length': '7' } }; } } } });
  const signal = new AbortController().signal;
  assert.equal((await p.openDownload({ id: 'internal-model-id', archiveId: 'archive', resourceKey: 'rk', canDownload: true }, { signal })).data, data);
  assert.equal(seen.args.fileId,'archive','download maps internal model identity to its stored Drive identity');
  assert.equal(seen.args.alt, 'media');
  assert.equal(seen.options.responseType, 'stream');
  assert.equal(seen.options.signal, signal);
  assert.equal(seen.options.headers['X-Goog-Drive-Resource-Keys'], 'archive/rk');
  assert.equal(seen.args.acknowledgeAbuse, undefined);
  await assert.rejects(p.openDownload({ id: 'archive', canDownload: false }), { code: 'DRIVE_DOWNLOAD_RESTRICTED' });
  await assert.rejects(p.getMetadata({ id: "bad'id" }), { code: 'DRIVE_INVALID_FILE_ID' });
});
