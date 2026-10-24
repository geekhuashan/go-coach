// Rule-derived explanations for book problems. Every sentence states a board fact computed
// here (liberties, captures, eye shape, a short local reading); verdicts must match the book's
// verified answer, otherwise the explanation keeps to facts and says nothing it cannot check.
import {clone,group,play,neighbors,key} from './rules.mjs';

export const EXPLAIN_VERSION=1;
const NAME={1:'黑',2:'白'};
const pid=([x,y])=>x+','+y;
const inside=(b,x,y)=>x>=0&&y>=0&&x<b.length&&y<b.length;
const ring=(b,x,y)=>[[x-1,y-1],[x,y-1],[x+1,y-1],[x-1,y],[x+1,y],[x-1,y+1],[x,y+1],[x+1,y+1]].filter(([a,c])=>inside(b,a,c));
const diagonals=(b,x,y)=>ring(b,x,y).filter(([a,c])=>a!==x&&c!==y);
function tryPlay(b,x,y,c,seen){try{return play(b,x,y,c,seen)}catch{return null}}
function groupsAround(b,x,y,color){const seen=new Set(),out=[];for(const[a,c]of neighbors(b,x,y))if(b[c][a]===color&&!seen.has(pid([a,c]))){const g=group(b,a,c);g.stones.forEach(p=>seen.add(pid(p)));out.push(g);}return out;}
export function boardOf(lesson){const size=lesson.size||9,b=Array.from({length:size},()=>Array(size).fill(0));for(const p of lesson.stones)b[p.y][p.x]=p.color;return b;}

// ---- Eye shape -------------------------------------------------------------------------
// A one-point eye: four sides are the owner's; diagonals decide true or false (centre may
// lose one, edge and corner none). This is the book's shape rule, not a life verdict.
export function eyeShape(b,owner,[x,y]){
 if(b[y][x]||!neighbors(b,x,y).every(([a,c])=>b[c][a]===owner))return null;
 const diag=diagonals(b,x,y).map(([a,c])=>({x:a,y:c,state:b[c][a]===owner?'own':b[c][a]?'opp':'empty'}));
 const where=diag.length===4?'center':diag.length===2?'edge':'corner',allowed=diag.length===4?1:0;
 const opp=diag.filter(d=>d.state==='opp').length;
 return {x,y,where,allowed,opp,diag,status:opp>allowed?'false':'true'};
}
const isEye=(b,owner,p)=>eyeShape(b,owner,p)?.status==='true';
// Non-owner areas fully walled by the owner (empty points, possibly with dead enemy stones).
export function walledAreas(b,owner,max=6){
 const seen=new Set(),out=[];
 for(let y=0;y<b.length;y++)for(let x=0;x<b.length;x++){
  if(b[y][x]===owner||seen.has(pid([x,y])))continue;
  const pts=[],stack=[[x,y]];seen.add(pid([x,y]));
  while(stack.length){const p=stack.pop();pts.push(p);for(const q of neighbors(b,...p))if(b[q[1]][q[0]]!==owner&&!seen.has(pid(q))){seen.add(pid(q));stack.push(q);}}
  if(pts.length<=max&&pts.some(([a,c])=>!b[c][a]))out.push(pts);
 }
 return out;
}
const touches=(b,owner,area)=>area.some(p=>neighbors(b,...p).some(([a,c])=>b[c][a]===owner));

