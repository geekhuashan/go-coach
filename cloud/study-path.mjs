// Presentation/navigation metadata only. Never rewrite source, lesson IDs or learning evidence.
export const STUDY_PATHS=Object.freeze([
 {id:'beginner-tesuji',title:'手筋专项训练（从入门到10级）',rank:1},
 {id:'intermediate-tesuji',title:'手筋专项训练（从10级到5级）',rank:2},
 {id:'beginner-life',title:'死活专项训练（从入门到10级）',rank:3},
]);
const normalizedTitle=value=>String(value||'').replace(/[\s（）()《》]/g,'');
const chapters={
 'beginner-tesuji':[['问吃',241],['制造问吃',277],['枷吃',307],['制造枷吃',367],['逃子',385],['杀棋',409],['倒扑',469],['制造倒扑',499],['接不归',505],['倒扑和接不归',541],['滚打包收',619],['吃一线子',625],['吃二线子',655],['吃三线子',667],['反击错着',709],['综合运用',763]],
 'intermediate-tesuji':[['二气杀二气',1],['二气杀多气',31],['三气杀三气',55],['有眼杀无眼',187],['实战常形',253],['综合运用',265],['滚打包收',319],['金鸡独立',427],['老鼠偷油',481],['大头鬼',505],['倒脱靴',535],['摆脱对杀',541],['二气的对杀',559],['延气对杀',565],['连接',613],['分断',667],['靠单',697],['宽征',715]],
 'beginner-life':[['真眼假眼',1],['做眼',43],['破眼',73],['判断真眼假眼（一至十）',115],['判断真眼假眼（十一至十二）',175],['判断真眼假眼（十三）',187],['做完整眼',193],['三格眼位',217],['四格眼位',265],['五格六格眼位',295],['直四曲四',313],['做眼综合运用',337],['胀死牛',403],['扩大眼位',433],['占据要点',451],['综合测试',469],['判断活棋死棋',499]],
};
const supplementConcepts={double_atari:['双打吃',201],ladder:['征吃',202],net:['枷吃',307],gate:['门吃',203],edge_chase:['吃一线子',625],snapback:['倒扑',469],connection_trap:['接不归',505],hug:['抱吃',204],wedge:['挖吃',205],atari:['打吃',200]};
const supplementSkills={escape:['数气与救棋',10],capture:['打吃与提子',20],connect:['连接基础',30],cut:['分断基础',40]};
export function studyProblemNumber(lesson){const digits=String(lesson?.source?.problem||'').match(/\d+/g)||String(lesson?.id||'').match(/\d+/g);return digits?Number(digits.at(-1)):0;}
export function studyPath(lesson){
 if(!lesson)return null;
 const source=lesson.source||{},number=studyProblemNumber(lesson),path=source.kind==='book'?STUDY_PATHS.find(p=>normalizedTitle(p.title)===normalizedTitle(source.title)):null;
 if(path){const chapter=lesson.concept||chapters[path.id].findLast(([,start])=>number>=start)?.[0]||'练习';return {...path,role:'main',chapter,chapter_rank:chapters[path.id].find(([title])=>title===chapter)?.[1]??number,number};}
 if(source.kind==='licensed'&&(/go\s*game\s*guru/i.test(source.title||'')||/^ggg-/.test(lesson.id||'')))return {id:'gogameguru',title:'Go Game Guru',rank:99,role:'extra',chapter:({3:'基础',4:'进阶',5:'挑战'})[lesson.difficulty]||'练习',chapter_rank:lesson.difficulty||99,number};
 const base=/^(escape|capture|connect|cut)-[12]-\d+$/.test(lesson.id||''),original=source.kind==='original'&&/^(tactic-|original-)/.test(lesson.id||'');
 if(base||original){const [chapter,chapter_rank]=supplementConcepts[lesson.concept]||supplementSkills[lesson.skill]||['基础巩固',50];return {...STUDY_PATHS[0],role:'supplement',chapter,chapter_rank,number};}
 return null;
}
function comparePaths(a,b,x,y){return (x?.rank??100)-(y?.rank??100)||((x?.role==='extra'&&y?.role==='extra')?(x.chapter_rank-y.chapter_rank):0)||(x?.number??0)-(y?.number??0)||a.id.localeCompare(b.id);}
export function studyCompare(a,b){return comparePaths(a,b,studyPath(a),studyPath(b));}
// Worker catalog snapshots are immutable and replaced when any D1 lesson text
// changes. Cache only their ordering metadata, never learner state or completion.
const studyIndexes=new WeakMap();
function studyIndex(catalog){
 const cached=Object.isFrozen(catalog)&&studyIndexes.get(catalog);if(cached)return cached;
 const paths=new Map(catalog.map(l=>{const path=studyPath(l);return [l,path?Object.freeze(path):null]})),byId=new Map(catalog.map(l=>[l.id,l]));
 const compare=(a,b)=>comparePaths(a,b,paths.get(a),paths.get(b));
 const main=Object.freeze(catalog.filter(l=>paths.get(l)?.role==='main').sort(compare));
 const collections=new Map();for(const l of catalog){const path=paths.get(l);if(!path||!['main','extra'].includes(path.role))continue;if(!collections.has(path.id))collections.set(path.id,[]);collections.get(path.id).push(l);}
 for(const [id,lessons]of collections)collections.set(id,Object.freeze(lessons.sort(compare)));
 const index={paths,byId,main,collections};if(Object.isFrozen(catalog))studyIndexes.set(catalog,index);return index;
}
// Callers supply the available catalog. Completed IDs come from any successful
// attempt, not first-attempt evidence (a first failure can later be completed).
export function studyScope(catalog,currentId,completedIds=[]){
 const {paths,byId,main,collections}=studyIndex(catalog);
 if(!main.length)return null; // Keep legacy behavior when the three books are absent.
 const completed=new Set(completedIds),current=byId.get(currentId),currentPath=paths.get(current);
 if(currentPath?.role==='extra')return {path:currentPath,main,lessons:collections.get(currentPath.id),completed,explicit_extra:true};
 // Unrelated hand-imported books keep their existing isolated sequence.
 if(current?.source?.kind==='book'&&!currentPath)return null;
 const remaining=main.filter(l=>!completed.has(l.id));
 let target=currentPath?.role==='main'?remaining.find(l=>paths.get(l).id===currentPath.id):null;
 if(!target&&currentPath?.role==='main')target=remaining.find(l=>paths.get(l).rank>currentPath.rank);
 target||=remaining[0];const active=target?paths.get(target):null;
 return {path:active,main,lessons:active?collections.get(active.id):[],completed,explicit_extra:false};
}
