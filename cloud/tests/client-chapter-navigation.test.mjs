import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../static/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../static/index.html',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
const code=name=>{const i=declarations.findIndex(m=>m[1]===name);assert.ok(i>=0,`missing ${name}`);return source.slice(declarations[i].index,declarations[i+1]?.index??source.length);};
const lesson=(number,chapter='甲章',book='book-a',extra={})=>({id:`${book}-${number}`,study_path:{id:book,title:book,rank:1,role:'main',chapter,chapter_rank:1,number},...extra});
function element(){const classes=new Set();return {children:[],dataset:{},attributes:{},style:{props:{},setProperty(k,v){this.props[k]=v;}},hidden:false,disabled:false,open:false,textContent:'',className:'',
 classList:{add:c=>classes.add(c),contains:c=>classes.has(c),remove:c=>classes.delete(c)},
 replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};}
const FUNCTIONS=['lessonPath','sequentialCollection','sequentialChapter','compareStudyLessons','courseGroups','supplementaryRepresentatives','chapterDirectory','bookChapters','currentChapterNavigation',
 'questionNumber','chapterQuestionLabel','completedLessons','bookShortTitle','chapterDisplayName','chapterProgress','chapterRange','currentDirectoryLesson','defaultChapterKey','questionButtons',
 'selectChapterQuestion','moveChapterQuestion','toggleChapterQuestions','revealBrowsedQuestions','browseChapter','browseBook','renderChapterNavigation',
 'chooseLesson','selectLibraryBook','toggleLibraryChapter','bookNote','libraryChapterRow','renderLibrary','lessonFamily','canNavigatePractice'];
function client(items){
 const elements=new Map(),calls=[],views=[];const c=vm.createContext({lessons:items,state:{mode:'lesson',practice_mode:'recommended',lesson:items[0],completed_lesson_ids:[]},
 chapterDirectoryCache:null,chapterNavigationOpen:false,chapterNavigationKey:null,chapterBrowseKey:null,chapterPanelSignature:null,chapterGridItems:null,
 libraryBookId:null,libraryOpenKey:null,librarySignature:null,completedCache:{ids:null,set:new Set()},busy:false,busyAction:null,actionRequest:null,
 $:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},document:{createElement:element},textEl:(tag,text,className='')=>({...element(),textContent:text,className}),
 act:(type,extra)=>calls.push({type,...extra}),clearInspection:()=>{},showView:view=>views.push(view)});
 vm.runInContext(FUNCTIONS.map(code).join('\n'),c);
 return {c,calls,views,e:id=>c.$(id)};
}
const texts=nodes=>Array.from(nodes,n=>n.textContent);
const chipNames=e=>Array.from(e('chapter-list').children.filter(n=>n.className==='chapter-chip'),n=>n.children[0].textContent);