// Local eye fight: `first` moves, players alternate (passing allowed). The owner keeps the
// eye if, when both pass, a point of `area` passes the shape rule. Wiping out every owner
// stone around the area is a life-and-death question, not eye shape, so it is not tried.
export function eyeFight(b0,owner,area,{first=3-owner,depth=12,nodes=200000}={}){
 const memo=new Map();let count=0;
 const moves=b=>{const pts=new Map();for(const p of area)for(const q of [p,...ring(b,...p)])if(!b[q[1]][q[0]])pts.set(pid(q),q);for(const p of area)for(const q of ring(b,...p))if(b[q[1]][q[0]]){const g=group(b,...q);if(g.liberties.length<=2)for(const l of g.liberties)pts.set(pid(l),l);}return [...pts.values()];};
 function search(b,toMove,passes,d,seen){
  if(++count>nodes)throw new Error('budget');
  const k=key(b)+toMove+passes+'|'+d;if(memo.has(k))return memo.get(k);
  let res;
  if(passes>=2||d===0)res={keep:area.some(p=>isEye(b,owner,p)),pv:[]};
  else{
   const want=toMove===owner;let best=null;
   const threat=r=>!r.pv[0].pass&&r.pv[1]&&!r.pv[1].pass;
   // Winners take the shortest line; losers show one real threat (answered by a move), never filler.
   const consider=r=>{if(!best){best=r;return;}const good=r.keep===want,had=best.keep===want;if(good&&(!had||r.pv.length<best.pv.length))best=r;else if(!good&&!had&&threat(r)&&(!threat(best)||r.pv.length<best.pv.length))best=r;};
   const p=search(b,3-toMove,passes+1,d-1,seen);consider({keep:p.keep,pv:[{pass:true,color:toMove},...p.pv]});
   // Passing already reaches this side's goal: the value is settled, keep the quiet line.
   if(best.keep!==want)for(const m of moves(b)){const r=tryPlay(b,m[0],m[1],toMove,seen);if(!r)continue;if(toMove!==owner&&r.captured&&!touches(r.board,owner,area))continue;const sub=search(r.board,3-toMove,0,d-1,[...seen,key(b)]);consider({keep:sub.keep,pv:[{x:m[0],y:m[1],color:toMove},...sub.pv]});}
   res=best;
  }
  memo.set(k,res);return res;
 }
 return search(b0,first,0,depth,[]);
}

// ---- Capture reading ---------------------------------------------------------------------
// The attacker keeps the target at one or two liberties; the defender extends or captures
// a stone in atari. Returns the forced line, or null when it cannot be proven here.
function attack(b,t,att,depth,budget){
 if(b[t[1]][t[0]]!==3-att)return [];
 if(budget.n--<=0||depth<0)return null;
 const g=group(b,...t);
 if(g.liberties.length===1){const l=g.liberties[0];return tryPlay(b,...l,att)?[{x:l[0],y:l[1],color:att}]:null;}
 if(g.liberties.length>2||depth===0)return null;
 const near=new Map(g.liberties.map(p=>[pid(p),p]));
 for(const l of g.liberties)for(const q of neighbors(b,...l))if(!b[q[1]][q[0]])near.set(pid(q),q);
 for(const[,p]of near){const r=tryPlay(b,...p,att);if(!r)continue;if(r.board[t[1]][t[0]]!==3-att)return [{x:p[0],y:p[1],color:att}];if(group(r.board,...p).liberties.length===1||group(r.board,...t).liberties.length>2)continue;const line=defend(r.board,t,att,depth-1,budget);if(line)return [{x:p[0],y:p[1],color:att},...line];}
 return null;
}
function defend(b,t,att,depth,budget){
 if(b[t[1]][t[0]]!==3-att)return [];
 if(budget.n--<=0)return null;
 const def=3-att,g=group(b,...t),tries=new Map(g.liberties.map(p=>[pid(p),p]));
 for(const s of g.stones)for(const h of groupsAround(b,...s,att))if(h.liberties.length===1)tries.set(pid(h.liberties[0]),h.liberties[0]);
 let longest=null;
 for(const[,p]of tries){const r=tryPlay(b,...p,def);if(!r)continue;if(group(r.board,...t).liberties.length>=3)return null;const line=attack(r.board,t,att,depth-1,budget);if(!line)return null;if(!longest||line.length+1>longest.length)longest=[{x:p[0],y:p[1],color:def},...line];}
 return longest;
}
// Iterative deepening: a deep first search spends its budget on side lines and misses plain ladders.
export function readCapture(b,target,attacker,{depth=24,nodes=4000}={}){for(let d=4;d<=depth;d+=4){const line=defend(b,target,attacker,d,{n:nodes});if(line)return line;}return null;}

