import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import('react-dom/client');
const {useCatalog}=await import('./useCatalog.js');
let snapshot;
const originalFetch=globalThis.fetch,originalEventSource=globalThis.EventSource;
function Probe(){snapshot=useCatalog(0);return null;}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const flush=()=>new Promise(r=>setTimeout(r,10));
after(()=>{globalThis.fetch=originalFetch;if(originalEventSource===undefined)delete globalThis.EventSource;else globalThis.EventSource=originalEventSource;dom.window.close();});

test('catalog hook recovers transport errors on same version without dropping its snapshot',async()=>{
  let failed=false;
  globalThis.fetch=async url=>{
    if(failed)throw new Error('offline');
    if(url.includes('/catalog/version'))return response({provider:'r2',version:1,state:'ready'});
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

test('React catalog refreshes category tree, model count and preview on SSE without reloading the page',async()=>{
  let version=1,reads=0;
  class FixtureEventSource extends EventTarget {
    static latest;
    constructor(url){super();this.url=url;this.closed=false;FixtureEventSource.latest=this;}
    close(){this.closed=true;}
  }
  globalThis.EventSource=FixtureEventSource;
  globalThis.fetch=async url=>{
    const path=String(url);
    if(path.includes('/catalog/version'))return response({provider:'r2',version,state:'ready'});
    if(path.includes('/categories'))return response(version===1
      ?[{id:'furniture',name:'Furniture',path:'Furniture',count:1,children:[]}]
      :[{id:'furniture',name:'Furniture',path:'Furniture',count:1,children:[{id:'chair',name:'Gaming Chair',path:'Furniture/Gaming Chair',count:1,children:[]}]}]);
    reads++;
    const products=version===1?[{id:'old',name:'Sofa',thumb:'/preview/old',status:'ready'}]
      :[{id:'old',name:'Sofa',thumb:'/preview/old',status:'ready'},{id:'new',name:'Gaming Chair',thumb:'/preview/new',status:'missing_archive'}];
    return response({items:products,total:products.length,version});
  };
  const root=createRoot(document.getElementById('root'));
  let source;
  try {
    await act(async()=>{root.render(<Probe/>);await flush();});
    assert.equal(snapshot.products.length,1);assert.equal(snapshot.categories[0].children.length,0);
    source=FixtureEventSource.latest;assert.equal(source.url,'/api/catalog/events');
    version=2;await act(async()=>{source.dispatchEvent(new Event('catalog.changed'));await flush();});
    assert.equal(snapshot.products.length,2);assert.equal(snapshot.products[1].thumb,'/preview/new');
    assert.equal(snapshot.products[1].status,'missing_archive');assert.equal(snapshot.categories[0].children[0].path,'Furniture/Gaming Chair');
    assert.equal(reads,2);
    version=3;await act(async()=>{source.dispatchEvent(new Event('open'));await flush();});
    assert.equal(snapshot.products.length,2);assert.equal(reads,3);
  } finally {
    await act(()=>root.unmount());
    if(source)assert.equal(source.closed,true);
  }
});
