import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped browser functions; only DOM, timers and transport are faked.
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
function functionSource(name){
 const index=declarations.findIndex(match=>match[1]===name);
 assert.notEqual(index,-1,`Missing browser function ${name}`);
 return source.slice(declarations[index].index,declarations[index+1]?.index??source.length);
}
const functions=['transientError','timedFetch','request','setState','explanationContext','cancelExplanation','scheduleExplanation','explainCurrent'];
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const position=(revision=10,context='position-a')=>({revision,context_key:context,profile:{id:'learner-test'},lesson:{id:'lesson-test'},mode:'lesson',lesson_attempted:true,move_number:1,board:[[1,0],[0,2]],assessment:{summary:'测试反馈'}});

function client({ignoreAbort=false}={}){
 const timers=new Map(),elements=new Map(),calls=[],connections=[];
 let timerId=0;
 const context=vm.createContext({
  AbortController,Set,JSON,Error,
  state:position(),authEpoch:0,llmSettings:{enabled:true},llmBusy:false,llmRequest:null,llmAutoTimer:null,llmAutoSeen:new Set(),llmResult:null,llmError:null,
  busy:false,inspection:null,pendingMove:null,pendingInspectionHelp:new Set(),lessons:[],selectedMode:'lesson',selectionPending:false,
  $:id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false});return elements.get(id);},
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
  clearTimeout:id=>timers.delete(id),
  fetch:(url,options)=>new Promise((resolve,reject)=>{
   const call={url,options,resolve:result=>resolve({ok:true,status:200,json:async()=>result}),reject};calls.push(call);
   if(!ignoreAbort){const abort=()=>reject(new Error('Aborted transport'));if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});}
  }),
  connected:value=>connections.push(value),
  lockSession:()=>assert.fail('Unexpected session lock'),refresh:()=>assert.fail('Unexpected state refresh'),
  render:()=>{},renderLLM:()=>{},renderLessonPicker:()=>{},scheduleComputer:()=>{},
  inspectionViewKey:value=>JSON.stringify([value.profile?.id,value.board]),inspectionHelpKey:value=>value.profile?.id,
  storePendingInspectionHelp:()=>{},feedbackText:()=>'',
 });
 vm.runInContext(functions.map(functionSource).join('\n'),context,{filename:'static/app.js (extracted functions)'});
 const runAutomatic=async()=>{
  for(const [id,timer]of [...timers])if(timer.delay===250){timers.delete(id);timer.callback();}
  await nextTurn();
 };
 const reply=(index,text='当前讲解')=>{const payload=JSON.parse(calls[index].options.body);calls[index].resolve({revision:payload.revision,profile_id:payload.expected_profile_id,text});};
 return {context,calls,connections,timers,runAutomatic,reply};
}

test('a changed position cancels a hanging manual explanation without requesting another',async()=>{
 const {context:c,calls,runAutomatic}=client();const previous=c.explainCurrent('');c.setState(position(11,'position-b'));
 assert.equal(calls[0].options.signal.aborted,true);await previous;await runAutomatic();assert.equal(calls.length,1);assert.equal(c.llmBusy,false);assert.equal(c.llmError,null);
});
test('an old response and finally cannot overwrite or release a newer manual explanation',async()=>{
 const {context:c,calls,reply}=client({ignoreAbort:true});const previous=c.explainCurrent('');c.setState(position(11,'position-b'));const current=c.explainCurrent('现在这一手');const currentRequest=c.llmRequest;
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).trigger,'manual');reply(0,'已经过期的讲解');await previous;assert.equal(c.llmRequest,currentRequest);assert.equal(c.llmBusy,true);assert.equal(c.llmResult,null);assert.equal(c.llmError,null);reply(1,'当前讲解');await current;assert.equal(c.llmBusy,false);assert.equal(c.llmResult.text,'当前讲解');
});
test('completion, review evidence and repeated scheduling never send an automatic explanation',async()=>{
 const {context:c,calls,runAutomatic,timers}=client();c.scheduleExplanation();c.setState({...position(11,'reviewed'),assessment:{summary:'已复核',review:{explanation:'新增复核证据'}}});c.scheduleExplanation();await runAutomatic();assert.equal(calls.length,0);assert.equal(timers.size,0);
 assert.equal((source.match(/scheduleExplanation\(\)/g)||[]).length,1,'no automatic call sites remain');
});
test('caller cancellation is distinct from a network failure and clears its timeout',async()=>{
 const {context:c,timers,connections}=client();const controller=new AbortController();const pending=c.timedFetch('/api/llm/explain',{signal:controller.signal},45000);controller.abort();await assert.rejects(pending,error=>error.cancelled===true&&!error.transient&&!error.kind);assert.equal(timers.size,0);assert.deepEqual(connections,[]);
});
test('manual empty question requests once, retains saved result, and does not schedule a follow-up',async()=>{
 const {context:c,calls,runAutomatic,reply,timers}=client();const pending=c.explainCurrent('');assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].options.body).trigger,'manual');reply(0,'手动讲解');await pending;await runAutomatic();assert.equal(calls.length,1);assert.equal(c.llmResult.text,'手动讲解');assert.equal(c.llmBusy,false);assert.equal(timers.size,0);
});