// ---- Wording -------------------------------------------------------------------------
const chapterFamily={
 '真眼假眼':'judge-eye','判断真眼假眼（一至十）':'judge-count','判断真眼假眼（十一至十二）':'judge-white-eye','判断活棋死棋':'judge-life',
 '判断真眼假眼（十三）':'break-eye','做眼':'make-eye','破眼':'break-eye',
 '做完整眼':'live','三格眼位':'live','四格眼位':'live','五格六格眼位':'live','直四曲四':'live','做眼综合运用':'live','胀死牛':'live','扩大眼位':'live','占据要点':'live','综合测试':'live',
 '二气杀二气':'race','二气杀多气':'race','三气杀三气':'race','有眼杀无眼':'race','实战常形':'race','摆脱对杀':'race','二气的对杀':'race','延气对杀':'race',
};
export function lessonFamily(lesson){if(lesson.objective?.kind==='select_stones')return 'select';return chapterFamily[lesson.concept]||(lesson.objective?.kind==='choose_answer'?'judge':'capture');}
const WHERE={center:'在中间',edge:'在边上',corner:'在角上'};
const RULE={center:'中间的眼看四个斜角，最多只能让对方占一个',edge:'边上的眼看两个斜角，一个也不能让对方占',corner:'角上的眼只有一个斜角，不能让对方占'};
const libText=k=>k===1?'只剩1口气，被打吃了':`只剩${k}口气`;
function shapeSentence(e,owner,label){
 const opp=e.diag.filter(d=>d.state==='opp').length,own=e.diag.filter(d=>d.state==='own').length;
 const now=opp?`现在有${opp}个斜角是${NAME[3-owner]}子`:own===e.diag.length?`斜角${e.diag.length>1?'都':''}是${NAME[owner]}子`:'斜角没有被对方占';
 return `标“${label}”的点${WHERE[e.where]}，${RULE[e.where]}；${now}，所以是${e.status==='true'?'真眼':'假眼'}`;
}
const shapeMarks=(e,label)=>[{x:e.x,y:e.y,label},...e.diag.filter(d=>d.state==='opp').map(d=>({x:d.x,y:d.y,label:'×'}))];
const numbered=moves=>moves.map((m,i)=>({x:m.x,y:m.y,label:String(i+1)}));
const keepOnBoard=(b,marks)=>marks.filter(m=>/^\d+$/.test(m.label)?!!b[m.y][m.x]:!b[m.y][m.x]||m.label==='×'||m.label==='△');

