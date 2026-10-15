import curation from '../data/original-extra/curation.json' with {type:'json'};

const METHOD='family-go-growth-v1';
const SKILLS={escape:'救棋与数气',capture:'打吃与提子',connect:'连接棋块',cut:'分断',life:'死活与计算',tsumego:'死活与手筋'};
const CONCEPTS={double_atari:'双打吃',ladder:'征吃',snapback:'倒扑',connection_trap:'接不归',edge_chase:'边线追吃',capture_race:'对杀',atari:'打吃',net:'枷吃',gate:'门吃',hug:'抱吃',wedge:'挖吃'};
const DAY=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const indexes=new WeakMap();
const lexical=(a,b)=>a<b?-1:a>b?1:0;

// Positions are compared under the eight symmetries of the complete board.
// Keep edge distances: moving an edge problem into the centre can change it.
function positionKey(lesson){
 const size=lesson.size??9,turn=lesson.to_play,stones=lesson.stones;
 if(![9,19].includes(size)||![1,2].includes(turn)||!Array.isArray(stones)||!stones.length||stones.length>=size*size)return null;
 const seen=new Set();
 for(const p of stones){if(!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.y<0||p.x>=size||p.y>=size||![1,2].includes(p.color)||seen.has(`${p.x},${p.y}`))return null;seen.add(`${p.x},${p.y}`);}
 const variants=[];
 for(const mirror of [false,true])for(let rotations=0;rotations<4;rotations++){
  variants.push(stones.map(p=>{let x=mirror?size-1-p.x:p.x,y=p.y;for(let r=0;r<rotations;r++)[x,y]=[size-1-y,x];return `${y*size+x}:${p.color}`;}).sort().join(','));
 }
 return `${size}:${turn}:${variants.sort()[0]}`;
}
function catalogIndex(catalog){
 const cached=Object.isFrozen(catalog)&&indexes.get(catalog);if(cached)return cached;
 const lessons=new Map(catalog.filter(l=>l&&typeof l.id==='string').map(l=>[l.id,l])),parents=new Map([...lessons.keys()].map(id=>[id,id]));
 const find=id=>{let root=id;while(parents.get(root)!==root)root=parents.get(root);while(parents.get(id)!==id){const next=parents.get(id);parents.set(id,root);id=next;}return root;};
 const join=(a,b)=>{if(!parents.has(a)||!parents.has(b))return;const x=find(a),y=find(b);if(x!==y)parents.set(lexical(x,y)<0?y:x,lexical(x,y)<0?x:y);};
 const positions=new Map(),families=new Map(),verified=new Set();
 for(const l of lessons.values()){
  const key=positionKey(l);if(key){verified.add(l.id);if(positions.has(key))join(l.id,positions.get(key));else positions.set(key,l.id);}
  if(typeof l.family_id==='string'&&l.family_id){if(families.has(l.family_id))join(l.id,families.get(l.family_id));else families.set(l.family_id,l.id);}
 }
 for(const [id,entry]of Object.entries(curation.retired))join(id,entry.representative);
 const groups=new Map([...lessons.keys()].map(id=>[id,find(id)]));
 const result={lessons,groups,verified};if(Object.isFrozen(catalog))indexes.set(catalog,result);return result;
}
function recordTime(record){
 const value=record.created_at;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))return null;
 const [year,month,day]=value.slice(0,10).split('-').map(Number);
 if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
 const stamp=Date.parse(value.length===10?`${value}T00:00:00+08:00`:value.replace(' ','T'));
 return Number.isFinite(stamp)?{stamp,earned_at:new Date(stamp).toISOString(),date:DAY.format(stamp)}:null;
}
const conceptFor=l=>({id:l.concept?`concept:${l.skill}:${l.concept}`:`skill:${l.skill}`,label:CONCEPTS[l.concept]||l.concept||SKILLS[l.skill]||'围棋基础'});
const attemptNo=r=>r.attempt_no===undefined?1:r.attempt_no;
function earlier(a,b){
 // Invalid dates cannot establish when a badge was earned. Put them first so
 // a later dated duplicate cannot silently replace missing original evidence.
 // Equal timestamps do not establish which rotated variant came first. Prefer
 // failure, help, or a retry before an eligible success; use IDs only last.
 return (a.time?.stamp??-Infinity)-(b.time?.stamp??-Infinity)||(a.record.correct===true?1:0)-(b.record.correct===true?1:0)||(a.record.assisted===false?1:0)-(b.record.assisted===false?1:0)||(attemptNo(a.record)===1?1:0)-(attemptNo(b.record)===1?1:0)||lexical(a.record.lesson_id,b.record.lesson_id);
}