test('上一题/下一题 stay inside the chapter, while the panel may pick any chapter or book',()=>{
 const a=lesson(420),b=lesson(422),d=lesson(423,'乙章'),e=lesson(421,'甲章','book-b');const {c,calls}=client([b,d,e,a]);c.state.lesson=a;c.state.completed_lesson_ids=[b.id];
 assert.deepEqual(Array.from(c.currentChapterNavigation().items,l=>l.id),[a.id,b.id]);
 c.moveChapterQuestion(-1);assert.equal(calls.length,0);c.moveChapterQuestion(1);assert.deepEqual(calls,[{type:'lesson',id:b.id}]);
 c.state.lesson=b;c.moveChapterQuestion(1);assert.equal(calls.length,1);
 c.chapterNavigationOpen=true;c.selectChapterQuestion(d.id);assert.deepEqual(calls[1],{type:'lesson',id:d.id});assert.equal(c.chapterNavigationOpen,false);
 c.selectChapterQuestion(e.id);assert.deepEqual(calls[2],{type:'lesson',id:e.id});
 c.selectChapterQuestion('not-in-catalog');c.selectChapterQuestion(b.id);assert.equal(calls.length,3);
});
test('manual navigation works in every practice mode during AI/review/explanation; demo and ordinary writes disable it',()=>{
 const a=lesson(1),b=lesson(2);const {c,calls,e}=client([a,b]);
 for(const mode of ['recommended','sequential','review'])for(const action of [null,'ai_move','review_move']){c.state.practice_mode=mode;c.busy=!!action;c.busyAction=action;c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,false);c.moveChapterQuestion(1);}
 assert.equal(calls.length,9);assert.ok(calls.every(x=>x.type==='lesson'&&x.id===b.id));
 c.state.demo_active=true;c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);c.moveChapterQuestion(1);c.toggleChapterQuestions();assert.equal(c.chapterNavigationOpen,false);
 c.state.demo_active=false;c.busyAction='play';c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);c.moveChapterQuestion(1);assert.equal(calls.length,9);
 c.actionRequest={reply:true};c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,false);c.moveChapterQuestion(1);assert.equal(calls.length,10);
});
test('grid shows actual question numbers, the chapter position, the active question and solved marks',()=>{
 const a=lesson(419),b=lesson(420),d=lesson(422);const {c,calls,e}=client([d,a,b]);c.state.lesson=b;c.state.completed_lesson_ids=[a.id];c.renderChapterNavigation();
 assert.equal(e('chapter-current-question').textContent,'第 420 题');assert.equal(e('chapter-question-position').textContent,'2 / 3 · 选题');assert.equal(e('chapter-question-panel').hidden,true);
 c.toggleChapterQuestions();assert.equal(e('chapter-question-panel').hidden,false);assert.equal(e('chapter-question-toggle').attributes['aria-expanded'],'true');
 const buttons=e('chapter-question-grid').children;assert.deepEqual(texts(buttons),['419','420','422']);assert.equal(buttons[1].attributes['aria-current'],'true');
 assert.equal(buttons[0].classList.contains('is-done'),true);assert.equal(buttons[0].attributes['aria-label'],'第 419 题，已做对');assert.equal(buttons[2].classList.contains('is-done'),false);
 assert.equal(e('chapter-browse-title').textContent,'甲章 · 第 419–422 题 · 做对 1 / 3');
 c.renderChapterNavigation();assert.equal(e('chapter-question-grid').children,buttons,'unchanged renders keep the same buttons');
 buttons[2].onclick();assert.deepEqual(calls,[{type:'lesson',id:d.id}]);
 c.state.lesson=d;c.renderChapterNavigation();assert.equal(e('chapter-next').disabled,true);assert.equal(e('chapter-previous').disabled,false);
});
test('the panel browses later chapters and other books before choosing, with progress per chapter',()=>{
 const items=[lesson(1,'真眼假眼','life'),lesson(2,'真眼假眼','life'),lesson(43,'做眼','life'),lesson(44,'做眼','life'),lesson(73,'破眼','life'),lesson(241,'问吃','tesuji'),lesson(242,'问吃','tesuji'),lesson(277,'制造问吃','tesuji')];
 items.forEach((l,i)=>{l.study_path.chapter_rank=l.study_path.number;l.study_path.title=l.study_path.id==='life'?'死活专项训练（从入门到10级）':'手筋专项训练（从入门到10级）';l.study_path.rank=l.study_path.id==='life'?3:1;});
 const {c,calls,e}=client(items);c.state.lesson=items[1];c.state.completed_lesson_ids=[items[0].id,items[2].id,items[5].id,items[6].id];
 c.renderChapterNavigation();c.toggleChapterQuestions();
 assert.deepEqual(texts(e('chapter-book-tabs').children),['手筋 · 入门到10级','死活 · 入门到10级']);assert.equal(e('chapter-book-tabs').children[1].attributes['aria-pressed'],'true');
 assert.deepEqual(chipNames(e),['真眼假眼','做眼','破眼']);
 const chips=e('chapter-list').children;assert.equal(chips[0].classList.contains('is-current'),true);assert.equal(chips[0].children[1].textContent,'1/2');assert.equal(chips[0].attributes['aria-pressed'],'true');
 chips[1].onclick();assert.equal(calls.length,0,'browsing does not change the question');
 assert.deepEqual(texts(e('chapter-question-grid').children),['43','44']);assert.equal(e('chapter-browse-title').textContent,'做眼 · 第 43–44 题 · 做对 1 / 2');
 assert.equal(e('chapter-list').children[1].attributes['aria-pressed'],'true');
 e('chapter-question-grid').children[1].onclick();assert.deepEqual(calls,[{type:'lesson',id:items[3].id}]);assert.equal(c.chapterNavigationOpen,false);
 c.toggleChapterQuestions();e('chapter-book-tabs').children[0].onclick();
 assert.deepEqual(chipNames(e),['问吃','制造问吃']);assert.deepEqual(texts(e('chapter-question-grid').children),['277'],'another book opens at its first unfinished chapter');
 assert.equal(e('chapter-list').children[0].classList.contains('is-done'),true);
});
test('supplementary chapters sit under their own label and are numbered inside the chapter',()=>{
 const main=lesson(241,'问吃','book-a'),s1=lesson(9,'配套','book-a',{id:'escape-1-9'}),s2=lesson(9,'配套','book-a',{id:'escape-2-9'});for(const s of [s1,s2]){s.study_path={...s.study_path,role:'supplement',chapter:'数气与救棋',chapter_rank:10};}
 const {c,e}=client([main,s1,s2]);c.renderChapterNavigation();c.toggleChapterQuestions();
 const nodes=e('chapter-list').children;assert.deepEqual(nodes.map(n=>n.textContent||n.children[0]?.textContent),['问吃','配套巩固','数气与救棋']);
 nodes[2].onclick();assert.deepEqual(texts(e('chapter-question-grid').children),['1','2']);assert.equal(e('chapter-browse-title').textContent,'数气与救棋 · 2 题 · 做对 0 / 2');
});
test('catalog cache survives renders and invalidates on replacement including updated metadata',()=>{
 const a=lesson(1);const {c}=client([a]);const directory=c.chapterDirectory(),books=c.bookChapters(),nav=c.currentChapterNavigation();
 c.courseGroups=()=>{throw new Error('should use cached catalog');};for(let i=0;i<5;i++){c.renderChapterNavigation();c.renderLibrary();assert.equal(c.chapterDirectory(),directory);assert.equal(c.bookChapters(),books);assert.equal(c.currentChapterNavigation(),nav);}
 vm.runInContext(code('courseGroups'),c);c.lessons=[a,lesson(2)];assert.notEqual(c.chapterDirectory(),directory);assert.equal(c.currentChapterNavigation().items.length,2);
});
test('selected supplementary rotation stays in its own chapter while unused duplicates stay collapsed',()=>{
 const base=lesson(1,'倒扑','book-a',{id:'family-1',base_id:'family',variant:1});base.study_path.role='supplement';const rotation={...base,id:'family-3',variant:3};const other={...base,id:'family-2',variant:2};const next={...base,id:'next-1',base_id:'next',study_path:{...base.study_path,number:2}};
 const {c}=client([base,other,rotation,next]);c.state.lesson=rotation;assert.deepEqual(Array.from(c.currentChapterNavigation().items,l=>l.id),[base.id,rotation.id,next.id]);assert.equal(c.currentChapterNavigation().index,1);
});
test('free games hide and reset quick navigation; switching chapters collapses the panel',()=>{
 const a=lesson(1),b=lesson(2,'乙章');const {c,e}=client([a,b]);c.renderChapterNavigation();c.toggleChapterQuestions();c.state.lesson=b;c.renderChapterNavigation();assert.equal(c.chapterNavigationOpen,false);assert.equal(e('chapter-question-panel').hidden,true);
 c.toggleChapterQuestions();c.state.mode='human-ai';c.renderChapterNavigation();assert.equal(e('chapter-navigation').hidden,true);assert.equal(e('chapter-question-grid').children.length,0);assert.equal(c.chapterGridItems,null);assert.equal(c.chapterNavigationKey,null);assert.equal(c.chapterBrowseKey,null);
});
test('library lists books and chapters with progress, opens the current chapter and starts questions directly',()=>{
 const items=[lesson(1,'真眼假眼','life'),lesson(2,'真眼假眼','life'),lesson(43,'做眼','life'),lesson(44,'做眼','life'),lesson(241,'问吃','tesuji')];
 items.forEach(l=>{l.study_path.chapter_rank=l.study_path.number;l.study_path.title=l.study_path.id==='life'?'死活专项训练（从入门到10级）':'手筋专项训练（从入门到10级）';l.study_path.rank=l.study_path.id==='life'?3:1;});
 const {c,calls,views,e}=client(items);c.state.lesson=items[1];c.state.completed_lesson_ids=[items[0].id];c.renderLibrary();
 const books=e('library-books').children;assert.deepEqual(books.map(b=>b.children[0].textContent),['1. 手筋专项训练（从入门到10级）','3. 死活专项训练（从入门到10级）']);
 assert.equal(books[1].attributes['aria-pressed'],'true');assert.equal(books[1].children[1].textContent,'做对 1 / 4 题 · 2 章');assert.equal(books[1].children[2].style.props['--done'],'0.25');
 const rows=e('library-chapters').children;assert.equal(rows.length,2);assert.equal(rows[0].classList.contains('is-current'),true);
 assert.deepEqual(rows[0].children[0].children.slice(0,3).map(n=>n.textContent),['真眼假眼','第 1–2 题','正在练 · 做对 1 / 2']);assert.equal(rows[0].children[0].attributes['aria-expanded'],'true');assert.equal(rows[1].children.length,1);
 const [start,grid]=rows[0].children[1].children;assert.equal(start.textContent,'从第 2 题开始 →');start.onclick();assert.deepEqual(views,['board'],'the current question just returns to the board');assert.equal(calls.length,0);
 rows[1].children[0].onclick();const opened=e('library-chapters').children[1];assert.equal(opened.children[0].attributes['aria-expanded'],'true');assert.equal(e('library-chapters').children[0].children.length,1);
 opened.children[1].children[1].children[1].onclick();assert.deepEqual(calls,[{type:'lesson',id:items[3].id}]);
 assert.equal(grid.children[0].classList.contains('is-done'),true);
 books[0].onclick();assert.deepEqual(e('library-chapters').children.map(r=>r.children[0].children[0].textContent),['问吃']);assert.equal(e('library-chapters').children[0].children[0].attributes['aria-expanded'],'true');
 c.state.demo_active=true;c.renderLibrary();e('library-chapters').children[0].children[1].children[0].onclick();assert.equal(calls.length,1);assert.equal(e('library-chapters').children[0].children[1].children[0].disabled,true);
});
test('library keeps supplements optional and skips rebuilding when nothing changed',()=>{
 const main=lesson(241,'问吃','beginner-tesuji'),s=lesson(9,'配套','beginner-tesuji',{id:'escape-1-9'});s.study_path={...s.study_path,role:'supplement',chapter:'数气与救棋',chapter_rank:10};
 const {c,e}=client([main,s]);c.renderLibrary();assert.equal(e('library-supplements').hidden,false);assert.equal(e('library-supplement-count').textContent,'1 组');
 assert.equal(e('library-chapters').children.length,1);assert.equal(e('library-supplement-chapters').children.length,1);assert.match(e('book-study-note').textContent,/当前已收录第241–241题，前240题尚未入库/);
 const before=e('library-chapters').children;c.renderLibrary();assert.equal(e('library-chapters').children,before);
 c.state.completed_lesson_ids=[main.id];c.renderLibrary();assert.notEqual(e('library-chapters').children,before);
});
test('logout clears private chapter labels, cached lessons, panel and library; the old dropdown filters are gone',()=>{
 const clear=code('clearPrivateUI');for(const pattern of [/chapterDirectoryCache=null/,/chapterGridItems=null/,/librarySignature=null/,/libraryBookId=null/,/completedCache=\{ids:null/,/'chapter-question-grid'/,/'library-chapters'/,/'chapter-list'/,/\$\('chapter-navigation'\)\.hidden=true/,/\$\('chapter-question-panel'\)\.hidden=true/])assert.match(clear,pattern);
 for(const id of ['skill-select','difficulty-select','lesson-select','book-select','chapter-select','library-chapter-select','include-supplements','start-skill'])assert.doesNotMatch(html,new RegExp(`id="${id}"`));
 for(const id of ['chapter-question-panel','chapter-book-tabs','chapter-list','chapter-browse-title','chapter-question-grid','library-books','library-chapters','library-supplements','library-supplement-count','library-supplement-chapters','book-study-note'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/aria-controls="chapter-question-panel"/);
});
