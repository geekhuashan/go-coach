import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../builtin-lessons.json' with {type:'json'};
import curation from '../../data/original-extra/curation.json' with {type:'json'};
import {availableLesson,learning,practice,recommend,validateLesson} from '../curriculum.mjs';

test('retired filler remains loadable for history but never appears in next or review selection',()=>{
 const byId=new Map(catalog.map(l=>[l.id,l]));
 assert.equal(Object.keys(curation.retired).length,77);
 for(const [id,{representative}]of Object.entries(curation.retired)){
  assert.ok(byId.has(id));assert.equal(availableLesson(byId.get(id)),false);assert.ok(availableLesson(byId.get(representative)));
 }
 const evidence=[{lesson_id:'extra-net-15',correct:true,assisted:false,attempt_no:1}];
 const stats=learning(catalog,evidence);assert.equal(stats.independent_correct,1);
 assert.ok(availableLesson(recommend(catalog,evidence,stats,evidence)));
 const ctx={catalog,evidence,completed:[],helped:['extra-net-15'],runs:{}};
 assert.equal(practice(ctx,'extra-net-15','review').review_count,0);
 assert.ok(availableLesson(byId.get(practice(ctx,'extra-net-15','sequential',true).next_id)));
});
test('every selected original branch validates in cloud rules, including two new shapes',()=>{
 const lessons=catalog.filter(l=>availableLesson(l)&&l.source?.kind==='original');assert.equal(lessons.length,43);
 for(const l of lessons)assert.equal(validateLesson(l).id,l.id);
 assert.equal(lessons.find(l=>l.id==='original-diverse-snapback-center').tree.children.length,2);
 assert.ok(lessons.some(l=>l.id==='original-diverse-edge-turn'));
});
