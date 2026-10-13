import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {studyPath,studyCompare,studyScope,STUDY_PATHS} from '../study-path.mjs';
import {availableLesson,publicLesson,practice,recommend,learning} from '../curriculum.mjs';
import {lessonState,applyAction} from '../game.mjs';
import worker from '../worker.mjs';
import {makeSession} from '../auth.mjs';
const builtin=JSON.parse(readFileSync(new URL('../builtin-lessons.json',import.meta.url)));
const book=(rank,n,changes={})=>({id:`synthetic-book-${rank}-${n}`,title:`合成题${n}`,prompt:'请选择一个答案。',hint:'观察棋形。',size:9,skill:'tsumego',difficulty:n%2?5:1,to_play:1,sequence:false,stones:[{x:3,y:3,color:1}],marks:[],choices:[{id:'0',label:'0'},{id:'1',label:'1'}],objective:{kind:'choose_answer',answer:'0'},source:{kind:'book',title:STUDY_PATHS[rank-1].title,usage:'household_private',answer_verified:true,problem:`第${n}题`,page:'1'},...changes});
const ctx=(catalog,completed=[],extra={})=>({catalog,completed,evidence:[],helped:[],recent:[],learning:learning(catalog,[]),runs:{_practice_mode:'sequential'},profileId:'parent',profiles:[{id:'parent',name:'合成测试'}],...extra});
test('three canonical books merge punctuation aliases without changing source or IDs',()=>{
 for(let rank=1;rank<=3;rank++)for(const title of [STUDY_PATHS[rank-1].title,STUDY_PATHS[rank-1].title.replace('（',' ').replace('）',''),STUDY_PATHS[rank-1].title.replace('（',' ( ').replace('）',' ) ')]){
  const l=book(rank,265),before=structuredClone(l);l.source.title=title;before.source.title=title;
  const p=studyPath(l);assert.equal(p.id,STUDY_PATHS[rank-1].id);assert.equal(p.title,STUDY_PATHS[rank-1].title);assert.equal(p.role,'main');assert.equal(p.rank,rank);assert.deepEqual(l,before);
  const visible=publicLesson(l);assert.deepEqual(visible.study_path,p);assert.deepEqual(visible.source,l.source);assert.equal(visible.objective,undefined);
 }
 assert.equal(studyPath(book(2,1,{source:{kind:'book',title:'别人的手筋书',problem:'1'}})),null);
});
test('all 75 available original/basic problems are optional and all 417 GGG remain extra',()=>{
 const lessons=builtin.filter(availableLesson),copy=structuredClone(lessons);
 assert.equal(lessons.filter(l=>studyPath(l)?.role==='supplement').length,75);assert.equal(lessons.filter(l=>studyPath(l)?.role==='extra').length,417);
 for(const l of lessons.filter(l=>studyPath(l)?.role==='supplement'))assert.equal(studyPath(l).id,'beginner-tesuji');
 assert.deepEqual(lessons,copy);
});
test('same chapter has original minimum problem number and ordering ignores difficulty',()=>{
 const a=book(2,420,{concept:'滚打包收'}),b=book(2,319,{concept:'滚打包收'});assert.equal(studyPath(a).chapter_rank,319);assert.equal(studyPath(b).chapter_rank,319);
 assert.deepEqual([book(2,266),book(2,264),book(2,265)].sort(studyCompare).map(l=>studyPath(l).number),[264,265,266]);
 assert.equal(studyPath(book(2,264,{source:{...book(2,264).source,problem:'第一单元第264题'}})).number,264);
});
test('second book advances 264 to 265 and respects the explicit 421 gap',()=>{
 const old=book(2,264),next=book(2,265),q420=book(2,420),q422=book(2,422);next.source.title='手筋专项训练 从10级到5级';
 const c=ctx([q422,next,old,q420]);assert.equal(practice(c,old.id,'sequential',true).next_id,next.id);assert.equal(practice(c,q420.id,'sequential',true).next_id,q422.id);
 const result=applyAction(lessonState(old),{type:'next_lesson'},c);assert.equal(result.state.lesson.id,next.id);
});
test('required sequence crosses all three books and never auto-enters optional content',()=>{
 const first=book(1,780),second=book(2,768),third=book(3,528),extra=builtin.find(l=>l.id==='ggg-easy-01'),base=builtin.find(l=>l.id==='escape-1-1'),catalog=[extra,third,base,second,first];
 let c=ctx(catalog,[first.id]),p=practice(c,first.id,'sequential',true);assert.equal(p.next_id,second.id);assert.equal(p.next_book_title,STUDY_PATHS[1].title);
 c=ctx(catalog,[first.id,second.id]);assert.equal(practice(c,second.id,'sequential',true).next_id,third.id);
 c=ctx(catalog,[first.id,second.id,third.id]);p=practice(c,third.id,'sequential',true);assert.equal(p.next_id,null);assert.equal(p.main_path_complete,true);assert.equal(recommend(catalog,[],c.learning,[],third.id,c.completed),null);
 const action=applyAction(lessonState(third),{type:'next_lesson'},c);assert.equal(action.state.lesson.id,third.id);assert.match(action.state.message,/三书主线已完成/);
});
test('starting from a basic supplement goes to first unfinished main book, not a supplement',()=>{
 const base=builtin.find(l=>l.id==='escape-1-1'),first=book(1,241),second=book(2,1),third=book(3,1),c=ctx([third,base,second,first],[first.id]);
 const p=practice(c,base.id,'sequential',true);assert.equal(p.next_id,second.id);assert.equal(p.total,1);assert.equal(p.study_path.id,'intermediate-tesuji');
 assert.equal(recommend(c.catalog,[],c.learning,[],base.id,c.completed).id,second.id);
});
test('an explicitly selected later book continues that book and loops only its remaining questions',()=>{
 const first=book(1,241),a=book(2,264),b=book(2,265),third=book(3,1),c=ctx([first,third,b,a]);
 assert.equal(practice(c,a.id,'sequential',true).next_id,b.id);assert.equal(practice(c,b.id,'sequential',true).next_id,a.id);
 assert.equal(recommend(c.catalog,[],c.learning,[],a.id,[]).id,b.id);
 assert.equal(practice(c,a.id,'sequential',true).chapter,'实战常形');
});
test('GGG is available by explicit selection, stays within its set and orders easy before intermediate',()=>{
 const easy=builtin.find(l=>l.id==='ggg-easy-140'),middle=builtin.find(l=>l.id==='ggg-intermediate-01'),first=book(1,241),c=ctx([middle,first,easy]);
 const p=practice(c,easy.id,'sequential',true);assert.equal(p.next_id,middle.id);assert.equal(p.study_path.id,'gogameguru');assert.equal(p.path_title,'自选拓展');assert.equal(p.total,2);
 assert.equal(recommend(c.catalog,[],c.learning,[],easy.id,[]).id,middle.id);
 const completed=ctx(c.catalog,c.catalog.map(l=>l.id)),result=applyAction(lessonState(middle),{type:'next_lesson'},completed);
 assert.match(result.state.message,/Go Game Guru/);assert.doesNotMatch(result.state.message,/三书主线已完成/);
});
test('successful retry completion wins over the first failed evidence record',()=>{
 const first=book(1,241),second=book(2,1),failed={lesson_id:first.id,correct:false,attempt_no:1},c=ctx([first,second],[first.id],{evidence:[failed],recent:[{...failed,correct:true,attempt_no:2}],learning:learning([first,second],[failed])});
 assert.equal(recommend(c.catalog,c.evidence,c.learning,c.recent,first.id,c.completed).id,second.id);
 assert.equal(practice(c,first.id,'sequential',true).next_id,second.id);
 const before=structuredClone(c);applyAction(lessonState(first),{type:'next_lesson'},c);assert.deepEqual(c,before);
});
test('without any canonical book the old curriculum behavior is retained',()=>{
 assert.equal(studyScope(builtin,'escape-1-1',[]),null);const c=ctx(builtin);assert.equal(practice(c,'ggg-easy-140','sequential',true).next_id,'ggg-intermediate-01');
 assert.equal(practice(c,'escape-1-1','sequential').book_title,undefined);assert.notEqual(recommend(builtin,[],c.learning).id,null);
});

