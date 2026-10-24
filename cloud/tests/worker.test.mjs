import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{contextKey} from '../worker.mjs';
import {makeSession,digest} from '../auth.mjs';
import {lessonState,blank,applyAction} from '../game.mjs';
import {key,play} from '../rules.mjs';
const lessons=JSON.parse(readFileSync(new URL('../builtin-lessons.json',import.meta.url)));
function legalPoint(state){const seen=[key(state.board),...(state.history||[]).map(h=>key(h.board))];for(let y=0;y<state.size;y++)for(let x=0;x<state.size;x++)try{play(state.board,x,y,state.to_play,seen);return {x,y};}catch{}throw new Error('no legal point');}
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0001_family.sql','0002_statistics.sql'])this.db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));}
 prepare(sql){
  const db=this.db;
  function statement(args){return {
   async first(){return db.prepare(sql).get(...args)||null},
   async all(){return {results:db.prepare(sql).all(...args)}},
   async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}}},
   _execute(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}}}
  };}
  return {bind(...args){return statement(args)},...statement([])};
 }
 async batch(statements){this.db.exec('BEGIN');try{const results=statements.map(s=>s._execute());this.db.exec('COMMIT');return results}catch(e){this.db.exec('ROLLBACK');throw e}}
}
async function session(){const env={DB:new D1(),HOUSEHOLD_ID:'test-home',SESSION_SECRET:'test-only-secret-longer-than-thirty-two-characters',FAMILY_PASSWORD_HASH:await digest('NOT_A_REAL_PASSWORD')};const cookie='go_session='+await makeSession(env);async function request(path,method='GET',data,extra=''){const headers={Cookie:cookie+(extra?'; '+extra:''),Origin:'https://go.example'};if(data!==undefined){headers['Content-Type']='application/json';data={expected_profile_id:extra.includes('go_profile=child')?'child':'parent',...data};}const r=await worker.fetch(new Request('https://go.example'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);let body;try{body=await r.json()}catch{}return {status:r.status,body,response:r};}return {env,request};}
test('D1 CAS rejects concurrent stale moves without duplicate attempt or XP',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;assert.equal(s.profile.id,'parent');
 const action={type:'play',x:2,y:4,revision:s.revision};const results=await Promise.all([request('/api/action','POST',action),request('/api/action','POST',action)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);s=(await request('/api/state')).body;assert.equal(s.recent_attempts.length,1);assert.equal(s.rating.practice_xp,10);
 const replay=await request('/api/action','POST',{type:'retry',revision:s.revision});s=replay.body;s=(await request('/api/action','POST',{...action,revision:s.revision})).body;assert.equal(s.rating.practice_xp,10);assert.equal(s.recent_attempts.length,2);
});
test('profile cookie isolates devices and auth never exposes trees',async()=>{
 const {request,env}=await session();const s=(await request('/api/state')).body;const switched=await request('/api/action','POST',{type:'switch_profile',profile_id:'child',revision:s.revision});assert.equal(switched.body.profile.id,'child');assert.equal((await request('/api/state')).body.profile.id,'parent');assert.equal((await request('/api/state','GET',undefined,'go_profile=child')).body.profile.id,'child');assert.equal(s.lesson.tree,undefined);const unauthorized=await worker.fetch(new Request('https://go.example/api/state'),env);assert.equal(unauthorized.status,401);
});
test('LLM settings reject stale client revision and encrypt stored key',async()=>{
 const {request,env}=await session();let s=(await request('/api/state')).body;s=(await request('/api/action','POST',{type:'hint',revision:s.revision})).body;
 let response=await request('/api/llm/settings','POST',{revision:0,base_url:'https://model.example/v1',model:'example',api_key:'NOT_A_REAL_KEY',enabled:true});assert.equal(response.status,409);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM llm_settings').get().n,0);
 response=await request('/api/llm/settings','POST',{revision:s.revision,base_url:'https://model.example/v1',model:'example',api_key:'NOT_A_REAL_KEY',enabled:true});assert.equal(response.status,200);assert.equal(response.body.has_api_key,true);assert.equal(response.body.api_key,undefined);const row=env.DB.db.prepare('SELECT * FROM llm_settings').get();assert.ok(!JSON.stringify(row).includes('NOT_A_REAL_KEY'));
});
test('atomic login budget admits only remaining slot under concurrency',async()=>{
 const {request,env}=await session();for(let i=0;i<11;i++)assert.equal((await request('/api/login','POST',{password:'wrong'})).status,401);
 const results=await Promise.all(Array.from({length:3},()=>request('/api/login','POST',{password:'wrong'})));assert.deepEqual(results.map(r=>r.status).sort(),[401,429,429]);
});
test('confirmed result increments separated 19-road stats once; resume cannot award twice',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;s=(await request('/api/action','POST',{type:'new',match_mode:'two_player',size:19,black_profile_id:'parent',white_profile_id:'child',revision:s.revision})).body;s=(await request('/api/action','POST',{type:'resign',revision:s.revision})).body;const match=s.match.id;assert.equal(s.rating.matches_played,1);assert.equal(s.rating.losses,1);assert.equal(s.rating.by_size[0].size,19);s=(await request('/api/action','POST',{type:'resume_match',match_id:match,revision:s.revision})).body;assert.equal(s.rating.matches_played,1);assert.equal(s.rating.by_size[0].rated_games,1);assert.equal((await request('/api/action','POST',{type:'resign',revision:s.revision})).status,400);
});
test('migration writes records atomically and refuses nonempty cloud overwrite',async()=>{
 const {request}=await session();const s=(await request('/api/state')).body;const state=lessonState(lessons.find(l=>l.id==='escape'));state.lesson_playout=true;const local={schema:2,active_profile_id:'parent',profiles:{parent:{id:'parent',name:'我',state,attempts:[{lesson_id:'capture-1-1',correct:true,assisted:false,attempt_no:1}],notes:[{text:'自己的学习想法'}],helped_lesson_ids:[]},child:{id:'child',name:'测试孩子',state,attempts:[],notes:[]}},matches:{}};
 const migrated=await request('/api/migrate','POST',{revision:s.revision,store:local});assert.equal(migrated.status,200,JSON.stringify(migrated.body));assert.equal(migrated.body.attempts_count,1);const after=(await request('/api/state')).body;assert.equal(after.profiles.find(p=>p.id==='child').name,'测试孩子');assert.equal(after.recent_attempts.length,1);const denied=await request('/api/migrate','POST',{revision:after.revision,store:local});assert.equal(denied.status,409);
 assert.equal(after.lesson_playout,false);assert.equal(after.computer_turn,false);
});

