import {clone,coord,COLS,key,play,boardFor,group} from './rules.mjs';
import {sequenceNode,captureGoalComplete} from './game.mjs';
import authorVariations from '../data/gogameguru/review-variations.json' with {type:'json'};

// Reconstruct exactly the position before the unanswered move, including ko history.
export function reviewPosition(state){
 if(state.mode!=='lesson'||!state.lesson?.sequence||state.demo_active||state.lesson_progress?.status!=='unlisted'||!state.lesson_attempted)throw new Error('请先在连续题中下一手，再复核参考答案以外的走法。');
 const candidate=state.moves?.at(-1),previous=state.history?.at(-1);
 if(!candidate||candidate.pass||!previous||!Number.isInteger(previous.move_number)||previous.move_number!==state.moves.length-1)throw new Error('这手缺少落子前的局面，请重练后再复核。');
 const before=clone(state);Object.assign(before,clone(previous));before.moves=before.moves.slice(0,previous.move_number);before.history=before.history.slice(0,-1);
 const reference=sequenceNode(before)?.children?.[0]?.move;
 if(!reference||before.to_play!==candidate.color)throw new Error('这手没有可比较的参考变化，请查看参考解法。');
 if(key(play(before.board,candidate.x,candidate.y,candidate.color,[key(before.board),...before.history.map(h=>key(h.board))]).board)!==key(state.board))throw new Error('落子历史与棋盘不一致，请重练后再复核。');
 before.review={candidate:{x:candidate.x,y:candidate.y},reference:{x:reference[0],y:reference[1]}};
 return before;
}
function decode(value,size){
 if(typeof value!=='string')return null;
 const match=/^([A-HJ-Z])(\d+)$/.exec(value.toUpperCase());if(!match)return null;
 const x=COLS.indexOf(match[1]),y=size-Number(match[2]);return x>=0&&x<size&&y>=0&&y<size?{x,y}:null;
}
function variation(before,values){
 let board=before.board,color=before.to_play;const seen=[key(board),...before.history.map(h=>key(h.board))],pv=[];
 for(const value of (values||[]).slice(0,8)){
  if(typeof value==='string'&&value.toLowerCase()==='pass')break;
  const point=decode(value,before.size);if(!point)return [];
  try{board=play(board,point.x,point.y,color,seen).board;}catch{return [];}
  pv.push({...point,color});seen.push(key(board));color=3-color;
 }
 return pv;
}
export function unavailableReview(before){return {source:'unavailable',verdict:'uncertain',summary:'复核服务暂时没有完成，请再试一次。',explanation:'这手已保留。可以点击“重新复核”，或查看参考解法；本次不计对错。',pv:[],reference_move:before?.review?.reference||null};}
export function ruleReview(state){return captureGoalComplete(state)?{source:'rules',verdict:'solved',summary:'目标已提掉，这手完成了题目。',explanation:'已按实际落子历史核对目标提子，可以通过本题，不要求与参考答案完全相同。',pv:[],reference_move:null}:null;}
export function authorReview(state,trustedLesson){
 if(!trustedLesson||trustedLesson.id!==state.lesson?.id||state.lesson.objective?.kind!=='authored_solution'||state.lesson.source?.url!==trustedLesson.source?.url||trustedLesson.to_play!==state.initial_player||key(boardFor(trustedLesson))!==key(state.initial_board))return null;
 const record=authorVariations.lessons[state.lesson.id]?.find(r=>r.moves.length===state.moves.length&&r.moves.every(([x,y],i)=>state.moves[i].x===x&&state.moves[i].y===y&&state.moves[i].color===(i%2?3-state.initial_player:state.initial_player)));
 if(!record)return null;
 let board=state.board,color=state.to_play;const seen=[key(board),...state.history.map(h=>key(h.board))],pv=[];
 for(const[x,y]of record.pvReply){try{board=play(board,x,y,color,seen).board;}catch{return null;}pv.push({x,y,color});seen.push(key(board));color=3-color;}
 const labels=(record.evidence_labels||[]).map(l=>`${l.label}=${coord(...l.move,state.size)}`).join('，');
 return {source:'author',verdict:'mistake',summary:'这手不成立，原作者收录了反驳。',explanation:(record.reason_zh||'原作者明确指出，这条变化不能完成黑棋的目标。')+(pv.length?` 对手可在 ${coord(pv[0].x,pv[0].y,state.size)} 应对。`:'')+(labels?` 原图标记：${labels}。`:'')+' 可以重练或查看参考解法。',author_comment:record.reason,source_url:record.source.url,pv,reference_move:null};
}
export function engineReview(before,result){
 const candidateName=coord(before.review.candidate.x,before.review.candidate.y,before.size),referenceName=coord(before.review.reference.x,before.review.reference.y,before.size);
 const candidate=result?.candidate,reference=result?.reference,sign=before.to_play===1?1:-1;
 const review={source:'katago',verdict:'uncertain',summary:'KataGo 还不能可靠地区分这两手。',explanation:'计算证据不足，本次不计对错；可以重练，或查看参考解法。',pv:[],reference_move:before.review.reference,engine_backend:result?.engine_backend};
 if(result?.revision!==before.revision||result.perspective!=='black'||candidate?.move!==candidateName||reference?.move!==referenceName)return review;
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 const candidateScore=candidate.rootInfo?.scoreLead,referenceScore=reference.rootInfo?.scoreLead,counts=[candidate.rootInfo?.visits,reference.rootInfo?.visits],visits=counts.every(n=>Number.isSafeInteger(n)&&n>=0)?Math.min(...counts):0;
 const best=candidate.moves?.find(m=>m.move===candidateName),pv=variation(before,best?.pv);
 if(!pv.length||pv[0].x!==before.review.candidate.x||pv[0].y!==before.review.candidate.y)return review;
 review.pv=pv;
 const owns=o=>Array.isArray(o)&&o.length===before.size**2&&o.every(x=>number(x)&&Math.abs(x)<=1.001);
 if(!number(candidateScore)||!number(referenceScore)||!owns(candidate.ownership)||!owns(reference.ownership)||visits<24){review.explanation='当前计算量或局部证据还不足，先看下方试算变化；需要时可重新复核，本次不计对错。';return review;}
 const scoreLoss=(referenceScore-candidateScore)*sign;
 // Compare ownership only at existing stones, not the vast empty surroundings of a local puzzle.
 let localLoss=0,worstGroupLoss=0;const visited=new Set();for(let y=0;y<before.size;y++)for(let x=0;x<before.size;x++)if(before.board[y][x]&&!visited.has(`${x},${y}`)){
  const stones=group(before.board,x,y).stones;let loss=0;for(const[a,b]of stones){visited.add(`${a},${b}`);const i=b*before.size+a;loss+=(reference.ownership[i]-candidate.ownership[i])*sign;}
  localLoss+=Math.max(0,loss);worstGroupLoss=Math.max(worstGroupLoss,loss/stones.length);
 }
 if(!visited.size)return review;
 review.evidence={score_loss:Number(scoreLoss.toFixed(1)),local_ownership_loss:Number(localLoss.toFixed(2)),worst_group_loss:Number(worstGroupLoss.toFixed(2)),min_visits:visits};
 const reply=pv[1],replyText=reply?`对手可在 ${coord(reply.x,reply.y,before.size)} 应对，具体试算见下方。`:'具体试算见下方。';
 if(scoreLoss>=4&&localLoss>=1.5){review.verdict='mistake';review.summary='KataGo 复核：这手有明显损失，建议换一手。';review.explanation=`与你的 ${candidateName} 相比，参考着 ${referenceName} 的估计结果约好 ${scoreLoss.toFixed(1)} 目，原有棋块的局部预测也更有利。${replyText}`;}
 else if(scoreLoss<=1.5&&localLoss<=0.5&&worstGroupLoss<=0.25){review.verdict='reasonable';review.summary='KataGo 复核：这手未见明显问题。';review.explanation=`你的 ${candidateName} 与参考着 ${referenceName} 比较，暂未发现明显损失。${replyText}`;}
 else {
  review.summary=scoreLoss>0&&localLoss>0?`KataGo 复核：更倾向 ${referenceName}，但还不能判错。`:'KataGo 复核：这手还需核对局部变化。';
  review.explanation=`本次试算中，${scoreLoss>=0?`参考着 ${referenceName} 比你的 ${candidateName}`:`你的 ${candidateName} 比参考着 ${referenceName}`}的全局估计约好 ${Math.abs(scoreLoss).toFixed(1)} 目；分数差和局部证据还不足以判定本题成败。${replyText}`;
 }
 review.explanation+=' 这是有限计算下的走法评价，不代表已证明做活、杀棋或完成本题，也不计入通关与正确率。';
 return review;
}
export function setReview(state,review){
 state.assessment={...state.assessment,correct:review.source==='rules'?true:review.source==='author'?false:null,summary:review.summary,explanation:review.explanation,review};
 if(review.source==='rules')state.lesson_progress.status='solved';
 if(review.source==='author')state.lesson_progress.status='failed';
 state.lesson_progress.message=review.summary;state.message=review.summary+' '+review.explanation;
}
