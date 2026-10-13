import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the shipped recovery functions with deterministic transport and timers.
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
function code(name){const i=declarations.findIndex(m=>m[1]===name);assert(i>=0);const text=source.slice(declarations[i].index,declarations[i+1]?.index??source.length);return name==='checkSession'?text.slice(0,text.indexOf("$('login-form')")):text;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const position=()=>({revision:3,profile:{id:'synthetic'},board:[[0]],engine:{},llm_explanation:null});
function client(){
 const timers=new Map(),calls=[],connections=[],toasts=[],elements=new Map();let timerId=0,initializations=0;
 const c=vm.createContext({
  authenticated:false,cloudMode:false,authEpoch:0,sessionRequest:null,sessionRetryTimer:null,sessionRetryAttempt:0,pollTimer:null,refreshRequest:null,writeRecovery:null,syncRetryAt:0,state:null,busy:false,lessons:[],confirmDefault:false,
  navigator:{onLine:true},document:{hidden:false},
  $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:''});return elements.get(id)},
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id),
  timedFetch:()=>new Promise((resolve,reject)=>calls.push({fail:()=>reject(Object.assign(new Error('synthetic transport failure'),{transient:true})),reply:(status=200,session={cloud:true,authenticated:true})=>resolve({response:{status,ok:status>=200&&status<300},session})})),
  connected:value=>connections.push(value),toast:message=>toasts.push(message),clearPrivateUI:()=>{c.state=null},
  request:async()=>{connections.push(true);return position()},setState:next=>{c.state=next},
  reloadLessonCatalog:async()=>{},loadTeachingVideos(){},loadLLMSettings:async()=>{},renderSkillPicker(){},render(){},
  init:async()=>{initializations++},
 });
 vm.runInContext(['transientError','refresh','lockSession','schedulePoll','reportRenderError','resetSessionRecovery','scheduleSessionRetry','checkSession'].map(code).join('\n'),c);
 const runTimer=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();await tick();};
 return {c,timers,calls,connections,toasts,elements,runTimer,initializations:()=>initializations};
}
test('an initial failed session recovers automatically with capped backoff and stops after success',async()=>{
 const h=client(),{c,calls,timers,connections}=h;let pending=c.checkSession();calls[0].reply(503);await pending;
 assert.equal(c.authenticated,false);assert.equal([...timers.values()][0].delay,1000);
 for(const delay of [2000,4000,8000,16000,30000,30000]){await h.runTimer();calls.at(-1).fail();await tick();assert.equal([...timers.values()][0].delay,delay);}
 await h.runTimer();calls.at(-1).reply();await tick();assert.equal(c.authenticated,true);assert.equal(timers.size,0);assert.equal(h.initializations(),1);assert.equal(connections.at(-1),true);
});
test('concurrent session checks share one request and one initialization',async()=>{
 const h=client(),a=h.c.checkSession(),b=h.c.checkSession();assert.equal(h.calls.length,1);h.calls[0].reply();await Promise.all([a,b]);assert.equal(h.initializations(),1);assert.equal(h.c.sessionRequest,null);
});
test('hidden pages neither start nor retry a session until visible again',async()=>{
 const h=client();h.c.document.hidden=true;await h.c.checkSession();assert.equal(h.calls.length,0);
 h.c.document.hidden=false;const pending=h.c.checkSession();h.c.document.hidden=true;h.calls[0].fail();await pending;assert.equal(h.timers.size,0);
 h.c.document.hidden=false;const next=h.c.checkSession();h.calls[1].reply();await next;assert.equal(h.c.authenticated,true);
});
test('a retry queued before hiding performs no hidden-page request',async()=>{
 const h=client(),pending=h.c.checkSession();h.calls[0].fail();await pending;h.c.document.hidden=true;await h.runTimer();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('logout clears recovery and late success cannot revive the old session',async()=>{
 const h=client(),pending=h.c.checkSession();h.c.lockSession();h.calls[0].reply();await pending;assert.equal(h.c.authenticated,false);assert.equal(h.initializations(),0);assert.equal(h.timers.size,0);
 const retry=h.c.checkSession();h.calls[1].fail();await retry;assert.equal(h.timers.size,1);h.c.lockSession();assert.equal(h.timers.size,0);
});
test('an old session result cannot overwrite a newer authenticated epoch',async()=>{
 const h=client(),old=h.c.checkSession();h.c.lockSession();const current=h.c.checkSession();h.calls[1].reply();await current;h.calls[0].reply(200,{cloud:true,authenticated:false});await old;assert.equal(h.c.authenticated,true);assert.equal(h.initializations(),1);
});
test('a successful unauthenticated response and local 404 do not enter recovery loops',async()=>{
 for(const [status,session,authenticated]of [[200,{cloud:true,authenticated:false},false],[404,null,true]]){const h=client(),pending=h.c.checkSession();h.calls[0].reply(status,session);await pending;assert.equal(h.c.authenticated,authenticated);assert.equal(h.timers.size,0);}
 const h=client(),pending=h.c.checkSession();h.calls[0].reply(200,null);await pending;assert.equal(h.c.authenticated,false);assert.equal(h.timers.size,1);
});
test('a render error stays online, is visible, and retries an unchanged revision',async()=>{
 const h=client();h.c.authenticated=true;let renders=0;h.c.setState=next=>{h.c.state=next;if(++renders===1)throw new Error('synthetic renderer error')};
 assert.equal(await h.c.refresh(),false);assert.deepEqual(h.connections,[true]);assert.match(h.toasts[0],/页面显示/);assert.equal(h.c.refresh.renderPending,true);
 assert.equal(await h.c.refresh(),true);assert.equal(renders,2);assert.equal(h.c.refresh.renderPending,false);assert.deepEqual(h.connections,[true,true]);
});
test('an initialization render failure cannot show the login panel or stop state polling',async()=>{
 const h=client();vm.runInContext(code('init'),h.c);h.c.loadLLMSettings=async()=>{throw new Error('synthetic init renderer error')};const pending=h.c.checkSession();h.calls[0].reply();await pending;
 assert.equal(h.c.authenticated,true);assert.equal(h.elements.get('login-panel').hidden,true);assert(!h.connections.includes(false));assert.match(h.toasts[0],/页面显示/);assert.equal([...h.timers.values()][0].delay,12000);
});