// What one move does: captures, squeezes or saves groups, makes or spoils eyes.
function describe(before,after,mv,label,captured,family,solver){
 const c=mv.color,o=3-c,who=NAME[c],opp=NAME[o],parts=[],marks=[],facts={captured,atari:null,eye:null,spoiled:null,split:false,sacrifice:false};
 if(captured)parts.push(`提掉${opp}棋${captured}子`);
 const mine=group(after,mv.x,mv.y),joined=groupsAround(before,mv.x,mv.y,c);
 const squeezed=groupsAround(after,mv.x,mv.y,o).sort((a,b)=>a.liberties.length-b.liberties.length)[0];
 if(squeezed){const k=squeezed.liberties.length,old=Math.min(...squeezed.stones.map(p=>group(before,...p).liberties.length));if(k===1||(k===2&&k<old)){parts.push(`${opp}棋${squeezed.stones.length}子${libText(k)}`);squeezed.liberties.forEach(([x,y])=>marks.push({x,y,label:'气'}));facts.atari={stones:squeezed.stones.length,liberties:k};}}
 // A net: not touching the target, but standing next to its way out.
 if(c===solver&&!facts.atari&&!captured){const seen=new Set();for(const[x,y]of ring(after,mv.x,mv.y).flatMap(([a,b2])=>ring(after,a,b2))){if(after[y][x]!==o||seen.has(pid([x,y])))continue;const g=group(after,x,y);g.stones.forEach(q=>seen.add(pid(q)));if(g.liberties.length<=2&&!groupsAround(after,mv.x,mv.y,o).some(h=>h.stones.some(q=>q[0]===x&&q[1]===y))&&g.liberties.some(l=>Math.abs(l[0]-mv.x)+Math.abs(l[1]-mv.y)===1)){parts.push(`没有直接打吃，而是在外面罩住了${opp}棋${g.stones.length}子的出路（它现在${g.liberties.length}口气）`);g.liberties.forEach(([a,b2])=>marks.push({x:a,y:b2,label:'气'}));facts.net=g.stones.length;break;}}}
 const weakest=joined.length?Math.min(...joined.map(g=>g.liberties.length)):null;
 const escaping=c!==solver&&joined.length>0&&!captured&&mine.liberties.length<=2;
 if(c===solver&&mine.liberties.length===1&&tryPlay(after,...mine.liberties[0],o)){parts.push(`${who}${label}自己只剩1口气，是故意送给${opp}棋吃的`);facts.sacrifice=true;}
 else if(escaping)parts.push(`${who}棋想逃，可这块${who}棋${mine.stones.length}子还是只有${mine.liberties.length}口气`);
 else if(joined.length>=2&&weakest<=2)parts.push(`把${who}棋连成一块，变成${mine.liberties.length}口气`);
 else if(weakest!==null&&weakest<=2&&mine.liberties.length>weakest)parts.push(`${who}棋从${weakest}口气变成${mine.liberties.length}口气`);
 if(family!=='capture'&&family!=='race'){
  const near=p=>Math.abs(p[0]-mv.x)<=1&&Math.abs(p[1]-mv.y)<=1;
  const made=ring(after,mv.x,mv.y).map(p=>eyeShape(after,c,p)).find(e=>e&&e.status==='true'&&!isEye(before,c,[e.x,e.y]));
  const areaBefore=walledAreas(before,c).find(a=>a.some(p=>p[0]===mv.x&&p[1]===mv.y));
  if(areaBefore&&areaBefore.length>=3){const parts2=walledAreas(after,c).filter(a=>a.some(p=>areaBefore.some(q=>q[0]===p[0]&&q[1]===p[1])));if(parts2.length>=2){facts.split=true;parts.push(`下在${who}棋${areaBefore.length}格眼位的要点上，把它分成了${parts2.length}只眼`);}}
  // Enemy stones shut inside our wall that cannot be saved: their only liberty is a point the enemy cannot play.
  const trapped=!made&&groupsAround(after,mv.x,mv.y,o).find(g=>g.liberties.length===1&&!tryPlay(after,...g.liberties[0],o)&&walledAreas(after,c).some(a=>g.stones.every(q=>a.some(r=>r[0]===q[0]&&r[1]===q[1]))));
  if(trapped){facts.trapped=trapped.stones.length;parts.push(`${opp}棋${trapped.stones.length}子被关在${who}棋里面，唯一的气（标“气”）${opp}棋自己下不进去，跑不掉，${who}棋随时能提，这里就成了${who}棋的眼`);trapped.stones.forEach(([x,y])=>marks.push({x,y,label:'死'}));}
  if(made){facts.eye=made;if(!facts.split)parts.push(`围出了一只眼：${shapeSentence(made,c,'眼')}`);marks.push(...shapeMarks(made,'眼'));}
  // Filling an empty diagonal of our own eye so the opponent can no longer turn it false.
  const guarded=!made&&!trapped&&diagonals(after,mv.x,mv.y).map(p=>eyeShape(after,c,p)).find(e=>e&&e.status==='true'&&e.diag.filter(d=>d.state!=='own').length<=e.allowed&&eyeShape(before,c,[e.x,e.y]).diag.filter(d=>d.state!=='own').length>e.allowed);
  if(guarded){facts.eye=guarded;parts.push(`补上了标“眼”那只眼的斜角，${opp}棋再也没法把它破成假眼（${RULE[guarded.where]}）`);marks.push({x:guarded.x,y:guarded.y,label:'眼'});}
  const spoiled=!trapped&&[...ring(before,mv.x,mv.y),[mv.x,mv.y]].filter(p=>near(p)).map(p=>({p,was:eyeShape(before,o,p),now:eyeShape(after,o,p)})).find(e=>e.was?.status==='true'&&e.now?.status!=='true');
  const blocked=!spoiled&&!trapped&&neighbors(after,mv.x,mv.y).find(([x,y])=>!after[y][x]&&neighbors(before,x,y).every(([a,c])=>before[c][a]===o||(a===mv.x&&c===mv.y))&&neighbors(before,x,y).filter(([a,c])=>before[c][a]===o).length>=neighbors(before,x,y).length-1);
  if(blocked){facts.spoiled={x:blocked[0],y:blocked[1],gone:true};parts.push(`占住了${opp}棋做眼要用的点，标“破”的地方围不成眼了`);marks.push({x:blocked[0],y:blocked[1],label:'破'});}
  if(spoiled){facts.spoiled=spoiled.now||{x:spoiled.p[0],y:spoiled.p[1],gone:true};if(!spoiled.now)parts.push(`直接下在${opp}棋要做眼的地方，那里成不了眼`);else{parts.push(`占了${opp}棋眼的斜角：${shapeSentence(spoiled.now,o,'假')}`);marks.push(...shapeMarks(spoiled.now,'假'));}}
 }
 return {text:`${who}${label}${parts.length?'：'+parts.join('；')+'。':'。'}`,marks,facts};
}

