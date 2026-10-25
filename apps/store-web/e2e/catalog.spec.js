import {test,expect} from '@playwright/test';

const product=(id,name)=>({id,slug:id,name,category:'root',subcategory:'Deep',folderId:'leaf',folderIds:['root','leaf'],folderPath:'Wall light/Deep',price:0,thumb:`/api/catalog/models/${id}/preview?v=1`,image:null,info:{sizeMB:1,renderers:[],formats:[],hasTextures:null}});
async function fixture(page,native=false){
  const state={version:1,products:[product('aabbcc112233','Lamp A'),product('aabbcc445566','Lamp B')]};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(native)await page.addInitScript(()=>{
    const listeners=[];window.chrome={webview:{addEventListener:(_n,fn)=>listeners.push(fn),postMessage:m=>{
      const result=m.method==='device.getIdentity'?{deviceId:'fixture',publicKey:{},keyProtection:'TPM'}:m.method==='device.signChallenge'?{signature:'proof'}:m.method==='host.getInfo'?{hostVersion:'3ds Max fixture'}:m.method==='asset.import'?{imported:1}:{objects:0,renderer:'fixture'};
      if(m.method==='asset.import')listeners.forEach(fn=>fn({data:{id:m.id,type:'asset.progress',receivedBytes:50,totalBytes:100}}));
      setTimeout(()=>listeners.forEach(fn=>fn({data:{id:m.id,ok:true,result}})),20);
    }}};
  });
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/preview'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'});
    let json;
    if(path==='/api/auth/me')return route.fulfill(native?{json:{user:{id:'user',email:'user@test.invalid'}}}:{status:401,json:{error:'UNAUTHENTICATED'}});
    else if(path==='/api/health')json={ok:true};
    else if(path==='/api/catalog/version')json={version:state.version,provider:'google_drive',state:state.products.length?'ready':'empty',lastSuccessfulSync:'2026-10-25T00:00:00Z'};
    else if(path==='/api/products')json={items:state.products,total:state.products.length,version:state.version};
    else if(path==='/api/categories')json=[{id:'root',name:'Wall light',path:'Wall light',count:state.products.length,children:[{id:'leaf',name:'Deep',path:'Wall light/Deep',count:state.products.length,children:[]}]}];
    else if(path==='/api/licenses/me')json={license:{id:'license',status:'ACTIVE',type:'LIFETIME'}};
    else if(path==='/api/licenses/devices')json={devices:[]};
    else if(path==='/api/devices/challenge')json={challengeId:'challenge',message:'challenge'};
    else if(path==='/api/devices/verify')json={license:{id:'license',status:'ACTIVE'},expiresAt:new Date(Date.now()+3600000).toISOString()};
    else if(path.endsWith('/import-ticket'))json={assetId:path.split('/')[3],ticket:'fixture-ticket'};
    else throw new Error(`Unmocked catalog API ${path}`);
    return route.fulfill({json});
  });
  return {state,errors};
}

test('recursive folders, search, cached previews and foreground version refresh preserve selection',async({page})=>{
  const {state,errors}=await fixture(page);const requested=[];page.on('request',r=>requested.push(r.url()));
  await page.goto('/');await expect(page.getByText('Lamp A',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Wall light/}).click();await expect(page.getByRole('button',{name:'Deep 2',exact:true})).toBeVisible();
  await page.getByPlaceholder('Tìm model…').fill('Lamp A');await expect(page.getByText('Lamp B',{exact:true})).toHaveCount(0);
  await page.getByPlaceholder('Tìm model…').fill('');
  await page.getByRole('button',{name:'Lamp A Deep 1 MB'}).click();await expect(page.getByRole('heading',{name:'Lamp A'})).toBeVisible();
  state.version++;state.products=[state.products[0]];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Lamp B',{exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Lamp A'})).toBeVisible();
  expect(requested.some(url=>url.includes('drive.google.com'))).toBe(false);expect(errors).toEqual([]);
});

test('online deletion keeps completed local queue entry and login intact',async({page})=>{
  const {state,errors}=await fixture(page,true);await page.goto('/');
  await expect(page.getByRole('button',{name:'Download',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'Download',exact:true}).first().click();
  await expect(page.getByRole('button',{name:/Đã import/})).toBeVisible();
  state.version++;state.products=[];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Lamp A',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Đã tải/}).click();await expect(page.getByText('Lamp A',{exact:true})).toBeVisible();
  await expect(page.getByTitle('user@test.invalid')).toBeVisible();expect(errors).toEqual([]);
});