test('a stale tab cannot write into the profile selected by another tab',async()=>{
 const {request}=await session();const original=(await request('/api/state')).body;
 const changed=await request('/api/action','POST',{type:'switch_profile',profile_id:'child',revision:original.revision});assert.equal(changed.status,200);
 for(const path of ['/api/action','/api/llm/explain']){const result=await request(path,'POST',{type:'feedback',trigger:'manual',text:'belongs to parent',expected_profile_id:'parent',revision:original.revision},'go_profile=child');assert.equal(result.status,409);}
 assert.equal((await request('/api/history','GET',undefined,'go_profile=child')).body.notes.length,0);
});
test('migration includes shared matches and compact history without SQL partial writes',async()=>{
 const {request}=await session();const start=(await request('/api/state')).body;
 const profiles=[{id:'parent',name:'我'},{id:'child',name:'宝宝'}];
 const context={profileId:'parent',profiles,catalog:lessons,helped:[],runs:{}};
 let state=applyAction(blank(19),{type:'new',size:19,match_mode:'two_player'},context).state;
 state=applyAction(state,{type:'play',x:18,y:18},context).state;
 const store={schema:2,active_profile_id:'parent',profiles:Object.fromEntries(profiles.map(p=>[p.id,{...p,state,attempts:[],notes:[]}])) ,matches:{[state.match.id]:{id:state.match.id,state,updated_at:'2026-09-07T12:00:00Z'}}};
 const result=await request('/api/migrate','POST',{revision:start.revision,store});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.matches_count,1);
 const parent=(await request('/api/state')).body,child=(await request('/api/state','GET',undefined,'go_profile=child')).body;assert.equal(parent.size,19);assert.equal(child.board[18][18],1);assert.equal(child.recent_matches.length,1);
});
test('failed fast channel produces one persisted fnOS move with its actual backend',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_PRIMARY_URL:'https://fnos.example',ENGINE_PRIMARY_TOKEN:'primary',ENGINE_URL:'https://vps.example',ENGINE_TOKEN:'fallback'});let s=(await request('/api/state')).body;assert.equal(s.engine.primary_configured,true);assert.equal(s.engine.last_backend,null);s=(await request('/api/action','POST',{type:'new',match_mode:'human_ai',human_color:2,size:19,revision:s.revision})).body;
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));if(String(url).includes('vps'))return new Response('{}',{status:503});return new Response(JSON.stringify({x:15,y:3}));});
 const response=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(response.status,200);s=response.body;assert.equal(s.move_number,1);assert.equal(s.engine_backend,'fnos');assert.equal(s.engine.last_backend,'fnos');assert.match(s.engine.status,/最近一次/);assert.equal(calls.filter(x=>x.endsWith('/move')).length,2);assert.equal(s.moves.length,1);
});
test('a wrong practice answer drives repeated KataGo moves without duplicate attempts',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let s=(await request('/api/state')).body;
 const payloads=[],replies=[{x:1,y:0},{x:3,y:0}];t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(String(url),'https://engine.example/move');const payload=JSON.parse(init.body).state;payloads.push(payload);return new Response(JSON.stringify(replies.shift()));});
 s=(await request('/api/action','POST',{type:'play',x:0,y:0,revision:s.revision})).body;assert.equal(s.lesson_playout,true);assert.equal(s.computer_turn,true);assert.equal(s.recent_attempts.length,1);assert.equal(s.recent_attempts[0].correct,false);
 let r=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(r.status,200,JSON.stringify(r.body));s=r.body;assert.equal(s.move_number,2);assert.equal(s.computer_turn,false);assert.equal(s.lesson_progress.status,'exploring');
 s=(await request('/api/action','POST',{type:'play',x:2,y:0,revision:s.revision})).body;assert.equal(s.computer_turn,true);assert.equal(s.recent_attempts.length,1);
 r=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(r.status,200,JSON.stringify(r.body));s=r.body;assert.equal(s.move_number,4);assert.equal(s.computer_turn,false);assert.equal(s.recent_attempts.length,1);assert.deepEqual(payloads.map(p=>p.moves.length),[1,3]);
});
test('an off-answer sequence replies first and only reviews on explicit request',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-01',revision:s.revision})).body;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{const path=new URL(url).pathname,payload=JSON.parse(init.body).state;calls.push(path);if(path==='/move')return new Response(JSON.stringify(legalPoint(payload)));const coords='ABCDEFGHJKLMNOPQRSTUVWXYZ',item=point=>{const move=coords[point.x]+(payload.size-point.y);return {move,rootInfo:{scoreLead:1,visits:64},moves:[{move,pv:[move]}],ownership:Array(payload.size*payload.size).fill(0)};};return new Response(JSON.stringify({revision:payload.revision,perspective:'black',candidate:item(payload.review.candidate),reference:item(payload.review.reference)}));});
 s=(await request('/api/action','POST',{type:'play',x:0,y:0,revision:s.revision})).body;assert.deepEqual(calls,[]);assert.equal(s.assessment.review.source,'deferred');assert.equal(s.assessment.correct,null);assert.equal(s.recent_attempts.length,0);assert.equal(s.rating.practice_xp,0);assert.equal(s.lesson_playout,true);assert.equal(s.computer_turn,true);
 s=(await request('/api/action','POST',{type:'ai_move',revision:s.revision})).body;assert.deepEqual(calls,['/move']);assert.equal(s.computer_turn,false);
 s=(await request('/api/action','POST',{type:'play',...legalPoint(s),revision:s.revision})).body;assert.deepEqual(calls,['/move']);assert.equal(s.computer_turn,true);
 s=(await request('/api/action','POST',{type:'ai_move',revision:s.revision})).body;assert.deepEqual(calls,['/move','/move']);assert.equal(s.recent_attempts.length,0);
});
test('legacy answered state without a verdict is not guessed to be a playout',async()=>{
 const {request,env}=await session();await request('/api/state');const legacy=lessonState(lessons.find(l=>l.id==='escape-1-1'));legacy.lesson_attempted=true;legacy.assessment=null;delete legacy.lesson_playout;
 env.DB.db.prepare("UPDATE profiles SET state_json=? WHERE household_id='test-home' AND id='parent'").run(JSON.stringify(legacy));
 const state=(await request('/api/state')).body;assert.equal(state.lesson_playout,false);assert.equal(state.computer_turn,false);assert.equal(state.lesson_attempted,true);
});
test('legacy D1 history cannot retain playout after undo',async()=>{
 const {request,env}=await session();await request('/api/state');let legacy=applyAction(lessonState(lessons.find(l=>l.id==='escape-1-1')),{type:'play',x:0,y:0},{profileId:'parent',profiles:[],catalog:lessons,helped:[],runs:{}}).state;delete legacy.history[0].lesson_playout;
 env.DB.db.prepare("UPDATE profiles SET state_json=? WHERE household_id='test-home' AND id='parent'").run(JSON.stringify(legacy));let s=(await request('/api/state')).body;assert.equal(s.lesson_playout,true);
 s=(await request('/api/action','POST',{type:'undo',revision:s.revision})).body;assert.equal(s.lesson_playout,false);assert.equal(s.lesson_attempted,false);assert.equal(s.computer_turn,false);assert.equal(s.move_number,0);
});
test('state remains unchanged if both engines fail and late primary output loses CAS',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_PRIMARY_URL:'https://fnos.example',ENGINE_PRIMARY_TOKEN:'primary',ENGINE_URL:'https://vps.example',ENGINE_TOKEN:'fallback'});let s=(await request('/api/state')).body;s=(await request('/api/action','POST',{type:'new',match_mode:'human_ai',human_color:2,size:19,revision:s.revision})).body;
 t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:503}));assert.equal((await request('/api/action','POST',{type:'ai_move',revision:s.revision})).status,503);let latest=(await request('/api/state')).body;assert.equal(latest.revision,s.revision);assert.equal(latest.move_number,0);t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(init.method==='GET')return new Response(JSON.stringify({ok:true,available:true}));const changed=await request('/api/action','POST',{type:'inspect',x:0,y:0,revision:s.revision});assert.equal(changed.status,200);return new Response(JSON.stringify({x:3,y:3}));});const lost=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(lost.status,409);latest=(await request('/api/state')).body;assert.equal(latest.move_number,0);assert.equal(latest.engine_backend,undefined);
});
test('LLM test uses manual redirects and rejects a 302 without forwarding its key',async t=>{
 const {request}=await session();const s=(await request('/api/state')).body;const saved=await request('/api/llm/settings','POST',{revision:s.revision,base_url:'https://model.example/v1',model:'example',api_key:'EXAMPLE_ONLY',enabled:true});assert.equal(saved.status,200);
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),authorization:init.headers.Authorization});assert.equal(init.redirect,'manual');assert.equal(JSON.stringify(JSON.parse(init.body)).includes('board'),false);return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});});
 const result=await request('/api/llm/test','POST',{});assert.equal(result.status,503);assert.deepEqual(calls,[{url:'https://model.example/v1/chat/completions',authorization:'Bearer EXAMPLE_ONLY'}]);assert.ok(!JSON.stringify(result.body).includes('EXAMPLE_ONLY'));
});
test('MiniMax M3.1 gets low thinking effort with room to think, and the teacher sees the problem',async t=>{
 const {request}=await session();let s=(await request('/api/state')).body;const saved=await request('/api/llm/settings','POST',{revision:s.revision,base_url:'https://model.example/v1',model:'MiniMax-M3.1-Flash',api_key:'EXAMPLE_ONLY',enabled:true});assert.equal(saved.status,200);
 const bodies=[];t.mock.method(globalThis,'fetch',async(url,init)=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{message:{content:'<think>先想一想</think>连接成功。',reasoning_content:'先想一想'}}]}));});
 assert.equal((await request('/api/llm/test','POST',{})).status,200);
 assert.equal(bodies[0].reasoning_effort,'low');assert.equal(bodies[0].reasoning_split,true);assert.equal(bodies[0].max_tokens,undefined);assert.ok(bodies[0].max_completion_tokens>2000);
 s=(await request('/api/state')).body;s=(await request('/api/action','POST',{type:'lesson',id:'escape-1-1',revision:s.revision})).body;
 const explained=await request('/api/llm/explain','POST',{revision:s.revision,expected_profile_id:'parent',trigger:'manual',question:''});assert.equal(explained.status,200,JSON.stringify(explained.body));assert.equal(explained.body.text,'连接成功。');
 const payload=JSON.parse(bodies[1].messages[1].content);assert.equal(payload.lesson.prompt,lessons.find(l=>l.id==='escape-1-1').prompt);assert.equal(payload.checked_explanation,undefined,'no answer before the problem is tried');
});
test('practice preference persists per profile, assisted completion clears review and sequential advances',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;
 const act=async a=>{const r=await request('/api/action','POST',{...a,revision:s.revision});assert.equal(r.status,200,JSON.stringify(r.body));s=r.body;return s;};
 await act({type:'lesson',id:'escape-1-1'});await act({type:'hint'});await act({type:'practice_mode',mode:'review'});assert.equal(s.lesson.id,'escape-1-1');assert.equal(s.practice_progress.review_count,1);
 await act({type:'play',x:2,y:4});assert.equal(s.recent_attempts[0].correct,true);assert.equal(s.rating.practice_xp,0);assert.equal(s.practice_progress.completed,1);assert.equal(s.practice_progress.review_count,0);
 await act({type:'next_lesson'});assert.match(s.message,/没有待复习/);await act({type:'practice_mode',mode:'sequential'});const first=s.practice_progress.current_index;
 await act({type:'next_lesson'});assert.ok(s.practice_progress.current_index>first);assert.equal((await request('/api/state')).body.practice_mode,'sequential');assert.equal((await request('/api/state','GET',undefined,'go_profile=child')).body.practice_mode,'recommended');
});
test('fresh profiles start in visible first variant while hidden historical lessons remain readable',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;assert.equal(s.lesson.id,'escape-1-1');assert.equal((await request('/api/lessons')).body.length,492);
 s=(await request('/api/action','POST',{type:'practice_mode',mode:'sequential',revision:s.revision})).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'escape-1-8',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-1-8');
 s=(await request('/api/action','POST',{type:'next_lesson',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-2-1');
 s=(await request('/api/action','POST',{type:'add_profile',name:'新学习者',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-1-1');
});
test('exact author refutation grades once without asking KataGo or awarding XP',async t=>{
 const {request,env}=await session();let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-68',revision:s.revision})).body;
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('author proof must not call the engine')});
 const response=await request('/api/action','POST',{type:'play',x:15,y:18,revision:s.revision});assert.equal(response.status,200);s=response.body;
 assert.equal(s.assessment.review.source,'author');assert.equal(s.assessment.correct,false);assert.equal(s.lesson_progress.status,'failed');assert.equal(s.recent_attempts.length,1);assert.equal(s.rating.practice_xp,0);
 t.mock.restoreAll();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(new URL(url).pathname);return new Response(JSON.stringify(legalPoint(s)));});s=(await request('/api/action','POST',{type:'ai_move',revision:s.revision})).body;assert.deepEqual(calls,['/move']);assert.equal(s.computer_turn,false);
 assert.equal((await request('/api/action','POST',{type:'review_move',revision:s.revision})).status,400);assert.equal((await request('/api/state')).body.recent_attempts.length,1);
});
test('unlisted move survives an outage, retries compute evidence, and stale reviews cannot write',async t=>{
 const {request,env}=await session();let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-01',revision:s.revision})).body;
 let r=await request('/api/action','POST',{type:'play',x:0,y:0,revision:s.revision});assert.equal(r.status,200);s=r.body;
 assert.equal(s.board[0][0],1);assert.equal(s.assessment.review.source,'deferred');assert.equal(s.recent_attempts.length,0);
 r=await request('/api/action','POST',{type:'review_move',revision:s.revision});assert.equal(r.status,200);s=r.body;assert.equal(s.assessment.review.source,'unavailable');assert.equal(s.assessment.correct,null);assert.equal(s.recent_attempts.length,0);assert.equal(s.rating.practice_xp,0);assert.equal(s.board[0][0],1);assert.equal(s.computer_turn,true);
 Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let stale=false;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(String(url),'https://engine.example/review');const p=JSON.parse(init.body).state;assert.equal(p.board[0][0],0);assert.equal(p.moves.length,0);assert.equal(p.lesson,undefined);assert.ok(p.review);
  const coords='ABCDEFGHJKLMNOPQRSTUVWXYZ',item=point=>{const move=coords[point.x]+(p.size-point.y);return {move,rootInfo:{scoreLead:1,visits:64},moves:[{move,pv:[move]}],ownership:Array(p.size*p.size).fill(0)};};
  if(stale)env.DB.db.prepare('UPDATE households SET revision=revision+1').run();
  return new Response(JSON.stringify({revision:p.revision,perspective:'black',candidate:item(p.review.candidate),reference:item(p.review.reference)}));
 });
 r=await request('/api/action','POST',{type:'review_move',revision:s.revision});assert.equal(r.status,200);s=r.body;assert.equal(s.assessment.review.verdict,'reasonable');assert.equal(s.assessment.correct,null);assert.equal(s.recent_attempts.length,0);assert.equal(s.rating.practice_xp,0);
 const saved=env.DB.db.prepare("SELECT state_json FROM profiles WHERE id='parent'").get().state_json;stale=true;r=await request('/api/action','POST',{type:'review_move',revision:s.revision});assert.equal(r.status,409);assert.equal(env.DB.db.prepare("SELECT state_json FROM profiles WHERE id='parent'").get().state_json,saved);
});
test('new review evidence invalidates an older LLM explanation on the same board',async()=>{
 const s=blank(19),original=await contextKey(s);s.assessment={review:{source:'unavailable',verdict:'uncertain'}};const pending=await contextKey(s);s.assessment.review={source:'katago',verdict:'mistake',evidence:{score_loss:5}};
 assert.notEqual(await contextKey(s),pending);assert.notEqual(pending,original);
});

