import test from 'node:test';
import assert from 'node:assert/strict';
import {bridge} from '../worker.mjs';
import {blank} from '../game.mjs';

const state=()=>({...blank(19),revision:42});
const reviewState=()=>({...state(),review:{candidate:{x:0,y:0},reference:{x:1,y:0}}});
function reviewResult(s){const item=point=>{const move='ABCDEFGHJKLMNOPQRST'[point.x]+(s.size-point.y);return {move,rootInfo:{visits:64,scoreLead:1},moves:[{move,pv:[move]}],ownership:Array(s.size*s.size).fill(0)};};return {revision:s.revision,perspective:'black',candidate:item(s.review.candidate),reference:item(s.review.reference)};}
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const never=()=>new Promise(()=>{});
function hanging(signal){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(reply({x:3,y:3})),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Timed out','TimeoutError'))},{once:true});});}

// Fake Durable Object namespace: records every request the Worker sends to the container.
function engine(handler){const calls=[];return {calls,names:[],idFromName(name){this.names.push(name);return name;},get:()=>({fetch:async request=>{const body=JSON.parse(await request.text());calls.push({path:new URL(request.url).pathname,warmOnly:request.headers.get('x-engine-warm-only'),budget:Number(request.headers.get('x-engine-budget-ms')),state:body.state});return handler(body.state,request);}})};}
const vps={ENGINE_URL:'https://vps.example/',ENGINE_TOKEN:'unit-fallback'};

test('warm Cloudflare engine answers a move alone and only receives board fields',async t=>{
 const ENGINE=engine(()=>reply({x:15,y:3}));t.mock.method(globalThis,'fetch',async()=>{throw new Error('VPS must not be called');});
 const result=await bridge({ENGINE,...vps},'move',{...state(),profile:{name:'private'},feedback:['private']});
 assert.equal(result.engine_backend,'cloudflare');assert.deepEqual(ENGINE.names,['katago']);
 assert.equal(ENGINE.calls.length,1);const call=ENGINE.calls[0];assert.equal(call.path,'/move');assert.equal(call.warmOnly,'1');assert.equal(call.budget,8000);
 assert.equal(call.state.size,19);assert.equal(call.state.profile,undefined);assert.equal(call.state.feedback,undefined);
});
test('a sleeping container hands the move to the VPS and the next move tries Cloudflare again',async t=>{
 let warm=false;const ENGINE=engine(()=>warm?reply({x:3,y:3}):reply({error:'Engine is warming up'},503));const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([String(url),init.headers.Authorization,init.redirect]);return reply({x:15,y:3});});
 assert.equal((await bridge({ENGINE,...vps},'move',state())).engine_backend,'vps');assert.deepEqual(calls,[['https://vps.example/move','Bearer unit-fallback','manual']]);
 warm=true;calls.length=0;assert.equal((await bridge({ENGINE,...vps},'move',state())).engine_backend,'cloudflare');assert.deepEqual(calls,[]);assert.equal(ENGINE.calls.length,2);
});
test('container errors, invalid output or a hang fall back exactly once',async t=>{
 for(const failure of ['throw','http','invalid','hang']){
  const ENGINE=engine(()=>failure==='throw'?Promise.reject(new Error('object reset')):failure==='http'?reply({},500):failure==='invalid'?reply({x:99,y:0}):never());const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return reply({pass:true});});
  const result=await bridge({ENGINE,...vps,ENGINE_CONTAINER_TIMEOUT_MS:5},'move',state());assert.equal(result.engine_backend,'vps',failure);assert.equal(result.pass,true);assert.deepEqual(calls,['https://vps.example/move']);t.mock.restoreAll();
 }
});
test('move and review budgets stay inside the browser timeouts',async t=>{
 const realTimeout=AbortSignal.timeout.bind(AbortSignal);
 for(const [path,input,defaults,limits] of [['move',state(),[8000,6000],[10000,8000]],['review',reviewState(),[10000,8000],[10000,8000]]]){
  for(const [configured,expected] of [[{},defaults],[{ENGINE_CONTAINER_TIMEOUT_MS:60000,ENGINE_FALLBACK_TIMEOUT_MS:60000},limits]]){
   const budgets=[];const ENGINE=engine((_,request)=>{budgets.push(Number(request.headers.get('x-engine-budget-ms')));return reply({},503);});
   t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return realTimeout(1000)});t.mock.method(globalThis,'fetch',async(url,init)=>path==='move'?reply({x:3,y:3}):reply(reviewResult(JSON.parse(init.body).state)));
   assert.equal((await bridge({ENGINE,...vps,...configured},path,input)).engine_backend,'vps');assert.deepEqual(budgets,expected,path);assert.ok(budgets[0]+budgets[1]<=18000);t.mock.restoreAll();
  }
 }
});
test('analysis may wake the container and waits longer before the VPS',async t=>{
 const ENGINE=engine(s=>reply({revision:s.revision,moves:[{move:'D4'}]}));t.mock.method(globalThis,'fetch',async()=>{throw new Error('VPS must not be called');});
 const r=await bridge({ENGINE,...vps},'analyze',state());assert.equal(r.engine_backend,'cloudflare');assert.equal(ENGINE.calls[0].warmOnly,null);assert.equal(ENGINE.calls[0].budget,15000);
 const busy=engine(()=>reply({error:'busy'},503));t.mock.restoreAll();const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));return reply({revision:JSON.parse(init.body).state.revision,moves:[{move:'Q16',order:0}]});});
 assert.equal((await bridge({ENGINE:busy,...vps},'analyze',state())).engine_backend,'vps');assert.deepEqual(calls,['https://vps.example/analyze']);
});
test('explicit review goes to the warm container with both roots and no learner data',async t=>{
 const ENGINE=engine(s=>reply(reviewResult(s)));t.mock.method(globalThis,'fetch',async()=>{throw new Error('VPS must not be called');});
 const result=await bridge({ENGINE,...vps},'review',{...reviewState(),profile:{name:'private'},feedback:['private']});
 assert.equal(result.engine_backend,'cloudflare');assert.equal(result.candidate.move,'A19');assert.equal(result.reference.move,'B19');
 const call=ENGINE.calls[0];assert.equal(call.path,'/review');assert.equal(call.warmOnly,'1');assert.equal(call.budget,10000);assert.deepEqual(call.state.review,reviewState().review);assert.equal(call.state.profile,undefined);
});
test('incomplete review falls back once; both failing stops without a third request',async t=>{
 const ENGINE=engine(()=>reply({revision:42,perspective:'black',candidate:{}}));let vpsFails=false;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));return vpsFails?reply({},503):reply(reviewResult(JSON.parse(init.body).state));});
 assert.equal((await bridge({ENGINE,...vps},'review',reviewState())).engine_backend,'vps');assert.deepEqual(calls,['https://vps.example/review']);
 vpsFails=true;calls.length=0;await assert.rejects(bridge({ENGINE,...vps},'review',reviewState()),e=>e.status===503&&e.message.includes('均未完成复核'));assert.deepEqual(calls,['https://vps.example/review']);assert.equal(ENGINE.calls.length,2);
});
test('container 4xx is reported and nothing is forwarded to the VPS',async t=>{
 const ENGINE=engine(()=>reply({error:'sensitive container details'},400));const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return reply({x:3,y:3});});
 await assert.rejects(bridge({ENGINE,...vps},'move',state()),e=>e.status===502&&e.retryable===false&&e.message.includes('HTTP 400')&&!e.message.includes('sensitive'));assert.deepEqual(calls,[]);
});
test('VPS redirects stop without following or forwarding another credential',async t=>{
 const ENGINE=engine(()=>reply({},503));const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),authorization:init.headers.Authorization});assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});});
 await assert.rejects(bridge({ENGINE,...vps},'move',state()),e=>e.status===502&&e.retryable===false&&e.message.includes('未转发凭据'));
 assert.deepEqual(calls,[{url:'https://vps.example/move',authorization:'Bearer unit-fallback'}]);
});
test('both backends failing is a clear 503 and the VPS is not retried',async t=>{
 const ENGINE=engine(()=>reply({},503));const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return reply({error:'not ready'},503);});
 await assert.rejects(bridge({ENGINE,...vps},'move',state()),e=>e.status===503&&e.message.includes('均未完成应手'));assert.deepEqual(calls,['https://vps.example/move']);
});
test('single-backend deployments still work and say which service failed',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));return reply({revision:JSON.parse(init.body).state.revision,moves:[{move:'Q16',order:0}]});});
 const r=await bridge(vps,'analyze',state());assert.equal(r.engine_backend,'vps');assert.deepEqual(calls,['https://vps.example/analyze']);
 await assert.rejects(bridge({ENGINE:engine(()=>reply({},503))},'move',state()),e=>e.status===503&&e.message.startsWith('Cloudflare计算服务暂时未完成应手'));
 await assert.rejects(bridge({},'move',state()),e=>e.status===503&&e.message.includes('尚未连接'));
});
test('VPS hang is bounded by its own budget',async t=>{
 const ENGINE=engine(()=>reply({},503));t.mock.method(globalThis,'fetch',async(url,init)=>hanging(init.signal));
 await assert.rejects(bridge({ENGINE,...vps,ENGINE_FALLBACK_TIMEOUT_MS:5},'move',state()),e=>e.status===503);
});
