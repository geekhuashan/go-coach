import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blank,lessonState,applyAction} from '../game.mjs';
import {validateLesson} from '../curriculum.mjs';
import {reviewPosition,engineReview,authorReview,ruleReview,setReview} from '../lesson-review.mjs';
const catalog=JSON.parse(readFileSync(new URL('../builtin-lessons.json',import.meta.url)));
const context={helped:[],runs:{},profileId:'parent'};
function sample(color=1){const s=blank(9);s.board[0][8]=1;s.board[8][8]=2;s.to_play=color;s.revision=7;s.review={candidate:{x:0,y:0},reference:{x:1,y:0}};return s;}
function result(s){const item=move=>({move,rootInfo:{scoreLead:10,visits:64},moves:[{move,pv:[move,'A8']}],ownership:Array(81).fill(0)});return {revision:s.revision,perspective:'black',candidate:item('A9'),reference:item('B9'),engine_backend:'fnos'};}
test('KataGo comparison works for both colors without awarding lesson completion',()=>{
 for(const color of [1,2]){const s=sample(color),r=result(s),sign=color===1?1:-1;r.reference.rootInfo.scoreLead=10+5*sign;r.reference.ownership[8]=sign;r.candidate.ownership[8]=-sign;
  const review=engineReview(s,r);assert.equal(review.verdict,'mistake');assert.equal(review.pv[0].color,color);assert.equal(review.pv[1].color,3-color);assert.equal(review.evidence.score_loss,5);
  const out={assessment:{},lesson_progress:{status:'unlisted'}};setReview(out,review);assert.equal(out.assessment.correct,null);assert.equal(out.lesson_progress.status,'unlisted');
 }
});
test('a locally lost group cannot be offset by gains in another group',()=>{
 const s=sample(),r=result(s);r.reference.ownership[8]=1;r.candidate.ownership[8]=-1;r.reference.ownership[80]=-1;r.candidate.ownership[80]=1;
 assert.equal(engineReview(s,r).verdict,'uncertain');
});
test('bad counts, malformed ownership, wrong revision and illegal PV fail closed',()=>{
 const s=sample();for(const change of [r=>r.candidate.rootInfo.visits='invalid',r=>r.candidate.rootInfo.visits=NaN,r=>r.candidate.rootInfo.visits=12,r=>r.candidate.ownership.pop(),r=>r.revision++,r=>r.candidate.moves[0].pv=['A9','A9'],r=>r.candidate.rootInfo.scoreLead=Infinity]){
  const r=result(s);change(r);assert.equal(engineReview(s,r).verdict,'uncertain');
 }
 assert.equal(engineReview(s,result(s)).verdict,'reasonable');
});
test('exact author refutations match full history and original board only',()=>{
 const l=catalog.find(l=>l.id==='ggg-easy-68');const s=applyAction(lessonState(l),{type:'play',x:15,y:18},context).state;
 assert.equal(s.lesson_progress.status,'unlisted');const before=reviewPosition(s);assert.deepEqual(before.board,lessonState(l).board);assert.equal(before.moves.length,0);
 const review=authorReview(s,l);assert.equal(review.source,'author');assert.match(review.explanation,/做不出/);assert.deepEqual(review.pv,[{x:17,y:18,color:2}]);
 setReview(s,review);assert.equal(s.assessment.correct,false);assert.equal(s.lesson_progress.status,'failed');assert.throws(()=>reviewPosition(s));
 const altered=structuredClone(l);altered.stones.pop();assert.equal(authorReview(s,altered),null);
});
test('a valid alternative actual capture completes a capture-any goal outside the tree',()=>{
 const l=validateLesson({id:'alternative-capture',title:'任选目标',prompt:'提掉任一目标',hint:'数气',size:9,skill:'capture',difficulty:3,to_play:1,sequence:true,stones:[{x:0,y:0,color:2},{x:1,y:0,color:1},{x:8,y:8,color:2},{x:7,y:8,color:1}],objective:{kind:'capture_any',targets:[[0,0],[8,8]]},tree:{children:[{move:[0,1],children:[]}]}});
 const r=applyAction(lessonState(l),{type:'play',x:8,y:7},context);assert.equal(r.state.assessment.correct,true);assert.equal(r.state.lesson_progress.status,'solved');assert.equal(r.event.correct,true);assert.equal(r.event.assisted,false);r.state.lesson_progress.status='unlisted';r.state.assessment.correct=null;setReview(r.state,ruleReview(r.state));assert.equal(r.state.assessment.correct,true);assert.equal(r.state.lesson_progress.status,'solved');
});
