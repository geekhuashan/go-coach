import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const lesson=(number,chapter='甲章',book='book-a',extra={})=>({id:`${book}-${number}`,study_path:{id:book,title:book,rank:1,role:'main',chapter,chapter_rank:1,number},...extra});
function element(){return {children:[],dataset:{},attributes:{},hidden:false,disabled:false,textContent:'',replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};}
function client(items){
 const elements=new Map(),calls=[];const c=vm.createContext({lessons:items,state:{mode:'lesson',practice_mode:'recommended',lesson:items[0]},chapterDirectoryCache:null,chapterNavigationOpen:false,chapterNavigationKey:null,chapterGridItems:null,busy:false,busyAction:null,
 $:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},document:{createElement:element},textEl:(tag,text)=>({...element(),textContent:text}),act:(type,extra)=>calls.push({type,...extra})});
 vm.runInContext(['lessonPath','sequentialCollection','sequentialChapter','compareStudyLessons','courseGroups','supplementaryRepresentatives','chapterDirectory','bookChapters','currentChapterNavigation','chapterQuestionLabel','selectChapterQuestion','moveChapterQuestion','toggleChapterQuestions','renderChapterNavigation','renderChapterPicker','lessonFamily','canNavigatePractice'].map(code).join('\n'),c);
 return {c,calls,e:id=>c.$(id)};
}
test('chapter neighbors retain source order and completed questions, honor gaps, never cross book/chapter',()=>{
 const a=lesson(420),b=lesson(422),d=lesson(423,'乙章'),e=lesson(421,'甲章','book-b');const {c,calls}=client([b,d,e,a]);c.state.lesson=a;c.state.completed_lesson_ids=[b.id];
 assert.deepEqual(Array.from(c.currentChapterNavigation().items,l=>l.id),[a.id,b.id]);
 c.moveChapterQuestion(-1);assert.equal(calls.length,0);c.moveChapterQuestion(1);assert.deepEqual(calls,[{type:'lesson',id:b.id}]);
 c.state.lesson=b;c.moveChapterQuestion(1);c.selectChapterQuestion(d.id);c.selectChapterQuestion(e.id);assert.equal(calls.length,1);c.moveChapterQuestion(-1);assert.equal(calls[1].id,a.id);
});
test('manual navigation works in every practice mode during AI/review/explanation; demo and ordinary writes disable it',()=>{
 const a=lesson(1),b=lesson(2);const {c,calls,e}=client([a,b]);
 for(const mode of ['recommended','sequential','review'])for(const action of [null,'ai_move','review_move']){c.state.practice_mode=mode;c.busy=!!action;c.busyAction=action;c.renderChapterPicker();assert.equal(e('chapter-picker').hidden,false);c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,false);c.moveChapterQuestion(1);}
 assert.equal(calls.length,9);assert.ok(calls.every(x=>x.type==='lesson'&&x.id===b.id));
 c.state.demo_active=true;c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);c.moveChapterQuestion(1);c.toggleChapterQuestions();assert.equal(c.chapterNavigationOpen,false);
 c.state.demo_active=false;c.busyAction='play';c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);c.moveChapterQuestion(1);assert.equal(calls.length,9);
});
test('grid shows actual question number and chapter position with active question, supports direct choice',()=>{
 const a=lesson(419),b=lesson(420),d=lesson(422);const {c,calls,e}=client([d,a,b]);c.state.lesson=b;c.renderChapterNavigation();
 assert.equal(e('chapter-current-question').textContent,'第 420 题');assert.equal(e('chapter-question-position').textContent,'2 / 3 · 选题');
 c.toggleChapterQuestions();assert.equal(e('chapter-question-grid').hidden,false);assert.equal(e('chapter-question-toggle').attributes['aria-expanded'],'true');
 const buttons=e('chapter-question-grid').children;assert.deepEqual(Array.from(buttons,b=>b.textContent),['419','420','422']);assert.equal(buttons[1].attributes['aria-current'],'true');buttons[2].onclick();assert.deepEqual(calls,[{type:'lesson',id:d.id}]);
 c.state.lesson=d;c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);assert.equal(e('chapter-previous').disabled,false);assert.equal(e('chapter-question-grid').children,buttons);
});
test('catalog cache survives renders and invalidates on replacement including updated metadata',()=>{
 const a=lesson(1);const {c}=client([a]);const directory=c.chapterDirectory(),books=c.bookChapters(),nav=c.currentChapterNavigation();
 c.courseGroups=()=>{throw new Error('should use cached catalog');};for(let i=0;i<5;i++){c.renderChapterPicker();c.renderChapterNavigation();assert.equal(c.chapterDirectory(),directory);assert.equal(c.bookChapters(),books);assert.equal(c.currentChapterNavigation(),nav);}
 vm.runInContext(code('courseGroups'),c);c.lessons=[a,lesson(2)];assert.notEqual(c.chapterDirectory(),directory);assert.equal(c.currentChapterNavigation().items.length,2);
});
test('selected supplementary rotation stays in its own chapter while unused duplicates stay collapsed',()=>{
 const base=lesson(1,'倒扑','book-a',{id:'family-1',base_id:'family',variant:1});base.study_path.role='supplement';const rotation={...base,id:'family-3',variant:3};const other={...base,id:'family-2',variant:2};const next={...base,id:'next-1',base_id:'next',study_path:{...base.study_path,number:2}};
 const {c}=client([base,other,rotation,next]);c.state.lesson=rotation;assert.deepEqual(Array.from(c.currentChapterNavigation().items,l=>l.id),[base.id,rotation.id,next.id]);assert.equal(c.currentChapterNavigation().index,1);
});
test('free games hide and reset quick navigation; switching chapters collapses question grid',()=>{
 const a=lesson(1),b=lesson(2,'乙章');const {c,e}=client([a,b]);c.renderChapterNavigation();c.toggleChapterQuestions();c.state.lesson=b;c.renderChapterNavigation();assert.equal(c.chapterNavigationOpen,false);
 c.toggleChapterQuestions();c.state.mode='human-ai';c.renderChapterNavigation();assert.equal(e('chapter-navigation').hidden,true);assert.equal(e('chapter-question-grid').children.length,0);assert.equal(c.chapterGridItems,null);assert.equal(c.chapterNavigationKey,null);
});
test('logout clears private chapter labels, cached lessons and grid; chapter selector handler has no sequential-only guard',()=>{
 const clear=code('clearPrivateUI');assert.match(clear,/chapterDirectoryCache=null/);assert.match(clear,/chapterGridItems=null/);assert.match(clear,/'chapter-question-grid'\]/);assert.match(clear,/\$\('chapter-navigation'\)\.hidden=true/);
 const start=source.indexOf("$('chapter-select').onchange=()=>{");const handler=source.slice(start,source.indexOf('\n};',start));assert.doesNotMatch(handler,/practice_mode/);assert.match(handler,/act\('lesson',\{id\}\)/);
});
