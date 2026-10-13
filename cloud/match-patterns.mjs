import {clone,group,play,key,coord} from './rules.mjs';

const TYPES={capture:{title:'提子',skill:'capture'},escape:{title:'逃出打吃',skill:'escape'},double_atari:{title:'双打吃',skill:'capture'},atari:{title:'打吃',skill:'capture'}};
function groups(board){const seen=new Set(),out=[];for(let y=0;y<board.length;y++)for(let x=0;x<board.length;x++){if(!board[y][x]||seen.has(`${x},${y}`))continue;const g=group(board,x,y);for(const p of g.stones)seen.add(p.join(','));out.push({...g,color:board[y][x]});}return out;}
const point=([x,y])=>({x,y});
const same=(a,b)=>!a?.pass&&a?.x===b.x&&a?.y===b.y;
function opportunities(board,color,seen){
 const all=groups(board),points=new Map();
 // Captures, ataris and direct extensions only need liberties of groups in danger.
 for(const g of all)if(g.liberties.length<=(g.color===color?1:2))for(const p of g.liberties)points.set(p.join(','),p);
 const found={capture:[],escape:[],double_atari:[],atari:[]};
 for(const [x,y]of points.values()){
  let next;try{next=play(board,x,y,color,seen);}catch{continue;}
  const endangered=all.filter(g=>g.color===color&&g.liberties.length===1),saved=endangered.filter(g=>g.stones.every(([a,b])=>next.board[b][a]===color)&&group(next.board,...g.stones[0]).liberties.length>=2);
  const threatened=all.filter(g=>g.color!==color&&g.liberties.length===2&&g.stones.every(([a,b])=>next.board[b][a]===3-color)&&group(next.board,...g.stones[0]).liberties.length===1);
  const captured=all.filter(g=>g.color!==color&&g.stones.some(([a,b])=>next.board[b][a]===0));
  const add=(kind,targets)=>found[kind].push({x,y,targets:targets.flatMap(g=>g.stones.map(point)),captured:next.captured});
  if(captured.length)add('capture',captured);
  if(saved.length)add('escape',saved);
  if(threatened.length>=2)add('double_atari',threatened);
  else if(threatened.length)add('atari',threatened);
 }
 return found;
}

/** Read-only rule facts. A local opportunity is not a best-move or mistake verdict. */
export function analyzeMatchPatterns(state,{catalog=[],profileId,limit=24,maxMoves=120}={}){
 const out={match_id:state?.match?.id||state?.match_id||null,source:'rules',note:'只核对提子、气数与打吃等局部事实；没有下这些点，不等于漏招或坏棋。这里不改练习成绩。',reviewed_moves:0,total_moves:state?.moves?.length||0,items:[]};
 if(state?.mode!=='free'||!state.match)return {...out,note:'请先选择一盘实战对局。'};
 const size=state.size,initial=state.initial_board;
 if(![9,19].includes(size)||!Array.isArray(initial)||initial.length!==size||initial.some(r=>!Array.isArray(r)||r.length!==size||r.some(c=>![0,1,2].includes(c)))||!Array.isArray(state.moves)||state.moves.length>1000)return {...out,incomplete:true,note:'棋谱格式不完整，暂时不能回看棋型。'};
 const colors=profileId?[1,2].filter(c=>state.match[c===1?'black':'white']?.profile_id===profileId):[1,2];
 if(!colors.length)return {...out,note:'当前学习者没有参加这盘棋。'};
 let board=clone(initial),toPlay=state.initial_player||1;const seen=[key(board)];
 const start=Math.max(0,state.moves.length-Math.max(1,Math.min(200,maxMoves))),found=[];
 for(let index=0;index<state.moves.length;index++){
  const move=state.moves[index];let next;
  try{if(!move||move.color!==toPlay)throw Error('turn');next=move.pass?{board}:play(board,move.x,move.y,move.color,seen);}catch{return {...out,items:[],incomplete:true,note:`棋谱第 ${index+1} 手无法按规则重放，暂不展示可能不准确的棋型。`};}
  if(index>=start&&colors.includes(move.color)){
   out.reviewed_moves++;const options=opportunities(board,move.color,seen);
   // At most one strongest theme per turn. Preserve successful recognitions too.
   const kind=Object.keys(TYPES).find(k=>options[k].some(p=>same(move,p)))||Object.keys(TYPES).find(k=>options[k].length);
   if(kind){const candidates=options[kind],actual=candidates.find(p=>same(move,p)),fact=actual||candidates[0],type=TYPES[kind];
    const easiest=(a,b)=>(a.difficulty||1)-(b.difficulty||1)||a.id.localeCompare(b.id);
    const lesson=catalog.filter(l=>l.concept===kind).sort(easiest)[0]||catalog.filter(l=>l.skill===type.skill&&!l.sequence&&l.difficulty===1).sort(easiest)[0]||catalog.filter(l=>l.skill===type.skill).sort(easiest)[0];
    const status=actual?'played':'available',description={capture:'提走对方棋子',escape:'让被打吃的己方棋块重新有至少两口气',double_atari:'让对方两块原本有两口气的棋同时只剩一口气',atari:'让对方原本有两口气的一块棋只剩一口气'}[kind];
    found.push({id:`${out.match_id}:${index+1}:${kind}`,move_number:index+1,color:move.color,kind,status,title:type.title,prompt:`回到第 ${index+1} 手落子前。轮到${move.color===1?'黑':'白'}棋，你能找到${type.title}的点吗？`,explanation:actual?`你当时走在 ${coord(move.x,move.y,size)}，这手确实${description}。`:`当时 ${coord(fact.x,fact.y,size)} 可以${description}。你走了${move.pass?'停一手':coord(move.x,move.y,size)}；是否值得这样下，还要结合全局判断。`,before_board:clone(board),actual_move:clone(move),candidates:candidates.map(p=>({x:p.x,y:p.y})),targets:fact.targets,lesson:lesson?{id:lesson.id,title:lesson.title,skill:lesson.skill}:null});
   }
  }
  board=next.board;toPlay=3-toPlay;if(!move.pass)seen.push(key(board));
 }
 out.items=found.slice(-Math.max(1,Math.min(50,limit))).reverse();out.scanned_from_move=start+1;
 if(start)out.note+=` 本次检查最近 ${state.moves.length-start} 手。`;
 return out;
}
