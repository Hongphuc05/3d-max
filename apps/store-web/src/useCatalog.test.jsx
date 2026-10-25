import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import('react-dom/client');
const {useCatalog}=await import('./useCatalog.js');
let snapshot;
function Probe(){snapshot=useCatalog(0);return null;}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const flush=()=>new Promise(r=>setTimeout(r,10));
after(()=>dom.window.close());

test('catalog hook recovers transport errors on same version without dropping its snapshot',async()=>{
  let failed=false;
  globalThis.fetch=async url=>{
    if(failed)throw new Error('offline');
    if(url.includes('/catalog/version'))return response({provider:'google_drive',version:1,state:'ready'});
    if(url.includes('/categories'))return response([{id:'folder',name:'Folder',children:[]}]);
    return response({items:[{id:'model',name:'Lamp'}],total:1,version:1});
  };
  const root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(<Probe/>);await flush();});
  await act(flush);assert.equal(snapshot.products[0].name,'Lamp');
  failed=true;await act(async()=>{window.dispatchEvent(new dom.window.Event('focus'));await flush();});
  assert.ok(snapshot.error);assert.equal(snapshot.products.length,1);
  failed=false;await act(async()=>{window.dispatchEvent(new dom.window.Event('focus'));await flush();});
  assert.equal(snapshot.error,'');assert.equal(snapshot.products.length,1);
  await act(()=>root.unmount());
});
