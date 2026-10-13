import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const tokens=(extra={})=>({revision:7,profile_id:'synthetic',catalog_revision:'catalog-a',explanation_revision:'explanation-a',requires_refresh:false,...extra});
const position=(sync=tokens())=>({revision:sync.revision,profile:{id:sync.profile_id},sync,board:[[0]],engine:{},llm_explanation:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function client(){
 const calls=[],renders=[],timers=new Map(),connections=[];let now=100000,id=0;
 const c=vm.createContext({state:position(),authenticated:true,cloudMode:true,authEpoch:0,busy:false,syncRequest:null,syncSupported:null,syncFailures:0,syncRetryAt:0,catalogRevision:'catalog-a',catalogRequest:null,refreshRequest:null,writeRecovery:null,writeRecoveryRequest:null,lessons:[{id:'one'}],pollTimer:null,
 navigator:{onLine:true},document:{hidden:false},Date:{now:()=>now},
 request:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,reply:resolve,fail:reject})),
 setState:next=>{c.state=next;renders.push(next);},renderSkillPicker(){},render(){},reportRenderError:()=>assert.fail('render failed'),connected:value=>connections.push(value),
 setTimeout:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},clearTimeout:key=>timers.delete(key)});
 vm.runInContext(['transientError','refresh','reloadLessonCatalog','reconcilePendingWrite','lightSync','schedulePoll'].map(code).join('\n'),c);
 return {c,calls,renders,connections,timers,advance:ms=>now+=ms};
}
test('unchanged versions make one coalesced cheap probe and no full state/catalog requests',async()=>{
 const {c,calls,renders}=client(),a=c.lightSync(),b=c.lightSync();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/sync');assert.equal(calls[0].options.retryRead,false);calls[0].reply(tokens());assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(calls.length,1);assert.equal(renders.length,0);
});
test('only explanation token changes install the actual full response baseline, then become idle',async()=>{
 const {c,calls}=client(),next=tokens({explanation_revision:'explanation-b'}),pending=c.lightSync();calls[0].reply(next);await tick();assert.equal(calls[1].url,'/api/state');calls[1].reply(position(next));await pending;assert.equal(c.state.sync.explanation_revision,'explanation-b');
 const again=c.lightSync();calls[2].reply(next);await again;assert.equal(calls.length,3);
});
test('catalog changes reload directory and state; a newer full state token cannot conceal an older catalog request',async()=>{
 const {c,calls}=client(),probe=tokens({catalog_revision:'catalog-b'}),latest=tokens({catalog_revision:'catalog-c'}),pending=c.lightSync();calls[0].reply(probe);await tick();assert.equal(calls[1].url,'/api/lessons');calls[1].reply([{id:'new'}]);await tick();assert.equal(calls[2].url,'/api/state');calls[2].reply(position(latest));await pending;
 assert.equal(c.catalogRevision,'catalog-b');assert.equal(c.state.sync.catalog_revision,'catalog-c');assert.equal(c.lessons[0].id,'new');
 const again=c.lightSync();calls[3].reply(latest);await tick();assert.equal(calls[4].url,'/api/lessons');calls[4].reply([{id:'newest'}]);await tick();calls[5].reply(position(latest));await again;assert.equal(c.catalogRevision,'catalog-c');
});
test('revision and profile changes refresh current state; a late probe never overrides a newer action',async()=>{
 const {c,calls}=client(),pending=c.lightSync();calls[0].reply(tokens({revision:8,profile_id:'second'}));await tick();calls[1].reply(position(tokens({revision:8,profile_id:'second'})));await pending;assert.equal(c.state.profile.id,'second');
 const old=c.lightSync();c.state=position(tokens({revision:9,profile_id:'second'}));calls[2].reply(tokens({revision:8,profile_id:'second'}));await old;assert.equal(calls.length,3);assert.equal(c.state.revision,9);
});
test('failed probes preserve board, back off to a cap, and recover without writing',async()=>{
 const h=client(),{c,calls}=h,original=c.state;
 for(const delay of [12000,24000,48000,60000,60000]){const pending=c.lightSync();calls.at(-1).fail(Object.assign(new Error('unavailable'),{transient:true}));await pending;c.schedulePoll();assert.equal([...h.timers.values()][0].delay,delay);const before=calls.length;await c.lightSync();assert.equal(calls.length,before);assert.equal(c.state,original);h.advance(delay);}
 const recovery=c.lightSync();calls.at(-1).reply(tokens());await recovery;assert.equal(c.syncFailures,0);assert.equal(c.syncRetryAt,0);assert.ok(calls.every(call=>call.url==='/api/sync'));
});
test('hidden/offline/busy and old epoch timer perform no background work',async()=>{
 const h=client(),{c,calls}=h;c.document.hidden=true;await c.lightSync();c.document.hidden=false;c.navigator.onLine=false;await c.lightSync();c.navigator.onLine=true;c.busy=true;await c.lightSync();assert.equal(calls.length,0);
 c.busy=false;c.schedulePoll();const timer=[...h.timers.values()][0];c.authEpoch++;await timer.callback();assert.equal(calls.length,0);
});
test('old session catalog and probe replies cannot restore private data or reset new-session backoff',async()=>{
 const {c,calls}=client(),pending=c.lightSync();calls[0].reply(tokens({catalog_revision:'catalog-b'}));await tick();assert.equal(calls[1].url,'/api/lessons');c.authEpoch++;c.lessons=[];c.catalogRevision=null;c.syncFailures=4;c.syncRetryAt=123456;calls[1].reply([{id:'old-private'}]);await pending;assert.equal(c.lessons.length,0);assert.equal(c.catalogRevision,null);assert.equal(c.syncFailures,4);assert.equal(c.syncRetryAt,123456);
});
test('404 sync and local Python installations fall back to full reads without repeated probes',async()=>{
 const {c,calls}=client(),pending=c.lightSync();calls[0].fail(Object.assign(new Error('missing'),{status:404}));await tick();assert.equal(calls[1].url,'/api/state');calls[1].reply(position());await pending;assert.equal(c.syncSupported,false);
 const again=c.lightSync();assert.equal(calls[2].url,'/api/state');calls[2].reply(position());await again;
 const local=client();local.c.cloudMode=false;const read=local.c.lightSync();assert.equal(local.calls[0].url,'/api/state');local.calls[0].reply(position());await read;
});
test('incomplete server migration requires refresh even when version tokens match',async()=>{
 const {c,calls}=client(),pending=c.lightSync();calls[0].reply(tokens({requires_refresh:true}));await tick();assert.equal(calls[1].url,'/api/state');calls[1].reply(position());await pending;
});
test('reconciliation never trusts an earlier in-flight read and makes no POST',async()=>{
 const {c,calls}=client(),old=c.refresh();c.writeRecovery={revision:7};const pending=c.reconcilePendingWrite();calls[0].reply(position());await old;await tick();assert.equal(calls.length,2);assert.ok(c.writeRecovery);calls[1].reply(position(tokens({revision:8})));assert.equal(await pending,true);assert.equal(c.writeRecovery,null);assert.equal(c.state.revision,8);assert.ok(calls.every(call=>call.url==='/api/state'));
});
test('unsuccessful reconciliation retains the marker; later polling reads state before proceeding',async()=>{
 const {c,calls}=client();c.writeRecovery={revision:7};const pending=c.reconcilePendingWrite();calls[0].fail(Object.assign(new Error('unavailable'),{transient:true}));assert.equal(await pending,false);assert.ok(c.writeRecovery);
 const retry=c.lightSync();assert.equal(calls[1].url,'/api/state');calls[1].reply(position(tokens({revision:8})));await retry;assert.equal(c.writeRecovery,null);
});
test('initial missing catalog automatically recovers on local fallback',async()=>{
 const {c,calls}=client();c.cloudMode=false;c.lessons=[];const pending=c.lightSync();calls[0].reply(position());await tick();assert.equal(calls[1].url,'/api/lessons');calls[1].reply([{id:'restored'}]);await pending;assert.equal(c.lessons[0].id,'restored');
});

test('catalog downloaded before failed state read still refreshes state on the next probe',async()=>{
 const h=client(),{c,calls}=h,updated=tokens({catalog_revision:'catalog-b'}),pending=c.lightSync();calls[0].reply(updated);await tick();calls[1].reply([{id:'new'}]);await tick();calls[2].fail(Object.assign(new Error('failed full state'),{transient:true}));await pending;assert.equal(c.catalogRevision,'catalog-b');assert.equal(c.state.sync.catalog_revision,'catalog-a');
 h.advance(12000);const retry=c.lightSync();calls[3].reply(updated);await tick();assert.equal(calls[4].url,'/api/state');calls[4].reply(position(updated));await retry;assert.equal(c.state.sync.catalog_revision,'catalog-b');
});