test('private book batch import is atomic, scoped and leaves current practice unchanged',async()=>{
 const {request,env}=await session();const before=(await request('/api/state')).body;
 const book=id=>({id,title:'私用书题',prompt:'黑先',hint:'观察气',size:9,skill:'tsumego',sequence:true,difficulty:3,to_play:1,stones:[{x:0,y:0,color:2},{x:1,y:0,color:1}],objective:{kind:'authored_solution'},source:{kind:'book',title:'格式验证用书',page:'1',problem:id,usage:'household_private',answer_verified:true},tree:{children:[{move:[0,1],explanation:'提子',result:'success',author_verdict:'correct',children:[]}]}});
 const first=await request('/api/lessons/import','POST',{revision:before.revision,lessons:[book('private-1'),book('private-2')]});
 assert.equal(first.status,200);assert.equal(first.body.imported,2);assert.ok(first.body.lessons.every(l=>l.tree===undefined));
 const after=(await request('/api/state')).body;assert.deepEqual(after.board,before.board);assert.equal(after.lesson.id,before.lesson.id);assert.equal(after.rating.practice_xp,before.rating.practice_xp);
 const catalog=(await request('/api/lessons')).body;assert.equal(catalog.filter(l=>l.source?.usage==='household_private').length,2);assert.ok(catalog.every(l=>l.tree===undefined));
 for(const incoming of [[book('private-3'),book('private-1')],[book('private-3'),book('private-3')],[book('private-3'),{...book('private-4'),source:{kind:'book'}}],[],Array.from({length:65},(_,i)=>book('limit-'+i))]){
  assert.equal((await request('/api/lessons/import','POST',{revision:after.revision,lessons:incoming})).status,400);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n,2);
 }
 const otherEnv={...env,HOUSEHOLD_ID:'other-household'},cookie='go_session='+await makeSession(otherEnv);
 const response=await worker.fetch(new Request('https://go.example/api/lessons',{headers:{Cookie:cookie}}),otherEnv);
 assert.equal(response.status,200);assert.equal((await response.json()).some(l=>l.id==='private-1'),false);
 assert.equal((await request('/api/lessons/import','POST',{revision:before.revision,lessons:[book('stale')]})).status,409);
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n,2);
});

