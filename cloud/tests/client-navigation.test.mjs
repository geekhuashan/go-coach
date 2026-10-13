import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const state=(revision=1,id='old')=>({revision,profile:{id:'parent'},board:[[0]],lesson:{id},engine:{},mode:'lesson'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function client(){
 const calls=[],elements=new Map(),toasts=[];
 const c=vm.createContext({AbortController,JSON,Error,Number,Array,Set,Promise,setTimeout,clearTimeout,
 state:state(),authEpoch:0,authenticated:true,navigator:{onLine:true},busy:false,busyAction:null,actionRequest:null,refreshRequest:null,writeRecovery:null,writeRecoveryRequest:null,pendingMove:null,aiAttemptKey:null,aiFailedKey:null,pendingInspectionHelp:new Set(),
 $:id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false});return elements.get(id)},
 document:{body:{setAttribute(){},removeAttribute(){}}},
 fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,reply:(payload,status=200)=>resolve({ok:status===200,status,json:async()=>payload})})),
 connected(){},lockSession(){throw new Error('Unexpected lock')},needsInspectionHelp:()=>false,cancelExplanation(){},renderPending(){},renderActionStatus(){},renderPractice(){},render(){},scheduleComputer(){},scheduleExplanation(){},schedulePoll(){},showView(){},feedbackText:()=>'',computerKey:()=>c.state.lesson.id,
 setState:value=>c.state=value,toast:text=>toasts.push(text),
 });
 vm.runInContext(['transientError','timedFetch','request','refresh','reconcilePendingWrite','canNavigatePractice','navigationAction','act'].map(code).join('\n'),c);
 return {c,calls,toasts};
}
test('next lesson interrupts AI immediately; stale result and finally cannot touch new request',async()=>{
 const {c,calls,toasts}=client();const ai=c.act('ai_move');assert.equal(c.busy,true);assert.equal(c.canNavigatePractice(),true);
 const next=c.act('next_lesson');assert.equal(calls.length,2);assert.equal(calls[0].options.signal.aborted,true);const current=c.actionRequest;
 calls[0].reply(state(2,'old'));await ai;assert.equal(c.actionRequest,current);assert.equal(c.busy,true);assert.equal(c.state.lesson.id,'old');
 calls[1].reply(state(2,'new'));await next;assert.equal(c.state.lesson.id,'new');assert.equal(c.busy,false);assert.deepEqual(toasts,[]);
});
test('navigation retries one revision conflict if the AI just committed, but never repeats a move',async()=>{
 const {c,calls}=client();const next=c.act('next_lesson');calls[0].reply({state:state(2),error:'updated'},409);await tick();assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).revision,2);calls[1].reply(state(3,'new'));await next;
 const move=c.act('play',{x:0,y:0});calls[2].reply({state:state(4,'new')},409);await move;assert.equal(calls.length,3);assert.equal(c.state.revision,4);
});
test('a failed read retries once; a malformed write only syncs and is not replayed',async()=>{
 const {c,calls}=client();const read=c.request('/api/state');calls[0].reply(null,503);await tick();assert.equal(calls.length,2);calls[1].reply(state(2));await read;
 const move=c.act('play',{x:0,y:0});calls[2].reply(null);await tick();assert.equal(calls[3].url,'/api/state');calls[3].reply(state(3));await move;assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
});
test('concurrent refreshes coalesce and a late read cannot replace a newer action',async()=>{
 const {c,calls}=client();const a=c.refresh(),b=c.refresh();assert.equal(calls.length,1);c.setState(state(3,'new'));calls[0].reply(state(2));await Promise.all([a,b]);assert.equal(c.state.lesson.id,'new');assert.equal(c.state.revision,3);
});
test('the timeout remains active until the response body has arrived',async()=>{
 const {c}=client();c.fetch=async(url,options)=>({json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted body'))))});
 await assert.rejects(c.timedFetch('/test',{},10,response=>response.json()),e=>e.kind==='timeout');
});
test('a new login starts its own refresh instead of reusing the previous session',async()=>{
 const {c,calls}=client();const old=c.refresh();c.authEpoch++;c.state=null;const fresh=c.refresh();assert.equal(calls.length,2);
 calls[0].reply(state(1,'old'));await old;calls[1].reply(state(4,'current'));await fresh;assert.equal(c.state.lesson.id,'current');
});

test('an uncertain write blocks new actions until a fresh read and requires a new deliberate click',async()=>{
 const {c,calls,toasts}=client();c.writeRecovery={epoch:0,revision:1};const retry=c.act('play',{x:0,y:0});assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/state');calls[0].reply(state(2,'changed'));await retry;assert.equal(calls.length,1);assert.equal(c.writeRecovery,null);assert.match(toasts.at(-1),/确认当前局面/);
 const deliberate=c.act('play',{x:0,y:0});assert.equal(calls[1].options.method,'POST');assert.equal(JSON.parse(calls[1].options.body).revision,2);calls[1].reply(state(3,'changed'));await deliberate;
});
