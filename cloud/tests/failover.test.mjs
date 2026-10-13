import test from 'node:test';
import assert from 'node:assert/strict';
import {bridge} from '../worker.mjs';
import {blank} from '../game.mjs';
const env={ENGINE_PRIMARY_URL:'https://fnos.example/',ENGINE_PRIMARY_TOKEN:'unit-primary',ENGINE_URL:'https://vps.example/',ENGINE_TOKEN:'unit-fallback'};
const state=()=>({...blank(19),revision:42});
const reviewState=()=>({...state(),review:{candidate:{x:0,y:0},reference:{x:1,y:0}}});
function reviewResult(s){const item=point=>{const move='ABCDEFGHJKLMNOPQRST'[point.x]+(s.size-point.y);return {move,rootInfo:{visits:64,scoreLead:1},moves:[{move,pv:[move]}],ownership:Array(s.size*s.size).fill(0)};};return {revision:s.revision,perspective:'black',candidate:item(s.review.candidate),reference:item(s.review.reference)};}
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
test('explicit review uses one VPS request, keeps both roots and sends no learner data',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const payload=JSON.parse(init.body).state;calls.push(String(url));assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(payload.profile,undefined);assert.equal(payload.feedback,undefined);assert.deepEqual(payload.review,reviewState().review);return reply(reviewResult(payload));});
 const result=await bridge(env,'review',{...reviewState(),profile:{name:'private'},feedback:['private']});assert.equal(result.engine_backend,'vps');assert.equal(result.revision,42);assert.equal(result.candidate.move,'A19');assert.equal(result.reference.move,'B19');assert.deepEqual(calls,['https://vps.example/review']);
});
test('failed or incomplete VPS review falls back once and retries VPS on the next request',async t=>{
 for(const failure of ['network','http','incomplete']){let fast=false;const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const target=String(url);calls.push(target);if(target.includes('vps')&&!fast){if(failure==='network')throw new TypeError('offline');return failure==='http'?reply({},503):reply({revision:42,perspective:'black',candidate:{}});}return reply(reviewResult(JSON.parse(init.body).state));});
  assert.equal((await bridge(env,'review',reviewState())).engine_backend,'fnos');assert.deepEqual(calls,['https://vps.example/review','https://fnos.example/review']);fast=true;calls.length=0;assert.equal((await bridge(env,'review',reviewState())).engine_backend,'vps');assert.deepEqual(calls,['https://vps.example/review']);t.mock.restoreAll();
 }
});
test('review timeout retries once, and both timeouts fail without a third request',async t=>{
 const calls=[];let both=false;t.mock.method(globalThis,'fetch',async(url,init)=>{const target=String(url);calls.push(target);if(both||target.includes('vps'))return hanging(init.signal);return reply(reviewResult(JSON.parse(init.body).state));});const configured={...env,ENGINE_FALLBACK_TIMEOUT_MS:5,ENGINE_PRIMARY_TIMEOUT_MS:5};
 assert.equal((await bridge(configured,'review',reviewState())).engine_backend,'fnos');assert.deepEqual(calls,['https://vps.example/review','https://fnos.example/review']);both=true;calls.length=0;await assert.rejects(bridge(configured,'review',reviewState()),e=>e.status===503&&e.message.includes('均未完成复核'));assert.deepEqual(calls,['https://vps.example/review','https://fnos.example/review']);
});
test('review defaults and configured limits leave room inside the 30 second browser timeout',async t=>{
 const realTimeout=AbortSignal.timeout.bind(AbortSignal),budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return realTimeout(1000)});t.mock.method(globalThis,'fetch',async(url,init)=>String(url).includes('vps')?reply({},503):reply(reviewResult(JSON.parse(init.body).state)));
 for(const configured of [env,{...env,ENGINE_FALLBACK_TIMEOUT_MS:60000,ENGINE_PRIMARY_TIMEOUT_MS:60000}]){budgets.length=0;assert.equal((await bridge(configured,'review',reviewState())).engine_backend,'fnos');assert.deepEqual(budgets,[8000,10000]);}
});
test('review credential and redirect failures do not trigger a fallback request',async t=>{
 for(const status of [401,302]){const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return reply({},status);});await assert.rejects(bridge(env,'review',reviewState()),e=>e.status===502&&e.retryable===false);assert.deepEqual(calls,['https://vps.example/review']);t.mock.restoreAll();}
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