test('moving to another lesson while AI is calculating wins; old AI cannot overwrite it',async t=>{
 const {request,env}=await session();env.ENGINE_URL='https://engine.example';env.ENGINE_TOKEN='unit-only';let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'play',x:0,y:0,revision:s.revision})).body;
 let reply;const started=new Promise(resolve=>t.mock.method(globalThis,'fetch',()=>new Promise(r=>{reply=r;resolve();})));
 const ai=request('/api/action','POST',{type:'ai_move',revision:s.revision});await started;
 const next=await request('/api/action','POST',{type:'lesson',id:'capture-1-1',revision:s.revision});assert.equal(next.status,200);
 reply(new Response(JSON.stringify({x:1,y:0})));assert.equal((await ai).status,409);
 const final=(await request('/api/state')).body;assert.equal(final.lesson.id,'capture-1-1');assert.equal(final.move_number,0);
});
test('historical pattern input is participant-only and contains no answers, scores or writes',async()=>{
 const {request,env}=await session();let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'new',match_mode:'human_ai',human_color:1,revision:s.revision})).body;
 const id=s.match.id,revision=s.revision;
 const result=await request('/api/match-patterns?match_id='+id);assert.equal(result.status,200);assert.equal(result.body.profile_id,'parent');
 assert.deepEqual(Object.keys(result.body.state).sort(),['initial_board','initial_player','match','match_id','mode','moves','size']);
 assert.equal((await request('/api/match-patterns?match_id='+id,'GET',undefined,'go_profile=child')).status,404);
 assert.equal((await request('/api/state')).body.revision,revision);
 assert.equal((await worker.fetch(new Request('https://go.example/api/match-patterns?match_id='+id),env)).status,401);
});
test('catalog cache sees same-size imports updated elsewhere and keeps households isolated',async()=>{
 const {request,env}=await session();await request('/api/state');const value={...lessons.find(l=>l.id==='capture-1-1'),id:'cached-test',title:'before'};
 env.DB.db.prepare('INSERT INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run('test-home',value.id,JSON.stringify(value));
 assert.equal((await request('/api/lessons')).body.find(l=>l.id===value.id).title,'before');
 value.title='after';env.DB.db.prepare('UPDATE lessons SET lesson_json=? WHERE household_id=? AND id=?').run(JSON.stringify(value),'test-home',value.id);
 assert.equal((await request('/api/lessons')).body.find(l=>l.id===value.id).title,'after');
 const other=await session();assert.equal((await other.request('/api/lessons')).body.some(l=>l.id===value.id),false);
});
test('choice-answer import, redaction, exact grading, retries and first-attempt XP use the existing worker contract',async()=>{
 const {env,request}=await session();let state=(await request('/api/state')).body;
 const make=(id,answer='0')=>({id,title:'判断测试',prompt:'选择一个答案。',hint:'观察棋形。',size:9,skill:'life',sequence:false,difficulty:1,to_play:1,stones:[{x:3,y:3,color:1}],choices:[{id:'0',label:'0'},{id:'1',label:'1'},{id:'2',label:'2'},{id:'3',label:'3'}],objective:{kind:'choose_answer',answer},source:{kind:'book',usage:'household_private',answer_verified:true,title:'合成书',page:'1',problem:id}});
 const imported=await request('/api/lessons/import','POST',{revision:state.revision,lessons:[make('choice-first'),make('choice-retry'),make('choice-assisted')]});assert.equal(imported.status,200);assert.equal(imported.body.imported,3);
 const catalog=(await request('/api/lessons')).body,visible=catalog.find(l=>l.id==='choice-first');assert.equal(visible.interaction,'choose_answer');assert.deepEqual(visible.choices,make('choice-first').choices);assert.equal(visible.objective,undefined);assert.equal(visible.answer,undefined);
 async function action(type,extra={}){state=(await request('/api/state')).body;return request('/api/action','POST',{revision:state.revision,type,...extra});}
 let result=await action('lesson',{id:'choice-first'});state=result.body;const board=state.board,initialXp=state.rating.practice_xp;assert.equal(state.lesson.objective,undefined);assert.equal(state.lesson.answer,undefined);
 const count=()=>Number(env.DB.db.prepare('SELECT count(*) AS n FROM attempts').get().n);
 result=await action('submit_answer',{answer:0});assert.equal(result.status,400);assert.equal(count(),0);
 result=await action('submit_answer',{answer:'0'});assert.equal(result.status,200);assert.equal(result.body.assessment.correct,true);assert.equal(result.body.rating.practice_xp,initialXp+10);assert.deepEqual(result.body.board,board);assert.equal(result.body.move_number,0);assert.equal(count(),1);
 result=await action('submit_answer',{answer:'0'});assert.equal(result.status,400);assert.equal(count(),1);
 await action('retry');result=await action('submit_answer',{answer:'0'});assert.equal(result.body.rating.practice_xp,initialXp+10);assert.equal(count(),2);
 await action('lesson',{id:'choice-retry'});result=await action('submit_answer',{answer:'3'});assert.equal(result.body.assessment.correct,false);assert.equal(result.body.demo_answer,undefined);assert.equal(result.body.lesson.objective,undefined);assert.equal(result.body.lesson_playout,false);
 await action('retry');result=await action('submit_answer',{answer:'0'});assert.equal(result.body.rating.practice_xp,initialXp+10);
 await action('lesson',{id:'choice-assisted'});result=await action('solution');assert.equal(result.body.demo_answer.label,'0');assert.equal(result.body.assisted,true);assert.equal(result.body.move_number,0);
 await action('restore_demo');result=await action('submit_answer',{answer:'0'});assert.equal(result.body.rating.practice_xp,initialXp+10);assert.equal(result.body.assessment.correct,true);assert.equal(result.body.assisted,true);
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n,3);
});