// The Worker already scopes its evidence query by household and profile. An
// explicit profileId additionally rejects another profile's tagged records;
// untagged historical records remain usable from that already-scoped query.
// This projection never edits attempts, first-attempt evidence, or book order.
export function growthFor(catalog=[],evidence=[],{profileId=null}={}){
 const {lessons,groups,verified}=catalogIndex(catalog),tagged=new Set(evidence.filter(r=>r&&typeof r.profile_id==='string').map(r=>r.profile_id));
 const ambiguous=profileId===null&&tagged.size>1;
 const selected=ambiguous?[]:evidence.filter(r=>r&&lessons.has(r.lesson_id)&&typeof r.correct==='boolean'&&(!profileId||!r.profile_id||r.profile_id===profileId));
 const effectiveProfile=profileId??(tagged.size===1?[...tagged][0]:null),firstByLesson=new Map();
 for(const record of selected){
  const item={record,time:recordTime(record)},before=firstByLesson.get(record.lesson_id);
  if(!before||attemptNo(record)<attemptNo(before.record)||(attemptNo(record)===attemptNo(before.record)&&earlier(item,before)<0))firstByLesson.set(record.lesson_id,item);
 }
 const firstByShape=new Map();let observedUnverified=0;
 for(const item of firstByLesson.values()){
  if(!verified.has(item.record.lesson_id)){observedUnverified++;continue;}
  const shape=groups.get(item.record.lesson_id),before=firstByShape.get(shape);
  if(!before||earlier(item,before)<0)firstByShape.set(shape,item);
 }
 const observed=[...firstByShape.values()].sort(earlier),independent=observed.filter(({record,time})=>time&&record.correct===true&&record.assisted===false&&attemptNo(record)===1);
 const profilePart=encodeURIComponent(effectiveProfile??'current'),badges=[],counts=new Map(),dates=new Set();
 const add=(kind,title,icon,item,reason,extra={})=>badges.push({id:`growth:go:${profilePart}:${kind}${extra.concept_id?':'+encodeURIComponent(extra.concept_id):''}`,subject:'go',scope:'profile',profile_id:effectiveProfile,kind,title,label:title,description:reason,reason,icon,date:item.time.date,earned_at:item.time.earned_at,...extra});
 for(let i=0;i<independent.length;i++){
  const item=independent[i],count=i+1,concept=conceptFor(lessons.get(item.record.lesson_id));dates.add(item.time.date);
  if(!counts.has(concept.id))counts.set(concept.id,{...concept,independent_shapes:0,dates:new Set()});const entry=counts.get(concept.id);entry.independent_shapes++;entry.dates.add(item.time.date);
  if(count===1)add('first_solve','自己想出来啦','🌱',item,'第一次在未使用帮助的首次作答中，独立完成一个不同棋型。',{shape_count:1});
  if([5,10,25,50].includes(count))add(`shapes_${count}`,`${count}个棋型小脚印`,'⭐',item,`已在首次作答中独立完成${count}个不同棋型；旋转、镜像与同家族变体合并计算。`,{shape_count:count});
  if(entry.independent_shapes>=5&&entry.dates.size>=3&&!badges.some(b=>b.kind==='concept_stable'&&b.concept_id===concept.id))add('concept_stable',`${concept.label}在进步`,'🏅',item,`在${entry.dates.size}个不同日期，首次无帮助完成${entry.independent_shapes}个${concept.label}棋型。`,{concept_id:concept.id,shape_count:entry.independent_shapes,practice_dates:entry.dates.size});
  const varied=[...counts.values()].filter(c=>c.independent_shapes>=2);
  if(varied.length>=3&&dates.size>=2&&!badges.some(b=>b.kind==='variety'))add('variety','会想不同的办法啦','🌟',item,'已在至少2个日期，独立完成3个知识点各至少2个不同棋型。',{concept_count:3});
 }
 badges.sort((a,b)=>lexical(a.earned_at,b.earned_at)||lexical(a.id,b.id));
 const summary={observed_shapes:observed.length,independent_shapes:independent.length,practice_dates:dates.size,concept_count:counts.size,concepts:[...counts.values()].map(({dates,...entry})=>({...entry,practice_dates:dates.size})),observed_unverified:observedUnverified,ability:{status:'observing',score:null,range:null},note:'根据首次作答积累不同棋型的学习证据；不是围棋段位，也不把练习经验值当作能力分。',...(ambiguous?{needs_profile:true}:{})};
 return {method:METHOD,scope:'profile',profile_id:effectiveProfile,badges,latest:badges.at(-1)||null,summary};
}
