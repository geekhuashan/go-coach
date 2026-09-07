import {clone,group,play,key,boardFor,coord} from './rules.mjs';
export const SKILLS={escape:'救棋与数气',capture:'打吃与提子',connect:'连接棋块',cut:'阻断直接连接',life:'死活与计算',tsumego:'死活与手筋'};
// Only the original eight base families have interchangeable rotation variants.
export function availableLesson(lesson){if(lesson.legacy||['escape','capture','connect'].includes(lesson.id))return false;const match=!lesson.sequence&&/^(escape|capture|connect|cut)-([12])-([1-8])$/.exec(lesson.id);return !match||Number(match[3])<=(match[2]==='1'?3:5);}
export function publicLesson(lesson){const{objective,solutions,solution,tree,...visible}=lesson;return {...clone(visible),focus_bounds:focusBounds(lesson)};}
export function validateLesson(value,{trustedAuthored=false}={}){
 const size=value?.size||9;if(![9,19].includes(size))throw new Error('题目棋盘需为9路或19路。');
 const fail=t=>{throw new Error('题目校验失败：'+t)};
 const text=(v,label,max=1200,required=true)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim())||/[\x00-\x08\x0b-\x1f]/.test(v))fail(label+'格式无效。');return v.trim()};
 const point=(v,label)=>{if(!Array.isArray(v)||v.length!==2||v.some(c=>!Number.isInteger(c)||c<0||c>=size))fail(label+'坐标超出棋盘。');return [...v]};
 if(!value||typeof value!=='object'||Array.isArray(value))fail('需要一个题目对象。');
 const id=text(value.id,'id',80);if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))fail('id只支持字母数字和短横线下划线。');
 if(value.sequence!==true||!SKILLS[value.skill])fail('需要支持的连续题技能。');
 if(!Number.isInteger(value.difficulty)||value.difficulty<1||value.difficulty>5)fail('难度需为1至5。');
 if(![1,2].includes(value.to_play))fail('先行方无效。');
 const out={id,title:text(value.title,'标题',160),prompt:text(value.prompt,'题目'),hint:text(value.hint,'提示'),skill:value.skill,difficulty:value.difficulty,to_play:value.to_play,sequence:true,size};
 if(value.concept!==undefined)out.concept=text(value.concept,'题型',80);
 if(!Array.isArray(value.stones)||value.stones.length<1||value.stones.length>size*size-1)fail('初始棋子数量无效。');
 const board=Array.from({length:size},()=>Array(size).fill(0));out.stones=[];
 for(const s of value.stones){const[x,y]=point([s?.x,s?.y],'棋子');if(![1,2].includes(s.color)||board[y][x])fail('初始棋子重复或颜色无效。');board[y][x]=s.color;out.stones.push({x,y,color:s.color});}
 for(const s of out.stones)if(!group(board,s.x,s.y).liberties.length)fail('初始棋块没有气。');
 const objective=value.objective||value.goal,kind=objective?.kind;
 if(!['capture','capture_any','authored_solution'].includes(kind))fail('目标类型无效。');
 const privateBook=value.source?.kind==='book'&&value.source?.usage==='household_private'&&value.source?.answer_verified===true;
 if(kind==='authored_solution'&&!trustedAuthored&&!(value.source?.kind==='licensed'&&value.source?.license&&value.source?.url)&&!privateBook)fail('作者答案题需要授权来源、许可和来源链接，或已核对的家庭私用书题来源。');
 if(kind==='authored_solution'&&privateBook)for(const name of ['title','page','problem']){const raw=value.source[name];text((name==='page'||name==='problem')&&Number.isInteger(raw)?String(raw):raw,'书题来源 '+name,600);}
 const targets=kind==='authored_solution'?[]:objective.targets;
 if(!Array.isArray(targets)|| (kind!=='authored_solution'&&(targets.length<1||targets.length>40)))fail('目标坐标无效。');
 const ps=targets.map(p=>point(p,'目标')),defender=3-out.to_play;
 if(new Set(ps.map(p=>p.join(','))).size!==ps.length||ps.some(([x,y])=>board[y][x]!==defender))fail('目标必须是初始对方棋子。');
 out.objective={kind,targets:ps};
 const source=value.source||{kind:'manual'};if(!['original','book','manual','licensed'].includes(source.kind))fail('来源类型无效。');
 out.source={kind:source.kind};for(const name of ['title','page','problem','note',...(source.kind==='licensed'?['url','license','attribution','author','commit','original_prompt']:[])])if(source[name]!==undefined)out.source[name]=text(String(source[name]),'来源',1200,false);
 if(privateBook)Object.assign(out.source,{usage:'household_private',answer_verified:true});
 out.marks=[];if(value.marks!==undefined&&!Array.isArray(value.marks))fail('标记需为列表。');
 for(const m of value.marks||[]){if(out.marks.length>=40)fail('标记过多。');const[x,y]=point([m.x,m.y],'标记');out.marks.push({x,y,label:text(m.label,'标记文字',16)});}
 let count=0;const active=new Set(),targetSet=new Set(ps.map(p=>p.join(',')));
 function visit(node,before,seen,removed,depth){
  if(!node||typeof node!=='object'||active.has(node)||++count>2000||depth>31)fail('答案树过大、过深或存在循环。');active.add(node);
  const clean={},captured=new Set(removed);let after=before;
  if(depth){const p=point(node.move,'答案'),color=depth%2?out.to_play:defender;try{after=play(before,...p,color,seen).board}catch(e){fail(`第${depth}手不合法：${e.message}`)}
   for(const t of targetSet){const[x,y]=t.split(',').map(Number);if(before[y][x]===defender&&after[y][x]!==defender)captured.add(t)}
   seen=[...seen,key(after)];clean.move=p;clean.explanation=text(node.explanation||'按题目收录变化继续计算。','每步讲解');}
  const children=node.children||[];if(!Array.isArray(children)||children.length>16)fail('答案分支无效。');
  const goal=kind==='capture_any'?[...targetSet].some(t=>captured.has(t)):kind==='capture'?[...targetSet].every(t=>captured.has(t)):false;
  if(children.length&&goal)fail('提子目标完成后不能继续多余走法。');
  if(!children.length&&(depth<1||(kind!=='authored_solution'&&(depth%2!==1||!goal))))fail('每个终点必须实际达成目标。');
  if(kind==='authored_solution'&&!children.length&&node.correct!==true&&!(node.result==='success'&&node.author_verdict==='correct'))fail('作者答案终点需要明确correct=true。');
  const positions=children.map(c=>point(c?.move,'子分支').join(','));if(new Set(positions).size!==positions.length)fail('答案分支重复。');
  clean.children=children.map(c=>visit(c,after,seen,captured,depth+1));if(kind==='authored_solution'&&!children.length)clean.correct=true;active.delete(node);return clean;
 }
 out.tree=visit(value.tree,board,[key(board)],new Set(),0);return out;
}
export function grade(lesson,before,after,move,captured){
 const skill=lesson.skill,targets=lesson.objective.targets,[a,b]=targets[0];let correct=false,summary='',explanation='',marks=[];
 if(skill==='escape'){const g=group(after,a,b),old=group(before,a,b);correct=after[b][a]===1&&g.liberties.length>=2;summary=correct?'救棋成功，已解除打吃。':'这块黑棋仍被打吃，再数一数整块棋的气。';explanation=`目标黑棋原有${old.liberties.length}口气，现在有${g.liberties.length}口气。相连黑棋共享气，重复空点只算一次；解除打吃不代表已经做活。`;marks=g.liberties.map(([x,y])=>({x,y,label:'气'}));}
 else if(skill==='capture'){const remaining=targets.filter(([x,y])=>after[y][x]===2).length;correct=remaining===0&&captured>=targets.length;summary=correct?'提子成功，目标白棋已全部提掉。':'还没有提掉目标白棋。';explanation=`目标共有${targets.length}颗白棋，现在还剩${remaining}颗。只有占掉整块棋最后一口气，才会提掉这块棋。`;}
 else if(skill==='connect'){const g=new Set(group(after,a,b).stones.map(p=>p.join(',')));correct=targets.every(([x,y])=>after[y][x]===1&&g.has([x,y].join(',')));summary=correct?'连接成功，目标黑棋属于同一块棋。':'目标黑棋还没有连成一块。';explanation='上下左右相邻的同色棋才相连；斜着相邻不算连接。';}
 else{const[x,y]=lesson.objective.point;correct=before[y][x]===0&&after[y][x]===1&&move.x===x&&move.y===y;summary=correct?'占住连接点，阻止了白棋直接连上。':'白棋的直接连接点还没有被占住。';explanation=`本题只核对${coord(x,y)}这个直接连接点；白棋以后能否绕路连接或做活，尚未判断。`;marks=[{x,y,label:'连接点'}];}
 return {correct,summary,explanation,marks,skill,difficulty:lesson.difficulty};
}
export function learning(catalog,evidence,attemptsCount=0){
 const byId=new Map(catalog.map(l=>[l.id,l]));const independent=evidence.filter(a=>byId.has(a.lesson_id)&&!a.assisted&&(a.attempt_no||1)===1);
 const skills=Object.entries(SKILLS).filter(([id])=>catalog.some(l=>l.skill===id)).map(([id,name])=>{
  const records=independent.filter(a=>byId.get(a.lesson_id).skill===id),levels=[...new Set(catalog.filter(l=>l.skill===id).map(l=>l.difficulty))].sort((a,b)=>a-b);let difficulty=levels[0];
  for(let i=0;i<levels.length-1;i++){const d=levels[i],rs=records.filter(a=>byId.get(a.lesson_id).difficulty===d),n=Math.min(3,catalog.filter(l=>l.skill===id&&l.difficulty===d&&!l.legacy).length);if(!n||rs.length<n||rs.filter(a=>a.correct).length/rs.length<.75)break;difficulty=levels[i+1];}
  const last=records.slice(-2);if(last.length===2&&last.every(a=>!a.correct)&&byId.get(last[0].lesson_id).difficulty===byId.get(last[1].lesson_id).difficulty)difficulty=Math.min(difficulty,Math.max(1,byId.get(last[0].lesson_id).difficulty-1));
  return {id,name,stage:records.length<3?'待评估':difficulty===1?'继续巩固基础':`可练习难度 ${difficulty}`,independent_attempts:records.length,total:records.length,correct:records.filter(a=>a.correct).length,accuracy:records.length?records.filter(a=>a.correct).length/records.length:null,next_difficulty:difficulty};
 });
 return {stage:independent.length<3?'待评估':'按技能逐项练习（不对应段位）',attempts_count:attemptsCount,independent_attempts:independent.length,independent_correct:independent.filter(a=>a.correct).length,skills};
}
const CONCEPT_NAMES={double_atari:'双打吃',ladder:'征子',snapback:'倒扑',connection_trap:'接不归',edge_chase:'边线追吃',capture_race:'对杀',atari:'打吃'};
export function recommend(catalog,evidence,stats,recent=[],currentId=null){
 const byId=new Map(catalog.map(l=>[l.id,l])),groupKey=l=>l.concept?`concept:${l.skill}:${l.concept}`:`skill:${l.skill}`;
 const valid=recent.filter(a=>byId.has(a.lesson_id)&&typeof a.correct==='boolean').slice(0,30),seen=new Set(evidence.map(a=>a.lesson_id)),groups=[];
 for(const l of catalog.filter(availableLesson)){const id=groupKey(l);if(!groups.some(g=>g.id===id))groups.push({id,skill:l.skill,name:CONCEPT_NAMES[l.concept]||l.concept||SKILLS[l.skill],lessons:[],records:[]});groups.find(g=>g.id===id).lessons.push(l);}
 for(const g of groups){g.records=valid.filter(a=>groupKey(byId.get(a.lesson_id))===g.id);g.wins=0;g.losses=0;const won=new Set(),lost=new Set();for(const a of g.records){if(a.correct!==true||a.assisted)break;if(!won.has(a.lesson_id)){won.add(a.lesson_id);g.wins++;}}for(const a of g.records){if(a.correct!==false)break;if(!lost.has(a.lesson_id)){lost.add(a.lesson_id);g.losses++;}}g.count=evidence.filter(a=>byId.has(a.lesson_id)&&groupKey(byId.get(a.lesson_id))===g.id).length;}
 const latest=valid[0],lastGroup=latest?groupKey(byId.get(latest.lesson_id)):null;let run=0;for(const a of valid){if(groupKey(byId.get(a.lesson_id))!==lastGroup)break;run++;}
 const pool=groups.filter(g=>!(run>=3&&g.id===lastGroup&&groups.length>1));let chosen=pool.filter(g=>g.losses>=2).sort((a,b)=>valid.indexOf(a.records[0])-valid.indexOf(b.records[0]))[0];let kind=chosen?'reinforce':null;
 if(!chosen&&latest?.correct===false&&run===1){chosen=pool.find(g=>g.id===lastGroup);kind='retry_skill';}
 if(!chosen){chosen=[...pool].sort((a,b)=>(a.count+2*a.records.length+(a.wins>=3?12:0)+(Math.min(...a.lessons.map(l=>l.difficulty))>(stats.skills.find(s=>s.id===a.skill)?.next_difficulty||1)?100:0))-(b.count+2*b.records.length+(b.wins>=3?12:0)+(Math.min(...b.lessons.map(l=>l.difficulty))>(stats.skills.find(s=>s.id===b.skill)?.next_difficulty||1)?100:0)))[0];kind=groups.some(g=>g.wins>=3)?'reduce_frequency':run>=3?'rotate':'balanced';}
 const stat=stats.skills.find(s=>s.id===chosen.skill),levels=[...new Set(chosen.lessons.map(l=>l.difficulty))].sort((a,b)=>a-b);let desired=stat?.next_difficulty||levels[0];
 if(kind==='reinforce')desired=Math.min(desired,Math.max(1,byId.get(chosen.records[0].lesson_id).difficulty-1));
 const difficulty=[...levels].reverse().find(d=>d<=desired)||levels[0],candidates=chosen.lessons.filter(l=>l.difficulty===difficulty),excluded=currentId||latest?.lesson_id,recentIds=new Set(valid.slice(0,3).map(a=>a.lesson_id));
 const other=candidates.filter(l=>l.id!==excluded),eligible=other.length?other:candidates,rested=eligible.filter(l=>!recentIds.has(l.id)),fresh=(rested.length?rested:eligible).filter(l=>!seen.has(l.id));
 const lesson=(fresh.length?fresh:rested.length?rested:[...eligible].sort((a,b)=>{const ai=valid.findIndex(v=>v.lesson_id===a.id),bi=valid.findIndex(v=>v.lesson_id===b.id);return (bi<0?1e6:bi)-(ai<0?1e6:ai);}))[0];
 const cooled=groups.find(g=>g.wins>=3&&g.id!==chosen.id);if(kind==='reduce_frequency'&&!cooled)kind='balanced';let reason=kind==='reinforce'?`${chosen.name}最近连续${chosen.losses}道不同题答错，优先换题巩固${difficulty<byId.get(chosen.records[0].lesson_id).difficulty?'，先降低难度':''}。`:kind==='retry_skill'?`刚才的${chosen.name}还没掌握，换一道题再练一次。`:kind==='rotate'?`刚连续练了同一类题，先换成${chosen.name}；需要巩固的内容之后还会安排。`:kind==='reduce_frequency'?`${cooled.name}近期连续做对${cooled.wins}道不同题，暂时少安排一些，换练${chosen.name}。`:`根据近期练习和首次作答记录，换练${chosen.name}。`;
 return {...publicLesson(lesson),reason,adjustment:{kind,skill:chosen.skill,concept:lesson.concept||null,group:chosen.name,streak:kind==='reinforce'?chosen.losses:kind==='reduce_frequency'?cooled.wins:0,window:30}};
}