// The same line the solution demo plays: first legal path to a correct leaf.
export function referenceLine(lesson){
 function walk(node,b,moves,color){if(!node.children?.length)return moves.length&&node.correct!==false?moves:null;for(const ch of node.children){const r=tryPlay(b,ch.move[0],ch.move[1],color);if(!r)continue;const out=walk(ch,r.board,[...moves,{x:ch.move[0],y:ch.move[1],color}],3-color);if(out)return out;}return null;}
 return lesson.tree?walk(lesson.tree,boardOf(lesson),[],lesson.to_play||1):null;
}

// Plays `moves` from `board`, numbering stones from `start`; each frame keeps earlier numbers.
function frames(board,moves,family,{start=1,shown=[],lead='',winner=null,solver=1}={}){
 let b=clone(board),n=start;const out=[],played=[...shown.filter(m=>!m.pass)];
 moves.forEach((mv,i)=>{const head=i===0?lead:'';
  if(mv.pass){out.push({move:null,text:head+(mv.color===winner?`${NAME[mv.color]}棋不用理它，这里已经没问题。`:`${NAME[mv.color]}棋在这里已经没有好办法了。`),marks:keepOnBoard(b,numbered(played))});return;}
  const r=play(b,mv.x,mv.y,mv.color),d=describe(b,r.board,mv,String(n++),r.captured,family,solver);b=r.board;played.push(mv);
  out.push({move:mv,text:head+d.text,marks:[...keepOnBoard(b,numbered(played)),...d.marks],facts:d.facts});});
 return {frames:out,board:b};
}
const trimPasses=pv=>{const out=[...pv];while(out.length&&out.at(-1).pass)out.pop();return out;};

