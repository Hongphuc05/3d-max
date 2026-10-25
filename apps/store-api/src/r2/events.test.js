import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCatalogEventBus } from './events.js';

function fixture({failFirst=false}={}) {
  const clients=[],scheduled=[];let connects=0,warnings=0;
  const pool={connect:async()=>{
    connects++;
    const client=new EventEmitter();client.queries=[];client.releases=[];
    client.query=async query=>{client.queries.push(query);if(failFirst&&connects===1&&query.startsWith('LISTEN'))throw new Error('private database detail');return {rows:[]};};
    client.release=error=>client.releases.push(error);
    clients.push(client);return client;
  }};
  const scheduler={setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},clearTimeout(){}};
  return {pool,clients,scheduled,scheduler,logger:{warn:()=>warnings++},get connects(){return connects;},get warnings(){return warnings;}};
}

test('one shared listener broadcasts committed catalog versions and releases cleanly',async()=>{
  const setup=fixture();const bus=createCatalogEventBus({pool:setup.pool,scheduler:setup.scheduler,logger:setup.logger});
  const received=[];const unsubscribe=bus.subscribe(value=>received.push(value));
  await bus.start();
  assert.deepEqual(setup.clients[0].queries,['LISTEN r2_catalog_changed']);
  setup.clients[0].emit('notification',{channel:'other_channel',payload:'{"version":8}'});
  setup.clients[0].emit('notification',{channel:'r2_catalog_changed',payload:'{"version":8}'});
  setup.clients[0].emit('notification',{channel:'r2_catalog_changed',payload:'not-json'});
  assert.deepEqual(received,[{version:8}]);
  unsubscribe();await bus.stop();
  assert.deepEqual(setup.clients[0].queries,['LISTEN r2_catalog_changed','UNLISTEN r2_catalog_changed']);
  assert.equal(setup.clients[0].releases.length,1);
});

test('listener reconnects with sanitized logging after a database disconnect',async()=>{
  const setup=fixture({failFirst:true});const bus=createCatalogEventBus({pool:setup.pool,scheduler:setup.scheduler,logger:setup.logger});
  const received=[];bus.subscribe(value=>received.push(value));
  await bus.start();
  assert.equal(setup.warnings,1);assert.equal(setup.connects,1);assert.equal(setup.scheduled[0].ms,1000);
  setup.scheduled[0].fn();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(setup.connects,2);
  setup.clients[1].emit('notification',{channel:'r2_catalog_changed',payload:'{"version":9}'});
  assert.deepEqual(received,[{version:9}]);
  await bus.stop();
});
