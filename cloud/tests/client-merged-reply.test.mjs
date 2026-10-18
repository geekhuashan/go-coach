import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);assert(i>=0);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const position=(extra={})=>({revision:1,profile:{id:'child'},board:[[0,0,0],[0,0,0],[0,0,0]],size:3,to_play:1,move_number:0,mode:'free',match:{id:'game',mode:'human_ai'},engine:{available:true},computer_turn:false,...extra});
function node(tag='div'){
 return {tag,children:[],attrs:{},events:{},dataset:{},hidden:false,textContent:'',checked:false,value:'',classList:{toggle(){}},
  get childElementCount(){return this.children.length},setAttribute(key,value){this.attrs[key]=String(value)},removeAttribute(key){delete this.attrs[key]},
  append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},addEventListener(name,handler){this.events[name]=handler},scrollIntoView(){}};
}
function client(initial=position()){
 const elements=new Map(),calls=[],timers=new Map(),toasts=[];let timerId=0;
 const element=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)};
 const c=vm.createContext({AbortController,JSON,Error,Number,Array,Set,Promise,
  state:initial,authEpoch:0,authenticated:true,navigator:{onLine:true},busy:false,busyAction:null,actionRequest:null,refreshRequest:null,writeRecovery:null,writeRecoveryRequest:null,pendingMove:null,aiAttemptKey:null,aiFailedKey:null,pendingInspectionHelp:new Set(),
  boardFocusKey:null,boardFocusFull:false,boardRenderKey:null,boardZoom:false,inspection:null,selectedPoints:[],cols:'ABCDEFGHJKLMNOPQRST',svgNS:'svg',
  $:element,document:{body:node(),createElementNS:(_,tag)=>node(tag),querySelector:()=>node()},
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id),
  fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,fail:reject,reply:(payload,status=200)=>resolve({ok:status===200,status,json:async()=>payload})})),
  connected(){},lockSession(){throw new Error('Unexpected lock')},needsInspectionHelp:()=>false,inspectionHelpKey:()=>'',cancelExplanation(){},clearInspection(){},
  renderPending(){},renderPractice(){},renderInspectionText(){},scheduleExplanation(){},schedulePoll(){},showView(){},feedbackText:()=>'',toast:text=>toasts.push(text),
 });
 vm.runInContext(['svg','transientError','timedFetch','request','refresh','reconcilePendingWrite','canNavigatePractice','navigationAction','act','renderActionStatus','lessonBoardBounds','renderBoard','computerKey','scheduleComputer'].map(code).join('\n'),c);
 c.render=()=>{c.renderBoard();c.renderActionStatus()};
 c.setState=next=>{c.state=next;c.render();c.scheduleComputer()};
 const runScheduled=async()=>{for(const [id,timer]of [...timers])if(timer.delay===0){timers.delete(id);timer.callback()}await tick()};
 const stones=()=>element('board').children.flatMap(child=>child.children).filter(child=>child.attrs.class==='optimistic-stone');
 return {c,calls,elements,timers,toasts,runScheduled,stones};
}
test('direct and confirmed plays request merged replies with a 22s timeout and immediate optimistic stones',async()=>{
 for(const confirm of [false,true]){
  const h=client(),{c,calls,elements}=h;c.render();c.$('confirm-enabled').checked=confirm;
  const point=elements.get('board').children.find(child=>child.attrs['aria-label']==='B2 空位');point.events.click();
  if(confirm){assert.equal(calls.length,0);assert.equal(h.stones().length,0);vm.runInContext(source.split('\n').find(line=>line.startsWith("$('confirm-move').onclick=")),c);elements.get('confirm-move').onclick();}
  assert.equal(calls.length,1);const payload=JSON.parse(calls[0].options.body);assert.equal(payload.type,'play');assert.equal(payload.reply,true);assert.equal(payload.x,1);assert.equal(payload.y,1);
  assert.ok([...h.timers.values()].some(timer=>timer.delay===22000));assert.equal(h.stones().length,1);assert.equal(h.stones()[0].attrs.opacity,'0.65');assert.equal(c.state.board[1][1],0);
  assert.equal(elements.get('board-action-status').textContent,'电脑思考中…');assert.equal(elements.get('ai-move').hidden,false);assert.equal(elements.get('ai-move').disabled,true);
  calls[0].reply(position({revision:2,board:[[2,0,0],[0,1,0],[0,0,0]],move_number:2}));await tick();assert.equal(c.busy,false);assert.equal(h.stones().length,0);await h.runScheduled();assert.equal(calls.length,1);
 }
});
test('merged reply errors mark the returned computer position and expose retry without automatic ai_move',async()=>{
 const h=client(position({mode:'lesson',lesson:{id:'one'},match:null})),{c,calls,elements}=h,pending=c.act('play',{x:1,y:1});
 assert.equal(elements.get('board-action-status').textContent,'陪练思考中…');
 calls[0].reply(position({revision:2,mode:'lesson',lesson:{id:'one'},match:null,lesson_playout:true,board:[[0,0,0],[0,1,0],[0,0,0]],move_number:1,to_play:2,computer_turn:true,ai_error:'陪练暂时没有完成应手，请重试。'}));await pending;
 assert.equal(c.aiFailedKey,'child:one:2:1:2');assert.equal(h.toasts.at(-1),'陪练暂时没有完成应手，请重试。');assert.equal(h.stones().length,0);await h.runScheduled();assert.equal(calls.length,1);
 const retry=c.act('ai_move');calls[1].reply(position({revision:3,move_number:2}));await retry;assert.equal(c.aiFailedKey,null);
});
test('Python or unmerged play replies retain the existing automatic ai_move fallback',async()=>{
 const h=client(),{c,calls}=h,pending=c.act('play',{x:1,y:1});
 calls[0].reply(position({revision:2,move_number:1,to_play:2,computer_turn:true}));await pending;await h.runScheduled();assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).type,'ai_move');
 calls[1].reply(position({revision:3,move_number:2}));await tick();assert.equal(c.busy,false);
});
test('merged play allows lesson navigation, removes the optimistic stone, and ignores a late reply',async()=>{
 const h=client(position({mode:'lesson',lesson:{id:'old'},match:null})),{c,calls}=h,play=c.act('play',{x:1,y:1});
 assert.equal(c.canNavigatePractice(),true);assert.equal(h.stones().length,1);
 const next=c.act('next_lesson'),operation=c.actionRequest;assert.equal(calls[0].options.signal.aborted,true);assert.equal(h.stones().length,0);
 calls[0].reply(position({revision:2,mode:'lesson',lesson:{id:'old'},match:null,computer_turn:true}));await play;assert.equal(c.actionRequest,operation);assert.equal(c.busy,true);
 calls[1].reply(position({revision:2,mode:'lesson',lesson:{id:'new'},match:null}));await next;await h.runScheduled();assert.equal(c.state.lesson.id,'new');assert.equal(calls.length,2);assert.equal(h.stones().length,0);
});
test('lost merged replies clear the optimistic stone and reconcile without replaying a POST',async()=>{
 const h=client(),{c,calls}=h,pending=c.act('play',{x:1,y:1});assert.equal(h.stones().length,1);
 calls[0].fail(new Error('lost response'));await tick();assert.equal(h.stones().length,0);assert.ok(c.writeRecovery);assert.equal(calls[1].url,'/api/state');
 calls[1].reply(position({revision:2,move_number:2,board:[[2,0,0],[0,1,0],[0,0,0]]}));await pending;await h.runScheduled();assert.equal(c.writeRecovery,null);assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
});
test('rejected merged plays remove the optimistic stone without changing the board',async()=>{
 const h=client(),{c,calls}=h,pending=c.act('play',{x:1,y:1});calls[0].reply({error:'这里不能落子。'},400);await pending;
 assert.equal(h.stones().length,0);assert.equal(c.state.board[1][1],0);assert.equal(c.busy,false);assert.equal(c.writeRecovery,null);
});
