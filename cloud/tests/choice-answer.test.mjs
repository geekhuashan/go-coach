import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLesson,publicLesson,learning} from '../curriculum.mjs';
import {lessonState,applyAction,publicState,computerTurn} from '../game.mjs';

export function choiceFixture(id='eye-count-fixture'){
 return {id,title:'数眼测试',prompt:'这块黑棋有几只真眼？',hint:'观察眼位周围的棋子。',size:9,skill:'life',sequence:false,difficulty:1,to_play:1,
  stones:[{x:3,y:3,color:1}],marks:[],choices:['0','1','2','3'].map(id=>({id,label:id})),objective:{kind:'choose_answer',answer:'0'},
  source:{kind:'book',usage:'household_private',answer_verified:true,title:'合成测试书',page:'1',problem:'1'}};
}
const context=l=>({catalog:[l],profileId:'parent',profiles:[{id:'parent',name:'测试'}],evidence:[],learning:learning([l],[]),runs:{},helped:[]});
const apply=(s,a,c=context(s.lesson))=>applyAction(s,a,c);
const boardFields=s=>Object.fromEntries(['board','initial_board','moves','history','captures','to_play','move_number','last_move'].map(k=>[k,s[k]]));
function privateFieldsAbsent(value){
 if(Array.isArray(value))value.forEach(privateFieldsAbsent);
 else if(value&&typeof value==='object'){for(const k of ['objective','answer','tree','solutions','solution','_demo_backup','_demo_moves'])assert.equal(Object.hasOwn(value,k),false,k);Object.values(value).forEach(privateFieldsAbsent);}
}

test('choice schema preserves ordered public labels and validates a private string zero ID',()=>{
 const raw=choiceFixture(),clean=validateLesson(raw);assert.deepEqual(clean,raw);assert.deepEqual(validateLesson(clean),clean);
 const visible=publicLesson(clean);assert.equal(visible.interaction,'choose_answer');assert.deepEqual(visible.choices,raw.choices);privateFieldsAbsent(visible);
 for(const choices of [[{id:'a',label:'活'}], [{id:'a',label:'活'},{id:'a',label:'死'}], [{id:'a',label:'活'},{id:'b',label:'活'}], [{id:'',label:'活'},{id:'b',label:'死'}], [{id:0,label:'0'},{id:'1',label:'1'}]])assert.throws(()=>validateLesson({...raw,choices}));
 for(const answer of [0,false,null,[],{},'4',' 0'])assert.throws(()=>validateLesson({...raw,objective:{kind:'choose_answer',answer}}));
 assert.throws(()=>validateLesson({...raw,sequence:true}));assert.throws(()=>validateLesson({...raw,tree:{children:[]}}));
 assert.throws(()=>validateLesson({...raw,source:{...raw.source,answer_verified:false}}));
 for(const labels of [['真眼','假眼'],['能','不能'],['活','死']]){const r={...raw,choices:labels.map((label,i)=>({id:String(i),label}))};assert.deepEqual(validateLesson(r).choices,r.choices);}
});

test('choice submissions grade exact allowed IDs without changing the board or leaking the answer',()=>{
 const l=validateLesson(choiceFixture()),initial=lessonState(l),snapshot=structuredClone(initial);privateFieldsAbsent(publicState(initial));
 for(const a of [{type:'play',x:0,y:0},{type:'ai_move'},{type:'pass'},{type:'submit_selection',points:[[3,3]]},...['',0,null,'missing'].map(answer=>({type:'submit_answer',answer}))])assert.throws(()=>apply(initial,a));
 assert.deepEqual(initial,snapshot);
 const wrong=apply(initial,{type:'submit_answer',answer:'2'});assert.equal(wrong.event.correct,false);assert.equal(wrong.event.move,null);assert.deepEqual(boardFields(wrong.state),boardFields(initial));assert.equal(wrong.state.lesson_playout,false);assert.equal(computerTurn(wrong.state),false);
 assert.equal(wrong.state.assessment.selected_answer,'2');assert.equal(wrong.state.demo_answer,undefined);privateFieldsAbsent(publicState(wrong.state));assert.throws(()=>apply(wrong.state,{type:'submit_answer',answer:'0'}));
 const retry=apply(wrong.state,{type:'retry'});assert.equal(retry.state.lesson_attempted,false);assert.equal(retry.state.assessment,null);assert.deepEqual(boardFields(retry.state),boardFields(initial));
 const correct=apply(retry.state,{type:'submit_answer',answer:'0'});assert.equal(correct.event.correct,true);assert.equal(correct.event.assisted,false);assert.equal(correct.state.lesson_progress.status,'solved');assert.deepEqual(boardFields(correct.state),boardFields(initial));privateFieldsAbsent(publicState(correct.state));
});

test('explicit choice solution reveals one label without moves and restores the hidden answer state',()=>{
 const l=validateLesson(choiceFixture()),initial=lessonState(l);let result=apply(initial,{type:'solution'});
 assert.equal(result.event,null);assert.equal(result.state.demo_active,true);assert.deepEqual(result.state.demo_answer,{id:'0',label:'0'});assert.match(result.state.message,/参考答案：0/);assert.deepEqual(boardFields(result.state),boardFields(initial));assert.ok(result.helped.includes(l.id));privateFieldsAbsent(publicState(result.state));
 assert.throws(()=>apply(result.state,{type:'submit_answer',answer:'0'}));assert.throws(()=>apply(result.state,{type:'demo_next'}));
 result=apply(result.state,{type:'restore_demo'},{...context(l),helped:result.helped});assert.equal(result.state.demo_answer,undefined);assert.equal(result.state.demo_active,false);assert.equal(result.state.assisted,true);privateFieldsAbsent(publicState(result.state));
 result=apply(result.state,{type:'submit_answer',answer:'0'},{...context(l),helped:result.helped});assert.equal(result.event.correct,true);assert.equal(result.event.assisted,true);assert.deepEqual(boardFields(result.state),boardFields(initial));
});
