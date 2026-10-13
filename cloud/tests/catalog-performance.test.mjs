import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {availableLessons,learning,practice,recommend} from '../curriculum.mjs';
import {studyScope,STUDY_PATHS} from '../study-path.mjs';
import worker from '../worker.mjs';
import {makeSession} from '../auth.mjs';

const book=(rank,n)=>({id:`synthetic-${rank}-${n}`,title:'before',prompt:'观察棋形。',hint:'这是合成测试。',skill:'tsumego',difficulty:1,size:9,to_play:1,sequence:false,stones:[{x:3,y:3,color:1}],objective:{kind:'choose_answer',answer:'0'},choices:[{id:'0',label:'0'},{id:'1',label:'1'}],source:{kind:'book',title:STUDY_PATHS[rank-1].title,problem:String(n),page:'1',usage:'household_private',answer_verified:true}});
test('immutable catalog ordering is reused without sharing learner completion',()=>{
 let sourceReads=0;const lessons=[book(1,780),book(2,264),book(2,265),book(3,1)];
 for(const l of lessons){const title=l.source.title;Object.defineProperty(l.source,'title',{enumerable:true,get(){sourceReads++;return title}});}
 const catalog=Object.freeze(lessons),available=availableLessons(catalog);
 const first=studyScope(available,lessons[0].id,[]),reads=sourceReads;
 const second=studyScope(available,lessons[0].id,[lessons[0].id]);
 assert.equal(sourceReads,reads);assert.equal(availableLessons(catalog),available);
 assert.equal(first.path.id,'beginner-tesuji');assert.equal(second.path.id,'intermediate-tesuji');assert.equal(first.completed.size,0);assert.equal(second.completed.size,1);
 assert.throws(()=>{second.path.id='changed'},TypeError);
 assert.throws(()=>second.lessons.reverse(),TypeError);
 const ctx={catalog,evidence:[],helped:[],completed:[],learning:learning(catalog,[]),runs:{}};
 assert.equal(practice(ctx,lessons[1].id,'sequential',true).next_id,lessons[2].id);
 ctx.completed=lessons.map(l=>l.id);assert.equal(recommend(catalog,[],ctx.learning,[],lessons[3].id,ctx.completed),null);
 assert.equal(practice(ctx,lessons[3].id).main_path_complete,true);
 ctx.completed=[];assert.equal(practice(ctx,lessons[3].id).main_path_complete,false);
});
test('mutable inputs and replacement catalog snapshots reflect edits immediately',()=>{
 const a=book(1,780),b=book(2,1),catalog=[a,b];assert.equal(studyScope(availableLessons(catalog),a.id).path.id,'beginner-tesuji');
 a.source.title=STUDY_PATHS[2].title;assert.equal(studyScope(availableLessons(catalog),a.id).path.id,'beginner-life');
 b.legacy=true;assert.equal(availableLessons(catalog).length,1);b.legacy=false;
 const first=Object.freeze([book(1,780),book(2,1)]),replacement=Object.freeze([book(1,780),book(3,1)]);
 assert.equal(studyScope(availableLessons(first),first[0].id,[first[0].id]).path.id,'intermediate-tesuji');
 assert.equal(studyScope(availableLessons(replacement),replacement[0].id,[replacement[0].id]).path.id,'beginner-life');
});
test('reading LLM settings requires only its own row, while authentication remains mandatory',async()=>{
 const queries=[],env={HOUSEHOLD_ID:'synthetic-perf',SESSION_SECRET:'synthetic-settings-read-secret-only-long-enough',DB:{prepare(sql){queries.push(sql);assert.match(sql,/FROM llm_settings/);return {bind(){return {first:async()=>null}}}}}};
 const cookie='go_session='+await makeSession(env),request=()=>new Request('https://go.test/api/llm/settings',{headers:{Cookie:cookie}});
 const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.deepEqual(await response.json(),{enabled:false,base_url:'',model:'',has_api_key:false});assert.equal(queries.length,1);
 assert.equal((await worker.fetch(new Request('https://go.test/api/llm/settings'),env)).status,401);assert.equal(queries.length,1);
});
test('cached public catalogs stay household-scoped and see same-length D1 edits without a revision change',async()=>{
 const db=new DatabaseSync(':memory:');for(const name of ['0001_family.sql','0002_statistics.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)})}}}}};
 const a=book(2,264),b=book(2,265);for(const [hh,l]of [['first',a],['second',b]])db.prepare('INSERT INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run(hh,l.id,JSON.stringify(l));
 const env=hh=>({DB:binding,HOUSEHOLD_ID:hh,SESSION_SECRET:'synthetic-catalog-read-secret-only-long-enough'});
 const get=async hh=>{const e=env(hh),cookie='go_session='+await makeSession(e);const response=await worker.fetch(new Request('https://go.test/api/lessons',{headers:{Cookie:cookie}}),e);assert.equal(response.status,200);return response.json()};
 const original=await get('first');assert.deepEqual(await get('first'),original);assert.equal(original.find(l=>l.id===a.id).objective,undefined);assert(!original.some(l=>l.id===b.id));
 a.title='after!';db.prepare('UPDATE lessons SET lesson_json=? WHERE household_id=? AND id=?').run(JSON.stringify(a),'first',a.id);
 assert.equal((await get('first')).find(l=>l.id===a.id).title,'after!');assert(!(await get('second')).some(l=>l.id===a.id));
 db.close();
});