class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');for(const f of ['0001_family.sql','0002_statistics.sql'])this.db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;const statement=args=>({first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),_execute:()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})});return {bind:(...args)=>statement(args),...statement([])};}
 async batch(statements){this.db.exec('BEGIN');try{const out=statements.map(s=>s._execute());this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
}
test('worker reads completed attempts, publishes consistent metadata, and read-only requests change no records',async()=>{
 const env={DB:new D1(),HOUSEHOLD_ID:'test-study',SESSION_SECRET:'synthetic-study-session-only-long-key'},cookie='go_session='+await makeSession(env);
 const get=async path=>{const response=await worker.fetch(new Request('https://go.test'+path,{headers:{Cookie:cookie}}),env);assert.equal(response.status,200);return response.json()};await get('/api/state');
 const first=book(1,780),second=book(2,265);second.source.title='手筋专项训练 从10级到5级';
 for(const l of [first,second])env.DB.db.prepare('INSERT INTO lessons(household_id,id,lesson_json) VALUES(?,?,?)').run('test-study',l.id,JSON.stringify(l));
 env.DB.db.prepare('UPDATE profiles SET state_json=? WHERE household_id=? AND id=?').run(JSON.stringify(lessonState(first)),'test-study','parent');
 const failed={lesson_id:first.id,correct:false,attempt_no:1,assisted:false,difficulty:1,created_at:'2026-09-13T00:00:00Z'};
 env.DB.db.prepare('INSERT INTO evidence(household_id,profile_id,lesson_id,record_json,created_at) VALUES(?,?,?,?,?)').run('test-study','parent',first.id,JSON.stringify(failed),failed.created_at);
 env.DB.db.prepare('INSERT INTO attempts(household_id,profile_id,lesson_id,record_json,created_at,correct,assisted,attempt_no) VALUES(?,?,?,?,?,1,0,2)').run('test-study','parent',first.id,JSON.stringify({...failed,correct:true,attempt_no:2}),failed.created_at);
 const snapshot=()=>JSON.stringify(['households','profiles','attempts','evidence','lessons','ratings','match_stats'].map(table=>[table,env.DB.db.prepare(`SELECT * FROM ${table}`).all()])),before=snapshot();
 const state=await get('/api/state'),catalog=await get('/api/lessons');assert.equal(state.learning.recommendation.id,second.id);assert.equal(state.practice_progress.next_id,second.id);assert.equal(state.rating.practice_xp,0);
 assert.deepEqual(state.lesson.study_path,catalog.find(l=>l.id===first.id).study_path);assert.equal(catalog.find(l=>l.id===second.id).study_path.id,'intermediate-tesuji');assert.equal(snapshot(),before);
});
