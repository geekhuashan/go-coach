import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {play,group,key,boardFor} from '../rules.mjs';
import {validateLesson,learning} from '../curriculum.mjs';
import {blank,lessonState,applyAction,sequenceNode,publicState,sgf} from '../game.mjs';
import {authenticated,makeSession,digest,encrypt,decrypt} from '../auth.mjs';
const catalog=JSON.parse(readFileSync(new URL('../builtin-lessons.json',import.meta.url)));
const profiles=[{id:'parent',name:'我'},{id:'child',name:'宝宝'}];
function ctx(extra={}){return {profileId:'parent',profiles,catalog,helped:[],runs:{},evidence:[],recent:[],learning:learning(catalog,[]),...extra};}
function action(s,a,c=ctx()){return applyAction(s,a,c);}
test('9 and 19 rules share captures, suicide, positional superko and SGF size',()=>{
 for(const size of [9,19]){const s=blank(size);s.board[0][0]=2;s.board[0][1]=1;const result=play(s.board,0,1,1);assert.equal(result.captured,1);assert.equal(result.board[0][0],0);assert.throws(()=>play(s.board,0,1,1,[key(result.board)]));assert.match(sgf(s),new RegExp(`SZ\\[${size}\\]`));}
 const b=blank().board;b[0][1]=2;b[1][0]=2;assert.throws(()=>play(b,0,0,1));
});
test('every authored tactical branch validates and can be solved without exposing its tree',()=>{
 for(const original of catalog.filter(l=>l.sequence)){
  const l=validateLesson(original,{trustedAuthored:true});let s=lessonState(l),context=ctx();let completed=false;
  for(let i=0;i<31&&!s.lesson_attempted;i++){const n=sequenceNode(s).children[0];const result=action(s,{type:'play',x:n.move[0],y:n.move[1]},context);s=result.state;if(result.event){assert.equal(result.event.correct,true);completed=true;}}
  assert.equal(completed,true,l.id);assert.equal(s.lesson_progress.status,'solved');assert.equal(publicState(s).lesson.tree,undefined);assert.equal(publicState(s).lesson.objective,undefined);
  if(l.objective.kind==='authored_solution')assert.match(s.assessment.summary,/作者/);
 }
});
test('unlisted legal moves do not grade as wrong and abandoning a sequence records help',()=>{
 const l=catalog.find(l=>l.sequence&&l.difficulty===5&&l.skill==='capture');let s=lessonState(l);const n=sequenceNode(s).children[0];let r=action(s,{type:'play',x:n.move[0],y:n.move[1]});assert.equal(r.event,null);assert.equal(r.state.moves.length,2);
 r=action(r.state,{type:'new',size:19,match_mode:'two_player',black_profile_id:'parent',white_profile_id:'child'});assert.ok(r.helped.includes(l.id));
 s=lessonState(l);const known=s.lesson.tree.children.map(c=>c.move.join(','));let alternative;for(let y=0;y<s.size&&!alternative;y++)for(let x=0;x<s.size&&!alternative;x++)if(!known.includes([x,y].join(',')))try{play(s.board,x,y,s.to_play);alternative={x,y};}catch{}
 r=action(s,{type:'play',...alternative});assert.equal(r.event,null);assert.equal(r.state.assessment.correct,null);assert.equal(r.state.lesson_progress.status,'unlisted');assert.ok(r.helped.includes(l.id));
});
test('undo returns sequence to learner decision and cannot retain a pending result',()=>{
 const l=catalog.find(l=>l.sequence&&l.skill==='capture');let s=lessonState(l),n=sequenceNode(s).children[0];s=action(s,{type:'play',x:n.move[0],y:n.move[1]}).state;s=action(s,{type:'undo'}).state;assert.equal(s.move_number,0);assert.equal(s.assisted,true);
 s=action(blank(),{type:'new',match_mode:'two_player'}).state;s=action(s,{type:'play',x:0,y:0}).state;s=action(s,{type:'propose_result',winner:'black'}).state;assert.ok(s.match.result_proposal);s=action(s,{type:'undo'}).state;assert.equal(s.match.result_proposal,undefined);assert.throws(()=>action(s,{type:'confirm_result'},ctx({profileId:'child'})));
});
test('two passes do not invent result; confirmation requires other participant; resign is explicit',()=>{
 let s=action(blank(),{type:'new',match_mode:'two_player'}).state;s=action(s,{type:'pass'}).state;s=action(s,{type:'pass'}).state;assert.equal(s.ended,true);assert.equal(s.match.result,undefined);s=action(s,{type:'propose_result',winner:'white'}).state;assert.throws(()=>action(s,{type:'confirm_result'}));s=action(s,{type:'confirm_result'},ctx({profileId:'child'})).state;assert.equal(s.match.result.winner,'white');assert.deepEqual(s.match.result.confirmed_by,['parent','child']);
 s=action(blank(),{type:'new',match_mode:'human_ai',human_color:2,size:19}).state;s=action(s,{type:'resign'}).state;assert.equal(s.match.result.winner,'black');
});
test('human-ai denies user move on computer turn; undo returns human decision',()=>{
 let s=action(blank(),{type:'new',match_mode:'human_ai',human_color:2,size:19}).state;assert.throws(()=>action(s,{type:'play',x:0,y:0}));s=action(s,{type:'ai_move'},ctx({aiMove:{x:3,y:3}})).state;s=action(s,{type:'play',x:15,y:15}).state;s=action(s,{type:'ai_move'},ctx({aiMove:{x:15,y:3}})).state;s=action(s,{type:'undo'}).state;assert.equal(s.to_play,2);assert.equal(s.move_number,1);
});
test('assisted first evidence cannot become independent by repeated correct attempts',()=>{
 const records=[1,2,3].map(i=>({lesson_id:`capture-1-${i}`,correct:true,assisted:true,attempt_no:1}));const stat=learning(catalog,records).skills.find(s=>s.id==='capture');assert.equal(stat.next_difficulty,1);assert.equal(stat.independent_attempts,0);
});
test('signed household session rejects tampering and foreign household; AES-GCM roundtrips',async()=>{
 const env={HOUSEHOLD_ID:'test',SESSION_SECRET:'unit-only-secret-material-32-characters-long'};const token=await makeSession(env),req=value=>new Request('https://go.example/api/state',{headers:{Cookie:'go_session='+value}});assert.equal(await authenticated(req(token),env),true);assert.equal(await authenticated(req(token+'x'),env),false);assert.equal(await authenticated(req(token),{...env,HOUSEHOLD_ID:'other'}),false);const encrypted=await encrypt('unit-only-api-key',env.SESSION_SECRET);assert.ok(!encrypted.includes('unit-only'));assert.equal(await decrypt(encrypted,env.SESSION_SECRET),'unit-only-api-key');await assert.rejects(decrypt(encrypted,env.SESSION_SECRET+'different'));
});
test('reference solution replays from initial board, restores unlisted move and cannot award XP',()=>{
 const l=catalog.find(l=>l.sequence&&l.size===19),initial=lessonState(l);let s=initial;
 let alternative;for(let y=0;y<s.size&&!alternative;y++)for(let x=0;x<s.size&&!alternative;x++)if(!l.tree.children.some(c=>c.move[0]===x&&c.move[1]===y))try{play(s.board,x,y,s.to_play);alternative={x,y};}catch{}
 const unlisted=action(s,{type:'play',...alternative});s=unlisted.state;let r=action(s,{type:'solution'},ctx({helped:unlisted.helped}));assert.equal(r.event,null);assert.equal(r.state.demo_step,1);assert.equal(r.state.moves.length,1);assert.ok(r.state.assisted);assert.ok(r.helped.includes(l.id));assert.equal(publicState(r.state)._demo_moves,undefined);assert.equal(publicState(r.state).lesson.tree,undefined);assert.ok(publicState(r.state).lesson.focus_bounds);
 while(r.state.demo_step<r.state.demo_total){r=action(r.state,{type:'demo_next'},ctx({helped:r.helped}));assert.equal(r.event,null);}
 r=action(r.state,{type:'restore_demo'},ctx({helped:r.helped}));assert.deepEqual(r.state.board,s.board);assert.equal(r.state.lesson_progress.status,'unlisted');assert.ok(r.state.assisted);
});
test('switching a partial sequence into review immediately includes and restarts that lesson',()=>{
 const l=catalog.find(l=>l.id==='tactic-short-ladder');let r=action(lessonState(l),{type:'play',x:l.tree.children[0].move[0],y:l.tree.children[0].move[1]});assert.equal(r.state.lesson_attempted,false);assert.equal(r.state.moves.length,2);
 r=action(r.state,{type:'practice_mode',mode:'review'});assert.equal(r.state.lesson.id,l.id);assert.equal(r.state.moves.length,0);assert.ok(r.helped.includes(l.id));assert.ok(r.state.assisted);
});
