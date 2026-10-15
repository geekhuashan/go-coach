import test from 'node:test';
import assert from 'node:assert/strict';
import builtins from '../builtin-lessons.json' with {type:'json'};
import {growthFor} from '../growth.mjs';

const lesson=(n,extra={})=>({id:`shape-${n}`,skill:'capture',concept:'atari',size:9,to_play:1,stones:Array.from({length:n+1},(_,i)=>({x:i%9,y:Math.floor(i/9),color:i===0?1:2})),...extra});
const record=(l,n=0,extra={})=>({lesson_id:l.id,profile_id:'child',correct:true,assisted:false,attempt_no:1,created_at:`2026-10-${String(1+n%12).padStart(2,'0')}T12:00:00Z`,...extra});
const growth=(ls,rs)=>growthFor(ls,rs,{profileId:'child'});
const rotate=l=>({...l,id:l.id+'-rotated',stones:l.stones.map(p=>({...p,x:8-p.y,y:p.x}))});
const mirror=l=>({...l,id:l.id+'-mirrored',stones:l.stones.map(p=>({...p,x:8-p.x}))});
const catalog=()=>Array.from({length:50},(_,i)=>lesson(i+1));

test('empty or unavailable evidence never invents a score, badge, or rank',()=>{
 const result=growth([],[]);assert.equal(result.method,'family-go-growth-v1');assert.equal(result.scope,'profile');assert.equal(result.latest,null);assert.deepEqual(result.badges,[]);assert.equal(result.summary.ability.score,null);assert.equal(result.summary.ability.status,'observing');assert.match(result.summary.note,/不是围棋段位/);
});
test('first unaided correct evidence produces an earned-date badge and deterministic identity',()=>{
 const l=lesson(1),result=growth([l],[record(l,0)]);assert.equal(result.badges.length,1);assert.equal(result.latest.kind,'first_solve');assert.equal(result.latest.date,'2026-10-01');assert.equal(result.latest.earned_at,'2026-10-01T12:00:00.000Z');assert.equal(result.latest.profile_id,'child');assert.match(result.latest.reason,/首次作答/);assert.deepEqual(result,growth([l],[record(l,0)]));
});
test('rotations, mirrors, duplicate lesson IDs and duplicate evidence do not multiply a chess shape',()=>{
 const l=lesson(4),ls=[l,rotate(l),mirror(l)];const rs=ls.flatMap((item,i)=>[record(item,i),record(item,i+1,{attempt_no:2})]);const result=growth(ls,rs);assert.equal(result.summary.observed_shapes,1);assert.equal(result.summary.independent_shapes,1);assert.equal(result.badges.length,1);
});
test('an initial error or help blocks re-learning the same position via a new symmetry',()=>{
 for(const initial of [{correct:false},{assisted:true}]){const l=lesson(5),r=rotate(l),result=growth([l,r],[record(r,1),record(l,0,initial),record(l,2,{attempt_no:2})]);assert.equal(result.summary.observed_shapes,1);assert.equal(result.summary.independent_shapes,0);assert.equal(result.latest,null);}
});
test('base rotation families remain one even if translations are not full-board symmetries',()=>{
 const ls=builtins.filter(l=>l.family_id==='escape-1'),result=growth(ls,ls.map((l,i)=>record(l,i)));assert.equal(result.summary.independent_shapes,1);assert.equal(result.badges.length,1);
});
test('curated retired tactical cores and their representative remain one historical shape',()=>{
 const ls=builtins.filter(l=>['extra-doubleatari-01','extra-doubleatari-02','original-l3-01'].includes(l.id));assert.equal(ls.length,3);assert.equal(growth(ls,ls.map((l,i)=>record(l,i))).summary.independent_shapes,1);
});
test('50 genuinely distinct positions earn exact cumulative milestone badges without XP',()=>{
 const ls=catalog(),result=growth(ls,ls.map((l,i)=>record(l,i)));assert.equal(result.summary.independent_shapes,50);assert.deepEqual(result.badges.filter(b=>b.kind.startsWith('shapes_')).map(b=>b.shape_count),[5,10,25,50]);assert.equal(result.summary.ability.score,null);assert.equal('xp' in result.summary,false);
});
test('stable concept requires five independent positions across three actual dates',()=>{
 const ls=catalog().slice(0,5),sameDay=ls.map(l=>record(l,0));assert(!growth(ls,sameDay).badges.some(b=>b.kind==='concept_stable'));
 const records=ls.map((l,i)=>record(l,i===4?2:i%2));const badge=growth(ls,records).badges.find(b=>b.kind==='concept_stable');assert.equal(badge.date,'2026-10-03');assert.equal(badge.shape_count,5);assert.equal(badge.practice_dates,3);assert.match(badge.reason,/首次无帮助/);
});
test('knowledge variety requires at least two distinct positions in each of three concepts and two dates',()=>{
 const ls=Array.from({length:6},(_,i)=>lesson(i+1,{concept:['atari','ladder','snapback'][Math.floor(i/2)]}));const records=ls.map((l,i)=>record(l,i%2));assert(!growth(ls,records.slice(0,5)).badges.some(b=>b.kind==='variety'));assert(!growth(ls,records.map(r=>({...r,created_at:records[0].created_at}))).badges.some(b=>b.kind==='variety'));assert.equal(growth(ls,records).badges.filter(b=>b.kind==='variety').length,1);
});
test('profile selection rejects another learner and mixed input without selection stays unawarded',()=>{
 const l=lesson(2),parent=record(l,0,{profile_id:'parent'});assert.equal(growth([l],[parent]).summary.independent_shapes,0);assert.equal(growthFor([l],[parent,record(l,1)]).summary.needs_profile,true);assert.equal(growthFor([l],[parent,record(l,1)]).badges.length,0);assert.notEqual(growthFor([l],[parent],{profileId:'parent'}).latest.id,growth([l],[record(l)]).latest.id);
});
test('untagged legacy evidence remains usable only inside the caller-provided profile scope',()=>{
 const l=lesson(3),r=record(l);delete r.profile_id;delete r.attempt_no;assert.equal(growth([l],[r]).summary.independent_shapes,1);assert.equal(growth([l],[{...r,assisted:undefined}]).summary.independent_shapes,0);
});
test('invalid timestamps, assisted results, retries, unknown lessons and nonboolean grades never award',()=>{
 const l=lesson(1);for(const extra of [{created_at:'2026-02-30T12:00:00Z'},{created_at:'yesterday'},{created_at:undefined},{attempt_no:2},{correct:'true'},{assisted:'false'},{assisted:true},{lesson_id:'missing'}])assert.equal(growth([l],[record(l,0,extra)]).badges.length,0,JSON.stringify(extra));
});
test('first evidence cannot be replaced by a later correct or dated duplicate',()=>{
 const l=lesson(1);for(const first of [{correct:false},{assisted:true},{created_at:'unknown'}]){const records=[record(l,1),record(l,0,first),record(l,2,{attempt_no:2})];assert.equal(growth([l],records).badges.length,0);}
});
test('UTC events use a stable Chinese learning date and sort chronologically even if input is reversed',()=>{
 const ls=catalog().slice(0,5),records=ls.map((l,i)=>record(l,i,{created_at:`2026-10-01T${String(16+i).padStart(2,'0')}:00:00Z`}));const a=growth(ls,records),b=growth(ls,[...records].reverse());assert.deepEqual(a,b);assert.equal(a.badges.find(x=>x.kind==='first_solve').date,'2026-10-02');assert.equal(a.badges.find(x=>x.kind==='shapes_5').date,'2026-10-02');
});
test('compact indexes cannot claim a verified different position without board geometry',()=>{
 const compact={id:'compact',skill:'capture',concept:'atari',family_id:'one',size:9};const result=growth([compact],[record(compact)]);assert.equal(result.summary.independent_shapes,0);assert.equal(result.summary.observed_unverified,1);assert.equal(result.latest,null);
});
test('malformed or overlapping stones never become a verified shape',()=>{
 const l=lesson(1);for(const extra of [{stones:[]},{to_play:0},{size:13},{stones:[{x:9,y:0,color:1}]},{stones:[{x:1,y:1,color:1},{x:1,y:1,color:2}]}])assert.equal(growth([{...l,...extra}],[record(l)]).summary.independent_shapes,0);
});
test('the projection is pure and prior badge IDs survive unrelated later errors',()=>{
 const ls=catalog().slice(0,8),rs=ls.slice(0,5).map((l,i)=>record(l,i)),original=structuredClone({ls,rs});const before=growth(ls,rs),after=growth(ls,[...rs,record(ls[5],6,{correct:false}),record(ls[6],7,{assisted:true}),record(ls[0],8,{correct:false,attempt_no:2})]);assert.deepEqual({ls,rs},original);assert.deepEqual(after.badges,before.badges);const frozen=Object.freeze(ls);assert.deepEqual(growth(frozen,rs),before);assert.deepEqual(growth(frozen,[]).badges,[]);
});
test('replacement or mutable catalogs see corrected positions and do not reuse another learner cache',()=>{
 const a=lesson(1),b=lesson(2),ls=[a,b],rs=ls.map((l,i)=>record(l,i));assert.equal(growth(ls,rs).summary.independent_shapes,2);b.stones=structuredClone(a.stones);assert.equal(growth(ls,rs).summary.independent_shapes,1);assert.equal(growth(Object.freeze([a,lesson(2)]),rs).summary.independent_shapes,2);
});

