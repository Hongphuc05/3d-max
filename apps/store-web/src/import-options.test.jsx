import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
const listeners=new Set(),calls=[];
const options=[
 ['Chair Corona 2018.max','Corona/2018/Chair.max','max','Corona',2018],
 ['Chair Corona 2020.max','Corona/2020/Chair.max','max','Corona',2020],
 ['Chair V-Ray 2018.max','V-Ray/2018/Chair.max','max','V-Ray',2018],
 ['Chair V-Ray 2020.max','V-Ray/2020/Chair.max','max','V-Ray',2020],
 ['Chair.fbx','Exchange/Chair.fbx','fbx'],['Chair.obj','Exchange/Chair.obj','obj'],['Chair Legacy.max','Legacy/Chair.max','max']
].map(([label,relativePath,format,renderer,maxVersion],index)=>({optionId:String(index+1).repeat(64),label,relativePath,format,renderer,maxVersion}));
let rejected=false;
window.chrome={webview:{addEventListener:(_type,listener)=>listeners.add(listener),postMessage(request){
 calls.push(request);let data;
 if(request.method==='library.importOptions')data={id:request.id,ok:true,result:{options,defaultOptionId:options[0].optionId}};
 else if(request.method==='asset.import')data=rejected?{id:request.id,ok:false,error:{code:'IMPORT_OPTION_INVALID',message:'File đã chọn không còn trên máy.'}}:{id:request.id,ok:true,result:{imported:1}};
 else throw Error('Unexpected bridge '+request.method);
 setTimeout(()=>listeners.forEach(listener=>listener({data})),1);
}}};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Local chooser must never call backend')};
const {createRoot}=await import('react-dom/client');
const {importDownloaded,getImports}=await import('./local-imports.js');
const {default:ImportOptionsDialog}=await import('./ImportOptionsDialog.jsx');
const flush=()=>new Promise(resolve=>setTimeout(resolve,15));
after(()=>{globalThis.fetch=originalFetch;dom.window.close()});
async function mount(modelId){const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(<ImportOptionsDialog/>);await importDownloaded(modelId);await flush()});return root}
test('seven files require explicit choice; nondefault renderer/version sends opaque ID only',async()=>{
 calls.length=0;const root=await mount('seven-files'),dialog=document.querySelector('[role=dialog]');assert.ok(dialog);
 const radios=[...dialog.querySelectorAll('input[type=radio]')];assert.equal(radios.length,7);assert.equal(radios.filter(r=>r.checked).length,0);
 assert.match(dialog.textContent,/V-Ray\/2020\/Chair.max/);assert.match(dialog.textContent,/Max 2020/);
 assert.equal(calls.filter(c=>c.method==='asset.import').length,0);
 await act(async()=>{await importDownloaded('seven-files')});assert.equal(calls.filter(c=>c.method==='library.importOptions').length,1);
 await act(()=>radios[3].click());
 await act(async()=>{[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Import file đã chọn').click();await flush()});
 const imports=calls.filter(c=>c.method==='asset.import');assert.equal(imports.length,1);
 assert.deepEqual(imports[0].params,{modelId:'seven-files',optionId:options[3].optionId});assert.equal(document.querySelector('[role=dialog]'),null);
 assert.equal(getImports().find(i=>i.modelId==='seven-files').status,'done');await act(()=>root.unmount());
});
test('Cancel and Escape never import or download',async()=>{
 calls.length=0;const root=await mount('cancel-files');
 await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Hủy').click());assert.equal(document.querySelector('[role=dialog]'),null);
 await act(async()=>{await importDownloaded('cancel-files');await flush()});
 const dialog=document.querySelector('[role=dialog]');await act(()=>dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(calls.filter(c=>c.method==='asset.import').length,0);assert.ok(calls.every(c=>c.method==='library.importOptions'));await act(()=>root.unmount());
});
test('stale selected file fails without fallback or download',async()=>{
 calls.length=0;rejected=true;const root=await mount('stale-files');await act(()=>document.querySelectorAll('input[type=radio]')[6].click());
 await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Import file đã chọn').click();await flush()});
 const state=getImports().find(i=>i.modelId==='stale-files');assert.equal(state.status,'failed');assert.match(state.error,/không còn/);
 assert.deepEqual(calls.filter(c=>c.method==='asset.import').map(c=>c.params),[{modelId:'stale-files',optionId:options[6].optionId}]);
 assert.ok(calls.every(c=>['library.importOptions','asset.import'].includes(c.method)));rejected=false;await act(()=>root.unmount());
});
