import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const constant=name=>source.match(new RegExp(`^const ${name}=[\\s\\S]*?\\n\\};?$|^const ${name}=.*;$`,'m'))[0];
const videos=JSON.parse(readFileSync(new URL('../../static/teaching-videos.json',import.meta.url),'utf8'));
const studyPathSource=readFileSync(new URL('../study-path.mjs',import.meta.url),'utf8');
const chapters=vm.runInNewContext('('+studyPathSource.match(/^const chapters=(\{[\s\S]*?\n\});$/m)[1]+')');
const c=vm.createContext({});
vm.runInContext([constant('chapterVideoConcepts').replace(/^const /,'var '),code('videoTags'),code('problemTeachingVideos'),code('relatedTeachingVideos')].join('\n'),c);
const related=lesson=>Array.from(c.relatedTeachingVideos(lesson,videos),v=>v.id);
const concepts=id=>videos.find(v=>v.id===id).concepts;
const answers=(book,number)=>Array.from(c.problemTeachingVideos({study_path:{id:book,role:'main',number}},videos),v=>v.id);

test('every chapter of the three books has an explicit video mapping backed by the catalog',()=>{
 const known=new Set(videos.flatMap(v=>v.concepts));
 for(const [book,list] of Object.entries(chapters))for(const [chapter] of list){
  const mapped=c.chapterVideoConcepts[chapter];
  assert.ok(Array.isArray(mapped),`${book} · ${chapter} 没有视频映射`);
  for(const concept of mapped)assert.ok(known.has(concept),`${chapter} 映射的 ${concept} 没有视频`);
  const ids=related({concept:chapter,skill:'tsumego'});
  assert.equal(ids.length>0,mapped.length>0,`${chapter} 推荐数量与映射不符`);
  for(const id of ids)assert.ok(concepts(id).some(x=>mapped.includes(x)),`${chapter} 推荐了无关视频 ${id}`);
 }
});
test('a 做眼 problem no longer falls back to unrelated tsumego videos',()=>{
 const ids=related({concept:'做眼',skill:'tsumego'});
 assert.equal(ids.length,3);assert.ok(ids.every(id=>concepts(id).includes('make_eyes')));assert.ok(!ids.includes('net'));
 assert.ok(related({concept:'破眼',skill:'tsumego'}).every(id=>concepts(id).includes('destroy_eyes')));
 assert.deepEqual(related({concept:'综合运用',skill:'tsumego'}),[]);
});
test('ties prefer different authors and lessons without a concept keep the skill fallback',()=>{
 const authors=related({concept:'二气杀二气',skill:'tsumego'}).map(id=>videos.find(v=>v.id===id).author);
 assert.equal(new Set(authors).size,3);
 assert.ok(related({skill:'escape'}).length>0);
 assert.ok(related({skill:'tsumego'}).every(id=>concepts(id).some(x=>['life_shapes','eyes'].includes(x))));
});
test('catalog entries are unique and play only from the private video route',()=>{
 assert.equal(new Set(videos.map(v=>v.id)).size,videos.length);
 for(const v of videos){
  assert.equal(v.playback_url,`/api/videos/${v.id}.mp4`);assert.match(v.url,/^https:\/\/www\.bilibili\.com\/video\/BV\w+\/(\?p=\d+)?$/);
  if(v.problems){assert.ok(Object.hasOwn(chapters,v.book));assert.ok(v.problems[0]<=v.problems[1]);assert.deepEqual(v.concepts,[]);}else assert.ok(v.concepts.length>0);
 }
});
test('per-problem explanations match only their own book and problem, never by concept',()=>{
 assert.ok(answers('intermediate-tesuji',1).length>0);
 for(let n=1;n<=768;n++)if(n!==421)assert.ok(answers('intermediate-tesuji',n).length>0,`第二本第 ${n} 题没有逐题讲解`);
 assert.deepEqual(answers('beginner-life',65),[]);assert.ok(answers('beginner-life',403).length>0);
 assert.deepEqual(answers('beginner-tesuji',403),[]);
 assert.deepEqual(Array.from(c.problemTeachingVideos({study_path:{id:'intermediate-tesuji',role:'supplement',number:5}},videos)),[]);
 for(const [chapter] of Object.values(chapters).flat())for(const id of related({concept:chapter,skill:'tsumego'}))assert.ok(!videos.find(v=>v.id===id).problems,`${chapter} 按概念推荐了逐题讲解 ${id}`);
});