test('contradictory duplicate evidence at the same timestamp is resolved conservatively',()=>{
 const l=lesson(1),good=record(l),bad=record(l,0,{correct:false}),helped=record(l,0,{assisted:true});
 for(const other of [bad,helped]){assert.equal(growth([l],[good,other]).badges.length,0);assert.deepEqual(growth([l],[good,other]),growth([l],[other,good]));}
});

test('same-shape different-ID ties prefer failure, help or retry before eligible success',()=>{
 const a=lesson(3,{id:'a-correct'}),b={...rotate(a),id:'z-other'};
 for(const timestamp of ['2026-10-01','2026-10-01T12:00:00Z'])for(const contradictory of [{correct:false},{assisted:true},{attempt_no:2}]){
  const records=[record(a,0,{created_at:timestamp}),record(b,0,{created_at:timestamp,...contradictory})];
  const result=growth([a,b],records);assert.equal(result.summary.observed_shapes,1);assert.equal(result.summary.independent_shapes,0);assert.equal(result.latest,null);
  assert.deepEqual(result,growth([b,a],[...records].reverse()));
 }
});
test('undated evidence precedes a dated same-shape success regardless of ID or input order',()=>{
 const a=lesson(3,{id:'a-correct'}),b={...mirror(a),id:'z-undated'};
 for(const unknownTime of [undefined,'unknown','2026-02-30T12:00:00Z'])for(const first of [{},{correct:false},{assisted:true},{attempt_no:2}]){
  const records=[record(a),record(b,0,{...first,created_at:unknownTime})],result=growth([a,b],records);
  assert.equal(result.summary.independent_shapes,0);assert.equal(result.latest,null);assert.deepEqual(result,growth([b,a],[...records].reverse()));
 }
});
