import test from 'node:test';
import assert from 'node:assert/strict';
import {bridge} from '../worker.mjs';
import {blank} from '../game.mjs';
const env={ENGINE_PRIMARY_URL:'https://fnos.example/',ENGINE_PRIMARY_TOKEN:'unit-primary',ENGINE_URL:'https://vps.example/',ENGINE_TOKEN:'unit-fallback'};
const state=()=>({...blank(19),revision:42});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function hanging(signal){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(reply({x:3,y:3})),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Timed out','TimeoutError'))},{once:true});});}
test('primary health then move succeeds without fallback and only sends board fields',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([String(url),init]);if(init.method==='GET')return reply({ok:true,available:true});const payload=JSON.parse(init.body).state;assert.equal(payload.size,19);assert.equal(payload.profile,undefined);assert.equal(payload.feedback,undefined);return reply({x:15,y:3});});
 const result=await bridge(env,'move',{...state(),profile:{name:'private'},feedback:['private']});assert.equal(result.engine_backend,'fnos');assert.equal(calls.length,2);assert.equal(calls[0][0],'https://fnos.example/health');assert.equal(calls[0][1].headers.Authorization,'Bearer unit-primary');assert.equal(calls[1][0],'https://fnos.example/move');
});
test('failed health skips primary POST and next request automatically recovers primary',async t=>{
 const calls=[];let healthy=false;t.mock.method(globalThis,'fetch',async(url,init)=>{const path=String(url);calls.push(path);if(path.includes('fnos')&&init.method==='GET')return reply({ok:true,available:healthy});return reply({x:3,y:3});});
 assert.equal((await bridge(env,'move',state())).engine_backend,'vps');assert.deepEqual(calls,['https://fnos.example/health','https://vps.example/move']);healthy=true;calls.length=0;assert.equal((await bridge(env,'move',state())).engine_backend,'fnos');assert.deepEqual(calls,['https://fnos.example/health','https://fnos.example/move']);
});
test('primary network or 5xx errors fall back exactly once',async t=>{
 for(const failure of ['network','http']){const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const target=String(url);calls.push(target);if(init.method==='GET')return reply({ok:true,available:true});if(target.includes('fnos')){if(failure==='network')throw new TypeError('offline');return reply({error:'upstream'},503);}return reply({pass:true});});const r=await bridge(env,'move',state());assert.equal(r.engine_backend,'vps');assert.equal(r.pass,true);assert.deepEqual(calls,['https://fnos.example/health','https://fnos.example/move','https://vps.example/move']);t.mock.restoreAll();}
});
test('primary POST timeout is bounded and triggers one fallback',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{const target=String(url);calls.push(target);if(init.method==='GET')return reply({ok:true,available:true});if(target.includes('fnos'))return hanging(init.signal);return reply({x:3,y:3});});const r=await bridge({...env,ENGINE_PRIMARY_TIMEOUT_MS:5},'move',state());assert.equal(r.engine_backend,'vps');assert.equal(calls.filter(x=>x.includes('vps')).length,1);
});
test('health probe timeout uses 1500ms budget and then one fallback',async t=>{
 const realTimeout=AbortSignal.timeout.bind(AbortSignal),budgets=[];t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return realTimeout(5)});t.mock.method(globalThis,'fetch',async(url,init)=>init.method==='GET'?hanging(init.signal):reply({x:3,y:3}));const r=await bridge(env,'move',state());assert.equal(r.engine_backend,'vps');assert.deepEqual(budgets,[1500,15000]);
});
test('primary 4xx is reported as backend error without fallback or user logout',async t=>{
 for(const stage of ['health','move']){const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(stage==='move'&&init.method==='GET')return reply({ok:true,available:true});return reply({error:'sensitive upstream details'},401);});await assert.rejects(bridge(env,'move',state()),e=>e.status===502&&e.message.includes('HTTP 401')&&!e.message.includes('sensitive'));assert.equal(calls.some(x=>x.includes('vps')),false);t.mock.restoreAll();}
});
test('both backends fail clearly; fallback is not retried',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return reply({error:'not ready'},503);});await assert.rejects(bridge(env,'move',state()),e=>e.status===503&&e.message.includes('均未完成'));assert.deepEqual(calls,['https://fnos.example/health','https://vps.example/move']);
});
test('fallback-only compatibility and analysis provenance remain intact',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));return reply({revision:JSON.parse(init.body).state.revision,moves:[{move:'Q16',order:0}]});});const r=await bridge({ENGINE_URL:env.ENGINE_URL,ENGINE_TOKEN:env.ENGINE_TOKEN},'analyze',state());assert.equal(r.engine_backend,'vps');assert.equal(r.revision,42);assert.deepEqual(calls,['https://vps.example/analyze']);
});
test('every engine request uses edge-supported manual redirects',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),method:init.method});assert.equal(init.redirect,'manual');if(init.method==='GET')return reply({ok:true,available:true});if(String(url).includes('fnos'))return reply({},503);return reply({x:3,y:3});});
 assert.equal((await bridge(env,'move',state())).engine_backend,'vps');assert.equal(calls.length,3);
});
test('primary 302 at health or calculation stops without following or falling back',async t=>{
 for(const stage of ['health','move']){const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),authorization:init.headers.Authorization});assert.equal(init.redirect,'manual');if(stage==='move'&&init.method==='GET')return reply({ok:true,available:true});return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});});
  await assert.rejects(bridge(env,'move',state()),e=>e.status===502&&e.retryable===false&&e.message.includes('未转发凭据'));
  assert.equal(calls.length,stage==='health'?1:2);assert.ok(calls.every(c=>c.url.startsWith('https://fnos.example/')));assert.ok(calls.every(c=>c.authorization==='Bearer unit-primary'));t.mock.restoreAll();
 }
});