// ---- Families --------------------------------------------------------------------------
export function explainLesson(lesson,{line}={}){
 const family=lessonFamily(lesson),P=lesson.to_play||1,b0=boardOf(lesson);
 if(family.startsWith('judge'))return judged(lesson,family,b0,P);
 if(family==='select')return selection(lesson,b0);
 const moves=line||referenceLine(lesson);if(!moves?.length)return null;
 const main=frames(b0,moves,family),after=main.board,steps=[...main.frames],summary=[],demos=[];
 if(family==='capture'||family==='race'){
  const taken=steps.reduce((s,x)=>s+(x.move?.color===P?x.facts.captured:0),0);
  if(taken)summary.push(`${NAME[P]}棋一共提掉${NAME[3-P]}棋${taken}子`);
  // Nets sit diagonally, so look for short-of-liberty enemy groups within two points of our moves.
  const seen=new Set(),targets=[];
  for(const m of moves.filter(m=>m.color===P))for(let y=m.y-2;y<=m.y+2;y++)for(let x=m.x-2;x<=m.x+2;x++)if(inside(after,x,y)&&after[y][x]===3-P&&!seen.has(pid([x,y]))){const g=group(after,x,y);g.stones.forEach(q=>seen.add(pid(q)));if(g.liberties.length<=2)targets.push(g);}
  targets.sort((a,c)=>a.liberties.length-c.liberties.length||c.stones.length-a.stones.length);
  for(const target of targets){const pv=readCapture(after,target.stones[0],P);if(pv?.length){const v=frames(after,pv,family,{start:moves.length+1,shown:moves,lead:`演示：假如${NAME[3-P]}棋想逃——`});demos.push({title:`${NAME[3-P]}棋逃不掉`,from:'after',frames:v.frames});summary.push(`${NAME[3-P]}棋${target.stones.length}子${libText(target.liberties.length)}，怎么逃都会被提掉`);break;}}
 }else if(['make-eye','break-eye'].includes(family)){
  const owner=family==='make-eye'?P:3-P,first=moves.at(-1).color===P?3-P:P;
  const near=a=>moves.some(m=>a.some(([x,y])=>Math.abs(x-m.x)<=1&&Math.abs(y-m.y)<=1));
  const fights=walledAreas(after,owner).filter(near).map(a=>{try{return {a,f:eyeFight(after,owner,a,{first})}}catch{return null}}).filter(Boolean);
  const ok=family==='make-eye'?fights.some(x=>x.f.keep):!fights.some(x=>x.f.keep)&&steps.some(s=>s.facts?.spoiled)||fights.length&&!fights.some(x=>x.f.keep);
  if(ok){
   const shown=family==='make-eye'?fights.find(x=>x.f.keep):fights[0],pv=shown?trimPasses(shown.f.pv):[];
   if(pv.length&&!pv[0].pass){const v=frames(after,pv,family,{start:moves.length+1,shown:moves,lead:family==='make-eye'?`演示：${NAME[3-P]}棋来破眼——`:`演示：${NAME[3-P]}棋想补成眼——`,winner:P});demos.push({title:family==='make-eye'?'白棋破不了这只眼':'白棋补不成眼',from:'after',frames:v.frames});}
   summary.push(family==='make-eye'?`黑1之后这里是真眼，${NAME[3-P]}棋先来破也破不掉`:`${NAME[3-P]}棋这里做不成真眼了`);
   if(moves.length===1){const wrong=wrongTry(b0,moves[0],owner,family);if(wrong)demos.push(wrong);}
  }
 }else if(family==='live'){
  const eyes=eyeList(after,P);
  if(eyes.length>=2)summary.push(`${NAME[P]}棋现在有${eyes.length}处分开的眼，两只眼就活了`);
  steps.at(-1).marks.push(...eyes.flatMap((a,i)=>a.filter(([x,y])=>!after[y][x]).slice(0,1).map(([x,y])=>({x,y,label:i?'乙':'眼'}))));
 }
 return finish({family,steps,demos,summary});
}
// One wrong first move and how the opponent refutes it, for single-move eye problems.
function wrongTry(b0,answer,owner,family){
 const P=answer.color,tries=[];
 for(const q of ring(b0,answer.x,answer.y)){if(b0[q[1]][q[0]])continue;const r=tryPlay(b0,q[0],q[1],P);if(!r)continue;
  const areas=walledAreas(r.board,owner).filter(a=>a.some(([x,y])=>Math.abs(x-q[0])<=2&&Math.abs(y-q[1])<=2));
  let fights;try{fights=areas.map(a=>eyeFight(r.board,owner,a,{first:3-P,nodes:60000}));}catch{continue}
  const fails=family==='make-eye'?!fights.some(f=>f.keep):fights.some(f=>f.keep);
  if(!fails)continue;
  const f=family==='make-eye'?fights.find(f=>trimPasses(f.pv).length&&!f.pv[0].pass):fights.find(f=>f.keep&&trimPasses(f.pv).length&&!f.pv[0].pass);
  tries.push({q,pv:f?trimPasses(f.pv):[]});}
 const best=tries.sort((a,b)=>(b.pv.length>0)-(a.pv.length>0))[0];if(!best)return null;
 const mv={x:best.q[0],y:best.q[1],color:P},v=frames(b0,[mv,...best.pv],family,{lead:'对比：如果黑1下在这里——',winner:3-P});
 v.frames.push({move:null,text:family==='make-eye'?'这样就做不出真眼，所以要下在书上的那一点。':'这样白棋还能做成眼，所以要下在书上的那一点。',marks:v.frames.at(-1).marks});
 return {title:'如果下在别处',from:'start',frames:v.frames};
}
function eyeList(b,owner){return walledAreas(b,owner).filter(a=>a.length>1?true:isEye(b,owner,a[0]));}

