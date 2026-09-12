import test from 'node:test';
import assert from 'node:assert/strict';
import {bridge} from '../worker.mjs';
import {blank} from '../game.mjs';
const env={ENGINE_PRIMARY_URL:'https://fnos.example/',ENGINE_PRIMARY_TOKEN:'unit-primary',ENGINE_URL:'https://vps.example/',ENGINE_TOKEN:'unit-fallback'};
const state=()=>({...blank(19),revision:42});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function hanging(signal){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(reply({x:3,y:3})),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Timed out','TimeoutError'))},{once:true});});}
test('fast VPS move succeeds without a health round trip and only sends board fields',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([String(url),init]);const payload=JSON.parse(init.body).state;assert.equal(payload.size,19);assert.equal(payload.profile,undefined);assert.equal(payload.feedback,undefined);return reply({x:15,y:3});});
 const result=await bridge(env,'move',{...state(),profile:{name:'private'},feedback:['private']});assert.equal(result.engine_backend,'vps');assert.equal(calls.length,1);assert.equal(calls[0][0],'https://vps.example/move');assert.equal(calls[0][1].headers.Authorization,'Bearer unit-fallback');
});
test('failed fast move falls back to fnOS and the next request retries the fast path',async t=>{
 const calls=[];let fast=false;t.mock.method(globalThis,'fetch',async(url)=>{const path=String(url);calls.push(path);if(path.includes('vps')&&!fast)return reply({},503);return reply({x:3,y:3});});
 assert.equal((await bridge(env,'move',state())).engine_backend,'fnos');assert.deepEqual(calls,['https://vps.example/move','https://fnos.example/move']);fast=true;calls.length=0;assert.equal((await bridge(env,'move',state())).engine_backend,'vps');assert.deepEqual(calls,['https://vps.example/move']);
});
test('fast channel network or 5xx errors fall back exactly once',async t=>{
 for(const failure of ['network','http']){const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{const target=String(url);calls.push(target);if(target.includes('vps')){if(failure==='network')throw new TypeError('offline');return reply({error:'upstream'},503);}return reply({pass:true});});const r=await bridge(env,'move',state());assert.equal(r.engine_backend,'fnos');assert.equal(r.pass,true);assert.deepEqual(calls,['https://vps.example/move','https://fnos.example/move']);t.mock.restoreAll();}
});
test('fast move timeout is bounded and triggers one fnOS fallback',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const target=String(url);calls.push(target);if(target.includes('vps'))return hanging(init.signal);return reply({x:3,y:3});});const r=await bridge({...env,ENGINE_FALLBACK_TIMEOUT_MS:5},'move',state());assert.equal(r.engine_backend,'fnos');assert.deepEqual(calls,['https://vps.example/move','https://fnos.example/move']);
});
test('fast move budgets stay below the browser reconciliation timeout',async t=>{
 const realTimeout=AbortSignal.timeout.bind(AbortSignal),budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return realTimeout(1000)});t.mock.method(globalThis,'fetch',async url=>String(url).includes('vps')?reply({},503):reply({x:3,y:3}));const r=await bridge({...env,ENGINE_FALLBACK_TIMEOUT_MS:60000,ENGINE_PRIMARY_TIMEOUT_MS:60000},'move',state());assert.equal(r.engine_backend,'fnos');assert.deepEqual(budgets,[8000,10000]);
});
test('analysis still checks fnOS busy state before falling back',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(init.method==='GET')return reply({ok:true,available:true,busy:true});return reply({revision:42,moves:[{move:'D4'}]});});const r=await bridge(env,'analyze',state());assert.equal(r.engine_backend,'vps');assert.deepEqual(calls,['https://fnos.example/health','https://vps.example/analyze']);
});
test('fast channel 4xx is reported without forwarding another credential',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return reply({error:'sensitive upstream details'},401);});await assert.rejects(bridge(env,'move',state()),e=>e.status===502&&e.message.includes('HTTP 401')&&!e.message.includes('sensitive'));assert.deepEqual(calls,['https://vps.example/move']);
});
test('both backends fail clearly; fallback is not retried',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return reply({error:'not ready'},503);});await assert.rejects(bridge(env,'move',state()),e=>e.status===503&&e.message.includes('均未完成'));assert.deepEqual(calls,['https://vps.example/move','https://fnos.example/move']);
});
test('fallback-only compatibility and analysis provenance remain intact',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));return reply({revision:JSON.parse(init.body).state.revision,moves:[{move:'Q16',order:0}]});});const r=await bridge({ENGINE_URL:env.ENGINE_URL,ENGINE_TOKEN:env.ENGINE_TOKEN},'analyze',state());assert.equal(r.engine_backend,'vps');assert.equal(r.revision,42);assert.deepEqual(calls,['https://vps.example/analyze']);
});
test('every engine request uses edge-supported manual redirects',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),method:init.method});assert.equal(init.redirect,'manual');if(String(url).includes('vps'))return reply({},503);return reply({x:3,y:3});});
 assert.equal((await bridge(env,'move',state())).engine_backend,'fnos');assert.deepEqual(calls.map(c=>c.url),['https://vps.example/move','https://fnos.example/move']);
});
test('fast-channel 302 stops without following or forwarding another credential',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),authorization:init.headers.Authorization});assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});});
 await assert.rejects(bridge(env,'move',state()),e=>e.status===502&&e.retryable===false&&e.message.includes('未转发凭据'));
 assert.deepEqual(calls,[{url:'https://vps.example/move',authorization:'Bearer unit-fallback'}]);
});
