import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {explainLesson,eyeShape,boardOf,EXPLAIN_VERSION} from '../explain.mjs';
import {checkWhy,ruleWhy} from '../../scripts/explanation-model.mjs';
import {lessonState,applyAction,publicState} from '../game.mjs';
import {learning} from '../curriculum.mjs';
import {play} from '../rules.mjs';
import worker from '../worker.mjs';
import {makeSession,digest} from '../auth.mjs';

// Synthetic positions only: book problems stay in the private database.
const source={kind:'book',usage:'household_private',answer_verified:true,title:'合成测试书',page:'1',problem:'1'};
function ladder(id='explain-ladder'){
 return {id,title:'沿边追吃',prompt:'黑先，吃掉白子。',hint:'从外面打吃。',size:9,skill:'tsumego',sequence:true,difficulty:1,to_play:1,concept:'综合运用',
  stones:[{x:4,y:0,color:2},{x:3,y:0,color:1}],objective:{kind:'authored_solution'},source,
  tree:{children:[{move:[4,1],explanation:'打吃',result:'success',author_verdict:'correct',children:[]}]}};
}
function eye(answer,whiteDiagonal){
 return {id:'explain-eye-'+answer,title:'角上的眼',prompt:'标出的眼是真眼还是假眼？',hint:'看斜角。',size:9,skill:'life',sequence:false,difficulty:1,to_play:1,concept:'真眼假眼',
  stones:[{x:1,y:0,color:1},{x:0,y:1,color:1},{x:1,y:1,color:whiteDiagonal?2:1}],marks:[],choices:[{id:'true_eye',label:'真眼'},{id:'false_eye',label:'假眼'}],objective:{kind:'choose_answer',answer},source};
}
const LABELS=/^(\d+|气|眼|乙|丙|丁|×|△|破|死|假)$/;
function replayable(lesson,e){
 const check=(board,frames)=>{let b=board;for(const f of frames){for(const m of f.marks){assert.ok(m.x>=0&&m.y>=0&&m.x<lesson.size&&m.y<lesson.size);assert.match(m.label,LABELS);}if(f.move)b=play(b,f.move.x,f.move.y,f.move.color).board;}return b;};
 const after=check(boardOf(lesson),e.steps);
 for(const d of e.demos)check(d.from==='after'?after:boardOf(lesson),d.frames);
}

test('eye shape follows the diagonal rule for centre, edge and corner points',()=>{
 const b=Array.from({length:9},()=>Array(9).fill(0));
 for(const[x,y]of [[3,4],[5,4],[4,3],[4,5],[1,0],[0,1],[8,3],[8,5],[7,4]])b[y][x]=1;
 b[3][3]=2;assert.equal(eyeShape(b,1,[4,4]).status,'true');
 b[5][5]=2;assert.equal(eyeShape(b,1,[4,4]).status,'false');
 assert.equal(eyeShape(b,1,[0,0]).status,'true');b[1][1]=2;assert.equal(eyeShape(b,1,[0,0]).status,'false');
 assert.equal(eyeShape(b,1,[8,4]).where,'edge');assert.equal(eyeShape(b,1,[2,2]),null);
});

test('a capture explanation narrates the reference line and proves the escape fails',()=>{
 const l=ladder(),e=explainLesson(l);
 assert.equal(e.version,EXPLAIN_VERSION);assert.equal(e.family,'capture');
 assert.deepEqual(e.steps.map(s=>s.move),[{x:4,y:1,color:1}]);assert.match(e.steps[0].text,/^黑1：白棋1子只剩1口气，被打吃了/);
 const escape=e.demos.find(d=>d.title==='白棋逃不掉');assert.equal(escape.from,'after');assert.match(escape.frames[0].text,/^演示：假如白棋想逃——白2/);assert.match(escape.frames.at(-1).text,/提掉白棋5子/);
 replayable(l,e);
});

test('eye verdicts are stated only when the board reading agrees with the book answer',()=>{
 for(const[answer,diag]of [['true_eye',false],['false_eye',true]]){
  const l=eye(answer,diag),e=explainLesson(l);assert.equal(e.verdict,answer);assert.ok(e.summary.length);assert.match(e.steps[0].text,new RegExp(`所以是${answer==='true_eye'?'真眼':'假眼'}`));replayable(l,e);
 }
 const disagree=explainLesson(eye('true_eye',true));assert.equal(disagree.verdict,'false_eye');assert.deepEqual(disagree.summary,[]);assert.deepEqual(disagree.demos,[]);
});

test('the model rewrite may not add numbers, move captures or change script',()=>{
 const source='黑1：白棋1子只剩1口气，被打吃了。黑3：提掉白棋1子。';
 assert.equal(checkWhy('黑1一下，白棋1子只剩1口气，被打吃了；黑3再把这1子提掉。',source),null);
 assert.equal(checkWhy('黑1让白棋2子只剩1口气，黑3提掉白棋1子。',source),'number');
 assert.equal(checkWhy('黑1把白棋1子提掉了，黑3再提掉1子。',source),'moved');
 assert.equal(checkWhy('黑1讓白棋只剩1口气被打吃，黑3提掉白棋1子。',source),'traditional');
 assert.equal(checkWhy('白棋1子只剩1口气被打吃，最后被提掉。',source),'labels');
 assert.equal(checkWhy('黑1打吃，黑3征吃白棋1子并提掉。',source),'term');
 const e=explainLesson(ladder());assert.equal(ruleWhy(e),'黑1：白棋1子只剩1口气，被打吃了，怎么逃都会被提掉。');
});