function judged(lesson,family,b,P){
 const answer=lesson.objective?.answer,label=lesson.choices?.find(c=>c.id===answer)?.label||answer,labels=['眼','乙','丙','丁'];
 const owner=family==='judge-white-eye'?3-P:P,frames0=[],demos=[],summary=[];let verdict=null;
 if(family==='judge-eye'||family==='judge-count'){
  const areas=walledAreas(b,owner),results=areas.map(a=>{try{return {a,f:eyeFight(b,owner,a)}}catch{return {a,f:null}}});
  const keep=results.filter(r=>r.f?.keep).length;
  verdict=family==='judge-eye'?(results.some(r=>r.f?.keep)?'true_eye':'false_eye'):String(keep);
  const agrees=results.every(r=>r.f)&&verdict===answer;
  const texts=[],marks=[];
  results.slice(0,4).forEach((r,i)=>{const lab=labels[i],single=r.a.length===1?eyeShape(b,owner,r.a[0]):null;
   if(single){texts.push(shapeSentence(single,owner,lab));marks.push(...shapeMarks(single,lab));}
   else{const empty=r.a.filter(([x,y])=>!b[y][x]);texts.push(`标“${lab}”的是${r.a.length}格连在一起的眼位，要看白棋能不能把它破成假眼`);marks.push(...empty.map(([x,y])=>({x,y,label:lab})));}
   if(agrees&&r.f){const pv=trimPasses(r.f.pv);if(pv.length&&!pv[0].pass){const v=frames(b,pv,'judge',{lead:r.f.keep?`演示（${lab}）：白棋来破——`:`演示（${lab}）：白棋这样破——`,winner:r.f.keep?owner:3-owner});v.frames.push({move:null,text:r.f.keep?'白棋破不掉，这只眼是真眼。':'眼被破掉了，所以是假眼。',marks:v.frames.at(-1).marks});demos.push({title:`${lab}：${r.f.keep?'真眼':'假眼'}`,from:'start',frames:v.frames});}
    else if(!r.f.keep&&single)demos.push(...forcedFill(b,owner,single,lab));}});
  frames0.push({move:null,text:texts.join('；')+'。',marks});
  if(agrees)summary.push(family==='judge-count'?`数一数：真眼有${keep}只`:`所以是${label}`);
 }else{
  const eyes=eyeList(b,owner),marks=[],texts=[];
  eyes.slice(0,4).forEach((a,i)=>{const single=a.length===1?eyeShape(b,owner,a[0]):null;if(single){texts.push(shapeSentence(single,owner,labels[i]));marks.push(...shapeMarks(single,labels[i]));}else{texts.push(`标“${labels[i]}”的是${a.length}格的眼位`);marks.push(...a.filter(([x,y])=>!b[y][x]).map(([x,y])=>({x,y,label:labels[i]})));}});
  if(family==='judge-life'){const alive=answer===lesson.choices?.find(c=>c.label==='活')?.id;if(alive&&eyes.length>=2)summary.push(`${NAME[owner]}棋有${eyes.length}处分开的眼，两只眼就是活棋`);if(!alive&&eyes.length<=1)summary.push(`${NAME[owner]}棋${eyes.length?'只有一处眼':'没有眼'}，做不出两只眼，是死棋`);}
  // Without a verdict that matches the book, eye areas alone would mislead; say nothing.
  if(!summary.length)return null;
  frames0.push({move:null,text:texts.join('；')+'。',marks});
 }
 return finish({family,steps:frames0,demos,summary,answer:label,verdict});
}
// A false one-point eye: show the opponent squeezing a wall chain until it must fill the eye.
function forcedFill(b,owner,e,lab){
 const opp=3-owner,chains=groupsAround(b,e.x,e.y,owner);
 for(const g of chains){const outside=g.liberties.filter(([x,y])=>!(x===e.x&&y===e.y));if(!outside.length||outside.length>2)continue;
  let bb=clone(b);const pv=[];let fine=true;for(const l of outside){const r=tryPlay(bb,...l,opp);if(!r){fine=false;break;}bb=r.board;pv.push({x:l[0],y:l[1],color:opp});}
  if(!fine||bb[e.y][e.x])continue;
  const left=group(bb,...g.stones[0]).liberties;if(left.length!==1||left[0][0]!==e.x||left[0][1]!==e.y)continue;
  const fill={x:e.x,y:e.y,color:owner};if(!tryPlay(bb,e.x,e.y,owner))continue;
  const v=frames(b,[...pv,fill],'judge',{lead:`演示（${lab}）：白棋把外面的气紧掉——`});
  v.frames.push({move:null,text:`黑棋${g.stones.length}子只剩眼这一口气，只能在眼里接上，眼就没了。所以是假眼。`,marks:v.frames.at(-1).marks});
  return [{title:`${lab}：假眼`,from:'start',frames:v.frames}];
 }
 return [];
}
function selection(lesson,b){
 const targets=lesson.objective?.targets||[],marks=[],seen=new Set(),lines=[];
 for(const t of targets){if(seen.has(pid(t)))continue;const g=group(b,...t);g.stones.forEach(p=>seen.add(pid(p)));lines.push(`标△的${NAME[b[t[1]][t[0]]]}棋${g.stones.length}子${libText(g.liberties.length)}`);g.liberties.forEach(([x,y])=>marks.push({x,y,label:'气'}));}
 return finish({family:'select',steps:[{move:null,text:lines.join('；')+'。',marks:[...targets.map(([x,y])=>({x,y,label:'△'})),...marks]}],demos:[],summary:[]});
}
function finish({family,steps,demos,summary,answer,verdict}){
 const strip=f=>({move:f.move?{x:f.move.x,y:f.move.y,color:f.move.color}:null,text:f.text,marks:f.marks});
 return {version:EXPLAIN_VERSION,family,steps:steps.map(strip),demos:demos.map(d=>({title:d.title,from:d.from,frames:d.frames.map(strip)})),summary,...(answer?{answer}:{}),...(verdict?{verdict}:{})};
}