function mergedRecords(env){
 const db=env.DB.db;
 return {profiles:db.prepare('SELECT id,state_json,helped_json,runs_json FROM profiles ORDER BY id').all().map(row=>({...row,state_json:JSON.parse(row.state_json),helped_json:JSON.parse(row.helped_json),runs_json:JSON.parse(row.runs_json)})),matches:db.prepare('SELECT * FROM matches ORDER BY id').all().map(row=>({...row,state_json:JSON.parse(row.state_json)})),attempts:db.prepare('SELECT * FROM attempts ORDER BY id').all(),evidence:db.prepare('SELECT * FROM evidence ORDER BY lesson_id').all(),helped:db.prepare('SELECT * FROM helped_lessons ORDER BY lesson_id').all()};
}
function withoutVersions(value){return Array.isArray(value)?value.map(withoutVersions):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([name])=>!['revision','version'].includes(name)).map(([name,item])=>[name,withoutVersions(item)])):value;}
async function humanMatch(request){let s=(await request('/api/state')).body;const r=await request('/api/action','POST',{type:'new',match_mode:'human_ai',human_color:1,size:9,revision:s.revision});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}

test('merged human play replies once on the new board and commits both moves in one revision',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_PRIMARY_URL:'https://fnos.example',ENGINE_PRIMARY_TOKEN:'unit-only'});const before=await humanMatch(request),calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(String(url),'https://fnos.example/move');const state=JSON.parse(init.body).state;calls.push(state);assert.equal(state.board[4][4],1);assert.equal(state.moves.length,1);assert.equal(state.to_play,2);return new Response(JSON.stringify({x:5,y:4}));});
 const result=await request('/api/action','POST',{type:'play',x:4,y:4,reply:true,revision:before.revision});assert.equal(result.status,200,JSON.stringify(result.body));const s=result.body;
 assert.equal(calls.length,1);assert.equal(s.revision,before.revision+1);assert.equal(s.move_number,2);assert.equal(s.board[4][4],1);assert.equal(s.board[4][5],2);assert.equal(s.computer_turn,false);assert.equal(s.engine_backend,'fnos');assert.equal(s.engine.last_backend,'fnos');assert.equal(s.history.length,2);assert.equal(s.history[1].board[4][4],1);assert.equal(s.last_human_assessment.summary,'黑棋落在E5。');
 const saved=env.DB.db.prepare('SELECT move_number,version,state_json FROM matches WHERE id=?').get(s.match.id);assert.equal(saved.move_number,2);assert.equal(saved.version,s.revision);assert.deepEqual(JSON.parse(saved.state_json).moves,s.moves);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);
});
test('merged and separate replies have identical public state and saved records except revisions',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-19T04:00:00Z')});
 const initial=applyAction(blank(9),{type:'new',match_mode:'human_ai',human_color:1,size:9},{profileId:'parent',profiles:[{id:'parent',name:'我'},{id:'child',name:'宝宝'}],helped:[],runs:{}}).state;
 t.mock.method(globalThis,'fetch',async(url,init)=>new Response(JSON.stringify(legalPoint(JSON.parse(init.body).state))));
 for(const fixture of [{name:'human_ai',initial,point:{x:4,y:4}},{name:'wrong practice',lesson:'escape-1-1',point:{x:0,y:0}},{name:'deferred sequence',lesson:'ggg-easy-01',point:{x:0,y:0}},{name:'author refutation',lesson:'ggg-easy-68',point:{x:15,y:18}}]){
  const pair=await Promise.all([session(),session()]);
  for(const item of pair){Object.assign(item.env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});await item.request('/api/state');if(fixture.initial)item.env.DB.db.prepare("UPDATE profiles SET state_json=? WHERE id='parent'").run(JSON.stringify(fixture.initial));else if(fixture.lesson!=='escape-1-1'){const before=(await item.request('/api/state')).body;assert.equal((await item.request('/api/action','POST',{type:'lesson',id:fixture.lesson,revision:before.revision})).status,200);}}
  const [merged,separate]=pair,before=(await merged.request('/api/state')).body;
  const once=await merged.request('/api/action','POST',{type:'play',...fixture.point,reply:true,revision:before.revision});assert.equal(once.status,200,fixture.name+JSON.stringify(once.body));
  const child=await separate.request('/api/action','POST',{type:'play',...fixture.point,revision:before.revision});assert.equal(child.status,200,fixture.name+JSON.stringify(child.body));
  const twice=await separate.request('/api/action','POST',{type:'ai_move',revision:child.body.revision});assert.equal(twice.status,200,fixture.name+JSON.stringify(twice.body));
  assert.equal(once.body.revision,before.revision+1);assert.equal(twice.body.revision,before.revision+2);assert.deepEqual(withoutVersions(once.body),withoutVersions(twice.body),fixture.name+' public state');assert.deepEqual(withoutVersions(mergedRecords(merged.env)),withoutVersions(mergedRecords(separate.env)),fixture.name+' persisted records');
 }
});
test('merged reply failures save the human move with Chinese ai_error and allow a manual AI retry',async t=>{
 const failures=[{name:'network',fetch:()=>{throw new Error('private internal failure')}},{name:'unavailable',fetch:()=>new Response('{}',{status:503})},{name:'rejected',fetch:()=>new Response('{}',{status:401})},{name:'invalid JSON',fetch:()=>new Response('invalid')},{name:'invalid coordinates',fetch:()=>new Response(JSON.stringify({x:99,y:0}))},{name:'occupied point',fetch:()=>new Response(JSON.stringify({x:4,y:4}))},{name:'invalid configured URL',url:'not a URL',fetch:()=>{throw new Error('must not fetch')}}];
 for(const failure of failures){
  const {request,env}=await session();Object.assign(env,{ENGINE_URL:failure.url||'https://engine.example',ENGINE_TOKEN:'unit-only'});const before=await humanMatch(request);
  t.mock.method(globalThis,'fetch',failure.fetch);let result=await request('/api/action','POST',{type:'play',x:4,y:4,reply:true,revision:before.revision});assert.equal(result.status,200,failure.name+JSON.stringify(result.body));let s=result.body;
  assert.equal(s.revision,before.revision+1);assert.equal(s.board[4][4],1);assert.equal(s.move_number,1);assert.equal(s.history.length,1);assert.equal(s.computer_turn,true);assert.match(s.ai_error,/落子已保存/);assert.match(s.ai_error,/[\u4e00-\u9fff]/);assert.ok(!s.ai_error.includes('private internal failure'));assert.equal(s.engine_backend,undefined);assert.equal(JSON.parse(env.DB.db.prepare('SELECT state_json FROM matches WHERE id=?').get(s.match.id).state_json).moves.length,1);
  t.mock.restoreAll();env.ENGINE_URL='https://engine.example';t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({x:5,y:4})));
  result=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(result.status,200,failure.name+JSON.stringify(result.body));s=result.body;assert.equal(s.move_number,2);assert.equal(s.computer_turn,false);assert.equal(s.ai_error,undefined);assert.equal(s.engine_backend,'vps');t.mock.restoreAll();
 }
});
test('play without reply stays compatible and play without an engine keeps the computer turn',async t=>{
 for(const configured of [false,true]){
  const {request,env}=await session();if(configured)Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});const before=await humanMatch(request);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not fetch')});
  const result=await request('/api/action','POST',{type:'play',x:4,y:4,...(!configured?{reply:true}:{}),revision:before.revision});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.move_number,1);assert.equal(result.body.computer_turn,true);assert.equal(result.body.ai_error,undefined);assert.equal(calls,0);t.mock.restoreAll();
 }
});
test('reply true skips the engine for two-player games and author-supplied sequence replies',async t=>{
 for(const sequence of [false,true]){
  const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let s=(await request('/api/state')).body,point={x:4,y:4};
  s=(await request('/api/action','POST',sequence?{type:'lesson',id:'ggg-easy-01',revision:s.revision}:{type:'new',match_mode:'two_player',size:9,revision:s.revision})).body;if(sequence){const move=lessons.find(l=>l.id===s.lesson.id).tree.children[0].move;point={x:move[0],y:move[1]};}
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not fetch')});const result=await request('/api/action','POST',{type:'play',...point,reply:true,revision:s.revision});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.move_number,sequence?2:1);assert.equal(result.body.computer_turn,false);assert.equal(result.body.ai_error,undefined);assert.equal(calls,0);if(sequence)assert.equal(result.body.lesson_progress.status,'playing');t.mock.restoreAll();
 }
});
test('merged unlisted play defers review before replying and never records a guessed answer',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let s=(await request('/api/state')).body;s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-01',revision:s.revision})).body;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(new URL(url).pathname);const p=JSON.parse(init.body).state;assert.equal(p.board[0][0],1);assert.equal(p.moves.length,1);assert.equal(p.to_play,2);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);return new Response(JSON.stringify(legalPoint(p)));});
 const result=await request('/api/action','POST',{type:'play',x:0,y:0,reply:true,revision:s.revision});assert.equal(result.status,200,JSON.stringify(result.body));s=result.body;assert.deepEqual(calls,['/move']);assert.equal(s.assessment.review.source,'deferred');assert.equal(s.assessment.correct,null);assert.equal(s.lesson_progress.status,'exploring');assert.equal(s.lesson_progress.ply,2);assert.match(s.message,/KataGo 已应手/);assert.equal(s.lesson_playout,true);assert.equal(s.computer_turn,false);assert.equal(s.assisted,true);assert.equal(s.recent_attempts.length,0);assert.equal(s.rating.practice_xp,0);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM evidence').get().n,0);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM helped_lessons').get().n,1);assert.equal(s.history[1].assessment.review.source,'deferred');
});
test('merged graded mistakes preserve one attempt and evidence through further playout replies',async t=>{
 for(const authored of [false,true]){
  const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let s=(await request('/api/state')).body;
  if(authored)s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-68',revision:s.revision})).body;
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(new URL(url).pathname,'/move');return new Response(JSON.stringify(legalPoint(JSON.parse(init.body).state)));});
  const result=await request('/api/action','POST',{type:'play',...(authored?{x:15,y:18}:{x:0,y:0}),reply:true,revision:s.revision});assert.equal(result.status,200,JSON.stringify(result.body));s=result.body;assert.equal(s.recent_attempts.length,1);assert.equal(s.recent_attempts[0].correct,false);assert.equal(s.recent_attempts[0].assisted,authored);assert.equal(s.recent_attempts[0].attempt_no,1);assert.equal(s.rating.practice_xp,0);if(authored)assert.equal(s.assessment.review.source,'author');
  s=(await request('/api/action','POST',{type:'play',...legalPoint(s),reply:true,revision:s.revision})).body;assert.equal(s.move_number,4);assert.equal(s.computer_turn,false);assert.equal(s.recent_attempts.length,1);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,1);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM evidence').get().n,1);t.mock.restoreAll();
 }
});
test('undo after a merged reply returns free play and lesson playout to the human decision point',async t=>{
 for(const lesson of [null,'escape-1-1','ggg-easy-01']){
  const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});let before=lesson?(await request('/api/state')).body:await humanMatch(request);
  if(lesson==='ggg-easy-01')before=(await request('/api/action','POST',{type:'lesson',id:lesson,revision:before.revision})).body;
  t.mock.method(globalThis,'fetch',async(url,init)=>new Response(JSON.stringify(legalPoint(JSON.parse(init.body).state))));
  const merged=await request('/api/action','POST',{type:'play',...(lesson?{x:0,y:0}:{x:4,y:4}),reply:true,revision:before.revision});assert.equal(merged.status,200,JSON.stringify(merged.body));assert.equal(merged.body.moves.length,2);
  const undo=await request('/api/action','POST',{type:'undo',revision:merged.body.revision});assert.equal(undo.status,200,JSON.stringify(undo.body));const s=undo.body;assert.deepEqual(s.board,before.board);assert.deepEqual(s.moves,before.moves);assert.deepEqual(s.history,before.history);assert.equal(s.to_play,before.to_play);assert.equal(s.lesson_attempted,false);assert.equal(s.lesson_playout,false);assert.equal(s.computer_turn,false);assert.equal(s.assessment,null);assert.equal(s.last_human_assessment,null);if(lesson==='escape-1-1')assert.equal(s.lesson_progress,undefined);t.mock.restoreAll();
 }
});
test('a lesson change during a merged reply wins CAS without saving the old move or answer',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});const before=(await request('/api/state')).body;
 let reply;const started=new Promise(resolve=>t.mock.method(globalThis,'fetch',()=>new Promise(r=>{reply=r;resolve();})));
 const pending=request('/api/action','POST',{type:'play',x:0,y:0,reply:true,revision:before.revision});await started;
 const next=await request('/api/action','POST',{type:'lesson',id:'capture-1-1',revision:before.revision});assert.equal(next.status,200);reply(new Response(JSON.stringify({x:1,y:0})));
 const lost=await pending;assert.equal(lost.status,409);assert.equal(lost.body.state.lesson.id,'capture-1-1');const latest=(await request('/api/state')).body;assert.equal(latest.revision,before.revision+1);assert.equal(latest.lesson.id,'capture-1-1');assert.equal(latest.move_number,0);assert.equal(latest.engine_backend,undefined);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM evidence').get().n,0);
});
test('an engine outage during a merged reply cannot overwrite a newer device state',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});const before=await humanMatch(request);
 let reply;const started=new Promise(resolve=>t.mock.method(globalThis,'fetch',()=>new Promise(r=>{reply=r;resolve();})));
 const pending=request('/api/action','POST',{type:'play',x:4,y:4,reply:true,revision:before.revision});await started;
 const changed=await request('/api/action','POST',{type:'inspect',x:0,y:0,revision:before.revision});assert.equal(changed.status,200);const saved=env.DB.db.prepare("SELECT state_json FROM profiles WHERE id='parent'").get().state_json;reply(new Response('{}',{status:503}));
 const lost=await pending;assert.equal(lost.status,409);assert.equal(lost.body.ai_error,undefined);const latest=(await request('/api/state')).body;assert.equal(latest.move_number,0);assert.equal(latest.board[4][4],0);assert.equal(latest.revision,before.revision+1);assert.equal(env.DB.db.prepare("SELECT state_json FROM profiles WHERE id='parent'").get().state_json,saved);
});
test('pass with reply true preserves the standalone AI request flow',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_URL:'https://engine.example',ENGINE_TOKEN:'unit-only'});const before=await humanMatch(request);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({x:4,y:4}));});
 const passed=await request('/api/action','POST',{type:'pass',reply:true,revision:before.revision});assert.equal(passed.status,200,JSON.stringify(passed.body));assert.equal(passed.body.move_number,1);assert.equal(passed.body.moves[0].pass,true);assert.equal(passed.body.computer_turn,true);assert.equal(calls,0);
 const ai=await request('/api/action','POST',{type:'ai_move',revision:passed.body.revision});assert.equal(ai.status,200,JSON.stringify(ai.body));assert.equal(ai.body.move_number,2);assert.equal(ai.body.computer_turn,false);assert.equal(calls,1);
});
