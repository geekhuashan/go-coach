import {clone,group,play,key,boardFor,coord} from './rules.mjs';
export const SKILLS={escape:'救棋与数气',capture:'打吃与提子',connect:'连接棋块',cut:'阻断直接连接',life:'死活与计算',tsumego:'死活与手筋'};
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
 if(!Array.isArray(value.stones)||value.stones.length<1||value.stones.length>size*size-1)fail('初始棋子数量无效。');
 const board=Array.from({length:size},()=>Array(size).fill(0));out.stones=[];
 for(const s of value.stones){const[x,y]=point([s?.x,s?.y],'棋子');if(![1,2].includes(s.color)||board[y][x])fail('初始棋子重复或颜色无效。');board[y][x]=s.color;out.stones.push({x,y,color:s.color});}
 for(const s of out.stones)if(!group(board,s.x,s.y).liberties.length)fail('初始棋块没有气。');
 const objective=value.objective||value.goal,kind=objective?.kind;
 if(!['capture','capture_any','authored_solution'].includes(kind))fail('目标类型无效。');
 if(kind==='authored_solution'&&!trustedAuthored&&!(value.source?.kind==='licensed'&&value.source?.license&&value.source?.url))fail('作者答案题需要授权来源、许可和来源链接。');
 const targets=kind==='authored_solution'?[]:objective.targets;
 if(!Array.isArray(targets)|| (kind!=='authored_solution'&&(targets.length<1||targets.length>40)))fail('目标坐标无效。');
 const ps=targets.map(p=>point(p,'目标')),defender=3-out.to_play;
 if(new Set(ps.map(p=>p.join(','))).size!==ps.length||ps.some(([x,y])=>board[y][x]!==defender))fail('目标必须是初始对方棋子。');
 out.objective={kind,targets:ps};
 const source=value.source||{kind:'manual'};if(!['original','book','manual','licensed'].includes(source.kind))fail('来源类型无效。');
 out.source={kind:source.kind};for(const name of ['title','page','problem','note',...(source.kind==='licensed'?['url','license','attribution','author','commit','original_prompt']:[])])if(source[name]!==undefined)out.source[name]=text(String(source[name]),'来源',1200,false);
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
export function recommend(catalog,evidence,stats,recent=[],currentId=null){
 const byId=new Map(catalog.map(l=>[l.id,l])),valid=recent.filter(a=>byId.has(a.lesson_id)),last=valid[0],covered=new Set(evidence.filter(a=>byId.has(a.lesson_id)).map(a=>byId.get(a.lesson_id).skill));
 let chosen;if(last&&!last.correct&&(valid.length===1||byId.get(valid[1].lesson_id).skill!==byId.get(last.lesson_id).skill))chosen=stats.skills.find(s=>s.id===byId.get(last.lesson_id).skill);
 chosen ||= stats.skills.find(s=>!covered.has(s.id))||[...stats.skills].sort((a,b)=>a.independent_attempts-b.independent_attempts||(a.accuracy||0)-(b.accuracy||0))[0];
 const candidates=catalog.filter(l=>l.skill===chosen.id&&l.difficulty===chosen.next_difficulty&&!l.legacy),seen=new Set(evidence.map(a=>a.lesson_id));
 const lesson=candidates.find(l=>!seen.has(l.id)&&l.id!==currentId)||candidates.find(l=>l.id!==currentId)||candidates[0];
 return {...publicLesson(lesson),reason:chosen.independent_attempts<3?'先用不同题目了解这项能力。':'根据首次独立作答记录，练习这项能力；辅助与重做不用于提升评级。'};
}

export function focusBounds(lesson){const size=lesson.size||9,points=(lesson.stones||[]).map(p=>Array.isArray(p)?p:[p.x,p.y]);function walk(n){if(n?.move)points.push(n.move);for(const c of n?.children||[])walk(c);}walk(lesson.tree);const valid=points.filter(p=>p.length>=2&&p.every(Number.isInteger)&&p[0]>=0&&p[1]>=0&&p[0]<size&&p[1]<size);return valid.length?{min_x:Math.min(...valid.map(p=>p[0])),min_y:Math.min(...valid.map(p=>p[1])),max_x:Math.max(...valid.map(p=>p[0])),max_y:Math.max(...valid.map(p=>p[1]))}:null;}
export function practice(ctx,currentId=null,mode=ctx.runs?._practice_mode||'recommended',advance=false){
 const catalog=ctx.catalog.filter(l=>!l.legacy).sort((a,b)=>a.id.replace(/\d+$/,'')===b.id.replace(/\d+$/,'')?a.id.localeCompare(b.id,undefined,{numeric:true}):ctx.catalog.indexOf(a)-ctx.catalog.indexOf(b)),completed=new Set(ctx.completed||[]),review=new Set([...(ctx.helped||[]),...(ctx.evidence||[]).filter(a=>a.correct===false).map(a=>a.lesson_id)]);
 const pool=catalog.filter(l=>!completed.has(l.id)&&(mode!=='review'||review.has(l.id))),index=catalog.findIndex(l=>l.id===currentId);
 let next=pool[0];if(advance&&index>=0)next=pool.find(l=>catalog.indexOf(l)>index)||pool[0];
 const reviewCount=catalog.filter(l=>review.has(l.id)&&!completed.has(l.id)).length;
 return {mode,total:catalog.length,completed:catalog.filter(l=>completed.has(l.id)).length,remaining:catalog.filter(l=>!completed.has(l.id)).length,current_index:index<0?null:index+1,next_index:next?catalog.indexOf(next)+1:null,review_count:reviewCount,next_id:next?.id||null};
}
