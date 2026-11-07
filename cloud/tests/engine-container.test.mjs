import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const SOURCE=readFileSync(new URL('../engine-container.mjs',import.meta.url),'utf8');
function load(){
 const context={Response,Request,URL,crypto,AbortSignal,DOMException,setTimeout,clearTimeout,Uint8Array,Set,Promise,JSON,Number,Math,Date,
  DurableObject:class {constructor(ctx,env){this.ctx=ctx;this.env=env;}}};
 runInNewContext(SOURCE.replace(/^import .*;\n/gm,'').replace(/^export (const|class) /gm,'$1 ')+'\nglobalThis.KataGoContainer=KataGoContainer;',context);
 return context.KataGoContainer;
}
const KataGoContainer=load();

function fakeContainer({healthy=true}={}){
 const c={running:false,ready:false,starts:[],timeouts:[],requests:[],
  start(options){if(c.running)throw new Error('already running');c.running=true;c.starts.push(options);},
  async setInactivityTimeout(ms){c.timeouts.push(ms);},
  getTcpPort(port){assert.equal(port,8080);return {fetch:async(url,init)=>{
   const path=new URL(url).pathname;c.requests.push({path,method:init.method,auth:init.headers.Authorization,body:init.body});
   if(!healthy)throw new TypeError('connection refused');
   if(path==='/health')return new Response(JSON.stringify({ok:true,available:true,busy:false,ready:c.ready}));
   if(path==='/warm'){c.ready=true;return new Response(JSON.stringify({ok:true,ready:true}));}
   c.ready=true;return new Response(JSON.stringify({x:2,y:3}),{headers:{'Content-Type':'application/json'}});
  }};}};
 return c;
}
function make(container,storage=new Map()){
 const pending=[];
 const ctx={container,waitUntil:p=>pending.push(p),storage:{get:async k=>storage.get(k),put:async(k,v)=>{storage.set(k,v);}}};
 return {object:new KataGoContainer(ctx,{}),pending,storage};
}
const post=(path,headers={})=>new Request('https://engine'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({state:{size:9}})});

test('a cold container answers a live move at once, then loads the model in the background',async()=>{
 const container=fakeContainer(),{object,pending,storage}=make(container);
 const cold=await object.fetch(post('/move',{'x-engine-warm-only':'1','x-engine-budget-ms':'8000'}));
 assert.equal(cold.status,503);assert.equal(container.starts.length,1);
 const token=storage.get('bridge-token');assert.match(token,/^[0-9a-f]{64}$/);
 assert.deepEqual(JSON.parse(JSON.stringify(container.starts[0])),{env:{GO_COACH_ENGINE_TOKEN:token},enableInternet:false});
 assert.deepEqual(container.timeouts,[600000]);
 await Promise.all(pending);
 assert.ok(container.requests.some(r=>r.path==='/warm'&&r.auth==='Bearer '+token));
 const warm=await object.fetch(post('/move',{'x-engine-warm-only':'1'}));
 assert.equal(warm.status,200);assert.deepEqual(await warm.json(),{x:2,y:3});assert.equal(container.starts.length,1);
 const move=container.requests.find(r=>r.path==='/move');assert.equal(move.auth,'Bearer '+token);assert.deepEqual(JSON.parse(move.body),{state:{size:9}});
});
test('analysis waits for a cold start instead of giving up',async()=>{
 const container=fakeContainer(),{object}=make(container);
 const response=await object.fetch(post('/analyze',{'x-engine-budget-ms':'5000'}));
 assert.equal(response.status,200);assert.deepEqual(container.requests.map(r=>r.path),['/health','/analyze']);
});
test('the bridge token survives a Durable Object restart',async()=>{
 const storage=new Map(),container=fakeContainer();container.running=true;container.ready=true;
 await make(container,storage).object.fetch(post('/move',{'x-engine-warm-only':'1'}));
 await make(container,storage).object.fetch(post('/move',{'x-engine-warm-only':'1'}));
 const tokens=new Set(container.requests.map(r=>r.auth));assert.equal(tokens.size,1);assert.equal(container.starts.length,0);
});
test('an engine that never comes up fails within the budget',async()=>{
 const container=fakeContainer({healthy:false}),{object}=make(container);const started=Date.now();
 const response=await object.fetch(post('/analyze',{'x-engine-budget-ms':'300'}));
 assert.equal(response.status,503);assert.ok(Date.now()-started<2000);
});
test('only POST to the three engine paths is accepted',async()=>{
 const container=fakeContainer(),{object}=make(container);
 assert.equal((await object.fetch(new Request('https://engine/move'))).status,404);
 assert.equal((await object.fetch(post('/warm'))).status,404);
 assert.equal((await object.fetch(post('/health'))).status,404);
 assert.equal(container.starts.length,0);
});