export function focusBounds(lesson){const size=lesson.size||9,points=(lesson.stones||[]).map(p=>Array.isArray(p)?p:[p.x,p.y]);function walk(n){if(n?.move)points.push(n.move);for(const c of n?.children||[])walk(c);}walk(lesson.tree);const valid=points.filter(p=>p.length>=2&&p.every(Number.isInteger)&&p[0]>=0&&p[1]>=0&&p[0]<size&&p[1]<size);return valid.length?{min_x:Math.min(...valid.map(p=>p[0])),min_y:Math.min(...valid.map(p=>p[1])),max_x:Math.max(...valid.map(p=>p[0])),max_y:Math.max(...valid.map(p=>p[1]))}:null;}
export function practice(ctx,currentId=null,mode=ctx.runs?._practice_mode||'recommended',advance=false){
 const current=ctx.catalog.find(l=>l.id===currentId),bookTitle=mode==='sequential'&&current?.source?.kind==='book'?current.source.title:null;
 const number=l=>{const values=String(l.source?.problem||'').match(/\d+/g)||l.id.match(/\d+/g);return values?Number(values.at(-1)):Infinity;};
 const ordered=(bookTitle?ctx.catalog.filter(l=>l.source?.kind==='book'&&l.source.title===bookTitle):ctx.catalog).filter(l=>!l.legacy).sort((a,b)=>a.id.replace(/\d+$/,'')===b.id.replace(/\d+$/,'')?a.id.localeCompare(b.id,undefined,{numeric:true}):ctx.catalog.indexOf(a)-ctx.catalog.indexOf(b)),catalog=ordered.filter(availableLesson),completed=new Set(ctx.completed||[]),review=new Set([...(ctx.helped||[]),...(ctx.evidence||[]).filter(a=>a.correct===false).map(a=>a.lesson_id)]);
 if(bookTitle){ordered.sort((a,b)=>number(a)-number(b)||a.id.localeCompare(b.id));catalog.sort((a,b)=>number(a)-number(b)||a.id.localeCompare(b.id));}
 const pool=catalog.filter(l=>!completed.has(l.id)&&(mode!=='review'||review.has(l.id))),index=catalog.findIndex(l=>l.id===currentId),anchor=ordered.findIndex(l=>l.id===currentId);
 let next=pool[0];if(advance&&anchor>=0)next=pool.find(l=>ordered.indexOf(l)>anchor)||pool[0];
 const reviewCount=catalog.filter(l=>review.has(l.id)&&!completed.has(l.id)).length;
 return {...(bookTitle?{book_title:bookTitle,chapter:current.concept||null,book_complete:pool.length===0}:{}),mode,total:catalog.length,completed:catalog.filter(l=>completed.has(l.id)).length,remaining:catalog.filter(l=>!completed.has(l.id)).length,current_index:index<0?null:index+1,next_index:next?catalog.indexOf(next)+1:null,review_count:reviewCount,next_id:next?.id||null};
}
