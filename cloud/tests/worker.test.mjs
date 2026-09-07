import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{contextKey} from '../worker.mjs';
import {makeSession,digest} from '../auth.mjs';
import {lessonState,blank,applyAction} from '../game.mjs';
const lessons=JSON.parse(readFileSync(new URL('../builtin-lessons.json',import.meta.url)));
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
 const {request}=await session();const s=(await request('/api/state')).body;const state=lessonState(lessons.find(l=>l.id==='escape'));const local={schema:2,active_profile_id:'parent',profiles:{parent:{id:'parent',name:'我',state,attempts:[{lesson_id:'capture-1-1',correct:true,assisted:false,attempt_no:1}],notes:[{text:'自己的学习想法'}],helped_lesson_ids:[]},child:{id:'child',name:'测试孩子',state,attempts:[],notes:[]}},matches:{}};
 const migrated=await request('/api/migrate','POST',{revision:s.revision,store:local});assert.equal(migrated.status,200,JSON.stringify(migrated.body));assert.equal(migrated.body.attempts_count,1);const after=(await request('/api/state')).body;assert.equal(after.profiles.find(p=>p.id==='child').name,'测试孩子');assert.equal(after.recent_attempts.length,1);const denied=await request('/api/migrate','POST',{revision:after.revision,store:local});assert.equal(denied.status,409);
});

test('a stale tab cannot write into the profile selected by another tab',async()=>{
 const {request}=await session();const original=(await request('/api/state')).body;
 const changed=await request('/api/action','POST',{type:'switch_profile',profile_id:'child',revision:original.revision});assert.equal(changed.status,200);
 for(const path of ['/api/action','/api/llm/explain']){const result=await request(path,'POST',{type:'feedback',text:'belongs to parent',expected_profile_id:'parent',revision:original.revision},'go_profile=child');assert.equal(result.status,409);}
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
test('fallback produces one persisted AI move with its actual backend',async t=>{
 const {request,env}=await session();Object.assign(env,{ENGINE_PRIMARY_URL:'https://fnos.example',ENGINE_PRIMARY_TOKEN:'primary',ENGINE_URL:'https://vps.example',ENGINE_TOKEN:'fallback'});let s=(await request('/api/state')).body;assert.equal(s.engine.primary_configured,true);assert.equal(s.engine.last_backend,null);s=(await request('/api/action','POST',{type:'new',match_mode:'human_ai',human_color:2,size:19,revision:s.revision})).body;
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(init.method==='GET')return new Response(JSON.stringify({ok:true,available:true}));if(String(url).includes('fnos'))return new Response('{}',{status:503});return new Response(JSON.stringify({x:15,y:3}));});
 const response=await request('/api/action','POST',{type:'ai_move',revision:s.revision});assert.equal(response.status,200);s=response.body;assert.equal(s.move_number,1);assert.equal(s.engine_backend,'vps');assert.equal(s.engine.last_backend,'vps');assert.match(s.engine.status,/最近一次/);assert.equal(calls.filter(x=>x.endsWith('/move')).length,2);assert.equal(s.moves.length,1);
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
test('practice preference persists per profile, assisted completion clears review and sequential advances',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;
 const act=async a=>{const r=await request('/api/action','POST',{...a,revision:s.revision});assert.equal(r.status,200,JSON.stringify(r.body));s=r.body;return s;};
 await act({type:'lesson',id:'escape-1-1'});await act({type:'hint'});await act({type:'practice_mode',mode:'review'});assert.equal(s.lesson.id,'escape-1-1');assert.equal(s.practice_progress.review_count,1);
 await act({type:'play',x:2,y:4});assert.equal(s.recent_attempts[0].correct,true);assert.equal(s.rating.practice_xp,0);assert.equal(s.practice_progress.completed,1);assert.equal(s.practice_progress.review_count,0);
 await act({type:'next_lesson'});assert.match(s.message,/没有待复习/);await act({type:'practice_mode',mode:'sequential'});const first=s.practice_progress.current_index;
 await act({type:'next_lesson'});assert.ok(s.practice_progress.current_index>first);assert.equal((await request('/api/state')).body.practice_mode,'sequential');assert.equal((await request('/api/state','GET',undefined,'go_profile=child')).body.practice_mode,'recommended');
});
test('fresh profiles start in visible first variant while hidden historical lessons remain readable',async()=>{
 const {request}=await session();let s=(await request('/api/state')).body;assert.equal(s.lesson.id,'escape-1-1');assert.equal((await request('/api/lessons')).body.length,474);
 s=(await request('/api/action','POST',{type:'practice_mode',mode:'sequential',revision:s.revision})).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'escape-1-8',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-1-8');
 s=(await request('/api/action','POST',{type:'next_lesson',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-2-1');
 s=(await request('/api/action','POST',{type:'add_profile',name:'新学习者',revision:s.revision})).body;assert.equal(s.lesson.id,'escape-1-1');
});
test('exact author refutation grades once without asking KataGo or awarding XP',async t=>{
 const {request}=await session();let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-68',revision:s.revision})).body;
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('author proof must not call the engine')});
 const response=await request('/api/action','POST',{type:'play',x:15,y:18,revision:s.revision});assert.equal(response.status,200);s=response.body;
 assert.equal(s.assessment.review.source,'author');assert.equal(s.assessment.correct,false);assert.equal(s.lesson_progress.status,'failed');assert.equal(s.recent_attempts.length,1);assert.equal(s.rating.practice_xp,0);
 assert.equal((await request('/api/action','POST',{type:'review_move',revision:s.revision})).status,400);assert.equal((await request('/api/state')).body.recent_attempts.length,1);
});
test('unlisted move survives an outage, retries compute evidence, and stale reviews cannot write',async t=>{
 const {request,env}=await session();let s=(await request('/api/state')).body;
 s=(await request('/api/action','POST',{type:'lesson',id:'ggg-easy-01',revision:s.revision})).body;
 let r=await request('/api/action','POST',{type:'play',x:0,y:0,revision:s.revision});assert.equal(r.status,200);s=r.body;
 assert.equal(s.board[0][0],1);assert.equal(s.assessment.review.source,'unavailable');assert.equal(s.recent_attempts.length,0);
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
