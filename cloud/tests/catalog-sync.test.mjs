import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{contextKey} from '../worker.mjs';
import {makeSession} from '../auth.mjs';
import {lessonState} from '../game.mjs';
import {lessonListItem} from '../catalog.mjs';
import {STUDY_PATHS} from '../study-path.mjs';

const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const book=(rank,n)=>({id:`synthetic-sync-${rank}-${n}`,title:'before',prompt:'请选择答案。',hint:'观察棋形。',skill:'tsumego',difficulty:1,size:9,to_play:1,sequence:false,stones:[{x:3,y:3,color:1}],marks:[],objective:{kind:'choose_answer',answer:'0'},choices:[{id:'0',label:'0'},{id:'1',label:'1'}],source:{kind:'book',title:STUDY_PATHS[rank-1].title,problem:String(n),page:'1',usage:'household_private',answer_verified:true}});
class D1{
 constructor(migrated=true){this.db=new DatabaseSync(':memory:');this.queries=[];this.before=null;for(const file of ['0001_family.sql','0002_statistics.sql',...(migrated?['0003_catalog_sync.sql']:[])])this.db.exec(sql(file));}
 prepare(query){const owner=this,statement=(args=[])=>{const execute=mode=>{owner.queries.push(query);owner.before?.(query);const stmt=owner.db.prepare(query);return mode==='first'?stmt.get(...args)||null:mode==='all'?{results:stmt.all(...args)}:{meta:{changes:Number(stmt.run(...args).changes)}}};return {first:async()=>execute('first'),all:async()=>execute('all'),run:async()=>execute('run'),_execute:()=>execute('run')}};return {...statement(),bind:(...args)=>statement(args)};}
 async batch(statements){this.db.exec('BEGIN');try{const out=statements.map(s=>s._execute());this.db.exec('COMMIT');return out}catch(error){this.db.exec('ROLLBACK');throw error}}
}
async function session({migrated=true}={}){
 const env={DB:new D1(migrated),HOUSEHOLD_ID:'synthetic-home',SESSION_SECRET:'synthetic-sync-session-only-longer-than-32'},cookie='go_session='+await makeSession(env);
 const request=async(path,body=null,profile='parent')=>{const response=await worker.fetch(new Request('https://go.test'+path,{method:body?'POST':'GET',headers:{Cookie:cookie+'; go_profile='+profile,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify({expected_profile_id:profile,...body})}:{})}),env);return {status:response.status,body:await response.json()}};
 const insert=(l,hh=env.HOUSEHOLD_ID)=>env.DB.db.prepare('INSERT INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run(hh,l.id,JSON.stringify(l));
 const state=(l,profile='parent',mode='sequential')=>env.DB.db.prepare('UPDATE profiles SET state_json=?,runs_json=? WHERE household_id=? AND id=?').run(JSON.stringify(lessonState(l)),JSON.stringify({_practice_mode:mode}),env.HOUSEHOLD_ID,profile);
 return {env,request,insert,state};
}
test('migration preserves every original row and builds exact public metadata without private answers',()=>{
 const d=new D1(false),a=book(2,264);d.db.prepare('INSERT INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run('first',a.id,JSON.stringify(a));
 const before=d.db.prepare('SELECT * FROM lessons').all();d.db.exec(sql('0003_catalog_sync.sql'));assert.deepEqual(d.db.prepare('SELECT * FROM lessons').all(),before);
 const row=d.db.prepare('SELECT * FROM lesson_catalog').get(),publicData=JSON.parse(row.public_json);assert.deepEqual(lessonListItem({...publicData,objective:{kind:row.objective_kind}}),lessonListItem(a));
 const index=JSON.parse(row.index_json);assert.equal(index.source.title,a.source.title);assert.equal(index.sequence,false);for(const k of ['tree','stones','objective','answer'])assert.equal(index[k],undefined);
});
test('triggers cover equal-length edits, replacements, household moves, deletes and rollback',()=>{
 const d=new D1(),a=book(2,264),insert=()=>d.db.prepare('INSERT OR REPLACE INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run('first',a.id,JSON.stringify(a)),rev=hh=>d.db.prepare('SELECT epoch,revision FROM catalog_versions WHERE household_id=?').get(hh);insert();const initial=rev('first');a.title='after!';insert();assert.equal(rev('first').revision,initial.revision+1);
 a.title='edited';d.db.prepare('UPDATE lessons SET lesson_json=? WHERE household_id=?').run(JSON.stringify(a),'first');assert.equal(rev('first').revision,initial.revision+2);
 d.db.prepare('UPDATE lessons SET household_id=? WHERE household_id=?').run('second','first');assert.equal(rev('first').revision,initial.revision+3);assert.equal(rev('second').revision,1);assert.equal(d.db.prepare('SELECT household_id FROM lesson_catalog').get().household_id,'second');
 d.db.exec('BEGIN');d.db.prepare('DELETE FROM lessons WHERE household_id=?').run('second');d.db.exec('ROLLBACK');assert.equal(rev('second').revision,1);assert.equal(d.db.prepare('SELECT COUNT(*) n FROM lesson_catalog').get().n,1);
 d.db.prepare('DELETE FROM lessons WHERE household_id=?').run('second');assert.equal(rev('second').revision,2);assert.equal(d.db.prepare('SELECT COUNT(*) n FROM lesson_catalog').get().n,0);assert.equal(rev('first').epoch,initial.epoch);
});
test('sync is one read, never loads a catalog or initializes a family, and isolates profile explanation changes',async()=>{
 const h=await session();let response=await h.request('/api/sync');assert.equal(response.body.requires_refresh,true);assert.equal(h.env.DB.db.prepare('SELECT COUNT(*) n FROM households').get().n,0);
 await h.request('/api/state');h.env.DB.queries=[];const before=(await h.request('/api/sync')).body;assert.equal(before.requires_refresh,false);assert.equal(h.env.DB.queries.length,1);assert(!h.env.DB.queries.some(q=>/lesson_json|index_json|public_json/.test(q)));
 h.env.DB.db.prepare('INSERT INTO llm_explanations(household_id,profile_id,context_key,record_json,created_at) VALUES(?,?,?,?,?)').run(h.env.HOUSEHOLD_ID,'child','synthetic-context','{}','2026-09-13');const child=(await h.request('/api/sync',null,'child')).body,parent=(await h.request('/api/sync')).body;
 assert.equal(child.revision,before.revision);assert.notEqual(child.explanation_revision,before.explanation_revision);assert.equal(parent.explanation_revision,before.explanation_revision);
 h.env.DB.db.prepare('UPDATE llm_explanations SET record_json=?').run('{"text":"changed"}');assert.notEqual((await h.request('/api/sync',null,'child')).body.explanation_revision,child.explanation_revision);
 const unauthorized=await worker.fetch(new Request('https://go.test/api/sync'),h.env);assert.equal(unauthorized.status,401);
});
test('warm state uses indexed versions, navigation hydrates selected choices, and completed retry preserves XP',async()=>{
 const h=await session(),a=book(2,264),b=book(2,265);await h.request('/api/state');h.insert(a);h.insert(b);h.state(a);await h.request('/api/state');h.env.DB.queries=[];
 let s=(await h.request('/api/state')).body;assert.equal(s.sync.requires_refresh,false);assert(!h.env.DB.queries.some(q=>/SELECT lesson_json FROM lessons|c.index_json/.test(q)));
 let r=await h.request('/api/action',{revision:s.revision,type:'next_lesson'});assert.equal(r.status,200);s=r.body;assert.equal(s.lesson.id,b.id);assert.equal(s.lesson.interaction,'choose_answer');assert.equal(s.lesson.objective,undefined);assert.deepEqual(s.lesson.stones,b.stones);
 const beforeXP=s.rating.practice_xp;r=await h.request('/api/action',{revision:s.revision,type:'submit_answer',answer:'0'});assert.equal(r.body.assessment.correct,true);assert.equal(r.body.rating.practice_xp,beforeXP+10);
 s=(await h.request('/api/action',{revision:r.body.revision,type:'retry'})).body;r=await h.request('/api/action',{revision:s.revision,type:'submit_answer',answer:'0'});assert.equal(r.body.rating.practice_xp,beforeXP+10);
 b.legacy=true;h.env.DB.db.prepare('UPDATE lessons SET lesson_json=? WHERE household_id=? AND id=?').run(JSON.stringify(b),h.env.HOUSEHOLD_ID,b.id);assert(!(await h.request('/api/lessons')).body.some(l=>l.id===b.id));
});
test('sync baseline precedes full-body reads and a catalog edit before CAS rejects the stale write',async()=>{
 const h=await session(),a=book(2,264);await h.request('/api/state');h.insert(a);h.state(a);let s=(await h.request('/api/state')).body;const baseline=s.sync.explanation_revision,key=await contextKey(lessonState(a));
 h.env.DB.before=query=>{if(query.startsWith('SELECT record_json FROM llm_explanations')){h.env.DB.before=null;h.env.DB.db.prepare('INSERT INTO llm_explanations(household_id,profile_id,context_key,record_json,created_at) VALUES(?,?,?,?,?)').run(h.env.HOUSEHOLD_ID,'parent',key,'{"text":"arrived"}','2026-09-13')}};
 s=(await h.request('/api/state')).body;assert.equal(s.sync.explanation_revision,baseline);assert.notEqual((await h.request('/api/sync')).body.explanation_revision,baseline);
 h.env.DB.before=query=>{if(query.startsWith('UPDATE households SET revision=revision+1')){h.env.DB.before=null;a.title='after!';h.env.DB.db.prepare('UPDATE lessons SET lesson_json=? WHERE household_id=? AND id=?').run(JSON.stringify(a),h.env.HOUSEHOLD_ID,a.id)}};
 const response=await h.request('/api/action',{type:'submit_answer',answer:'0',revision:s.revision});assert.equal(response.status,409);assert.equal(h.env.DB.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);
});
test('pre-migration fallback remains playable and old automatic explanation requests are rejected before DB work',async()=>{
 const h=await session({migrated:false});let s=(await h.request('/api/state')).body;assert.equal(s.sync.requires_refresh,true);assert.equal(s.sync.catalog_revision,null);const a=book(2,264);h.insert(a);
 s=(await h.request('/api/action',{type:'lesson',id:a.id,revision:s.revision})).body;assert.equal(s.lesson.id,a.id);assert.equal(s.lesson.interaction,'choose_answer');h.env.DB.queries=[];
 const response=await h.request('/api/llm/explain',{revision:s.revision,question:''});assert.equal(response.status,400);assert.equal(response.body.code,'manual_required');assert.equal(h.env.DB.queries.length,0);
});
test('local migration hydrates a pre-imported cloud book referenced by local state',async()=>{
 const h=await session(),a=book(2,264);await h.request('/api/state');h.insert(a);const s=(await h.request('/api/state')).body;
 const store={schema:2,profiles:{parent:{name:'Synthetic parent',state:lessonState(a),attempts:[],notes:[],helped_lesson_ids:[],lesson_runs:{}}},matches:{}};
 const response=await h.request('/api/migrate',{revision:s.revision,store});assert.equal(response.status,200);
 const persisted=JSON.parse(h.env.DB.db.prepare('SELECT state_json FROM profiles WHERE household_id=? AND id=?').get(h.env.HOUSEHOLD_ID,'parent').state_json);assert.deepEqual(persisted.lesson.objective,a.objective);assert.deepEqual(persisted.lesson.stones,a.stones);
});