const context=(l,extra={})=>({catalog:[l],profileId:'parent',profiles:[{id:'parent',name:'测试'}],evidence:[],learning:learning([l],[]),runs:{},helped:[],...extra});
test('narrated demos replay the explanation and solved-alone review is not counted as help',()=>{
 const l=ladder(),ex={...explainLesson(l),why:'黑1从外面打吃，白棋沿边逃也逃不掉。'};
 let r=applyAction(lessonState(l),{type:'play',x:4,y:1},context(l,{explanation:ex}));
 assert.equal(r.state.assessment.correct,true);assert.equal(r.state.assessment.why,ex.why);assert.equal(r.state.assessment.why_title,'为什么对');assert.deepEqual(r.state.lesson_explain,{demos:['白棋逃不掉']});
 const solved=r.state;
 r=applyAction(solved,{type:'solution'},context(l,{explanation:ex}));
 assert.deepEqual(r.helped,[]);assert.equal(r.state.assisted,false);assert.equal(r.state.demo_explained,true);assert.equal(r.state.message,ex.steps[0].text);assert.deepEqual(r.state.marks,ex.steps[0].marks);
 const pub=publicState(r.state);assert.equal(pub._demo_moves,undefined);assert.equal(pub._demo_backup,undefined);assert.equal(pub.lesson.tree,undefined);
 r=applyAction(r.state,{type:'restore_demo'},context(l));assert.deepEqual(r.state.board,solved.board);
 r=applyAction(solved,{type:'solution',demo:0},context(l,{explanation:ex}));
 assert.equal(r.state.board[1][4],1);assert.equal(r.state.demo_total,ex.demos[0].frames.length);assert.match(r.state.message,/^演示：假如白棋想逃/);
 while(r.state.demo_step<r.state.demo_total)r=applyAction(r.state,{type:'demo_next'},context(l,{explanation:ex}));
 assert.equal(r.state.message,ex.demos[0].frames.at(-1).text);
 assert.throws(()=>applyAction(solved,{type:'solution',demo:5},context(l,{explanation:ex})),/讲解演示/);
 assert.throws(()=>applyAction(solved,{type:'solution',demo:'__proto__'},context(l,{explanation:ex})),/讲解演示/);
 r=applyAction(lessonState(l),{type:'solution'},context(l,{explanation:ex}));assert.deepEqual(r.helped,[l.id]);assert.equal(r.state.assisted,true);
});

test('a correct judgement shows the rule reason and its marks; a wrong one keeps it hidden',()=>{
 const l=eye('false_eye',true),ex={...explainLesson(l),why:'角上的眼斜角被白棋占了，所以是假眼。'};
 let r=applyAction(lessonState(l),{type:'submit_answer',answer:'false_eye'},context(l,{explanation:ex}));
 assert.equal(r.state.assessment.why,ex.why);assert.deepEqual(r.state.marks,ex.steps[0].marks);
 r=applyAction(lessonState(l),{type:'submit_answer',answer:'true_eye'},context(l,{explanation:ex}));
 assert.equal(r.state.assessment.why,undefined);assert.deepEqual(r.state.marks,[]);
 r=applyAction(r.state,{type:'solution'},context(l,{explanation:ex}));assert.match(r.state.message,/^参考答案：假眼。 标“眼”的点在角上/);assert.ok(r.helped.includes(l.id));
});

class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0001_family.sql','0002_statistics.sql','0004_lesson_explanations.sql'])this.db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;const statement=args=>({async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}},_execute(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}});return {bind(...args){return statement(args)},...statement([])};}
 async batch(statements){this.db.exec('BEGIN');try{const results=statements.map(s=>s._execute());this.db.exec('COMMIT');return results}catch(e){this.db.exec('ROLLBACK');throw e}}
}
test('the worker reads a stored explanation only for the answered lesson and never before',async()=>{
 const env={DB:new D1(),HOUSEHOLD_ID:'test-home',SESSION_SECRET:'test-only-secret-longer-than-thirty-two-characters',FAMILY_PASSWORD_HASH:await digest('NOT_A_REAL_PASSWORD')},cookie='go_session='+await makeSession(env);
 const request=async(path,method='GET',data)=>{const headers={Cookie:cookie,Origin:'https://go.example'};if(data){headers['Content-Type']='application/json';data={expected_profile_id:'parent',...data};}const r=await worker.fetch(new Request('https://go.example'+path,{method,headers,body:data&&JSON.stringify(data)}),env);return {status:r.status,body:await r.json()};};
 const action=async(type,extra={})=>{const s=(await request('/api/state')).body;return request('/api/action','POST',{revision:s.revision,type,...extra});};
 const l=ladder('explain-worker'),s=(await request('/api/state')).body;
 assert.equal((await request('/api/lessons/import','POST',{revision:s.revision,lessons:[l]})).status,200);
 const ex={...explainLesson(l),why:'黑1从外面打吃，白棋沿边逃也逃不掉。'};
 env.DB.db.prepare('INSERT INTO lesson_explanations(household_id,lesson_id,version,explanation_json) VALUES(?,?,?,?)').run('test-home',l.id,EXPLAIN_VERSION,JSON.stringify(ex));
 let r=await action('lesson',{id:l.id});assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes(ex.why),false);assert.equal(r.body.lesson_explain,undefined);
 r=await action('play',{x:4,y:1});assert.equal(r.body.assessment.why,ex.why);assert.deepEqual(r.body.lesson_explain,{demos:['白棋逃不掉']});
 r=await action('solution');assert.equal(r.body.demo_explained,true);assert.equal(r.body.message,ex.steps[0].text);assert.equal(r.body.assisted,false);
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM helped_lessons').get().n,0);
 r=await action('restore_demo');r=await action('solution',{demo:0});assert.match(r.body.message,/^演示：假如白棋想逃/);assert.equal(r.body._demo_moves,undefined);
});
