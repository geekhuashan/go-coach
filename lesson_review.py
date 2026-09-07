"""Local authored refutations and bounded KataGo evidence, never AI completion credit."""
from copy import deepcopy
import json
import math
from pathlib import Path
import re
from go_rules import group, key, play

COLS='ABCDEFGHJKLMNOPQRSTUVWXYZ'
BOOK=Path(__file__).resolve().parent/'data/gogameguru/review-variations.json'
AUTHOR_VARIATIONS=json.loads(BOOK.read_text(encoding='utf-8'))['lessons'] if BOOK.is_file() else {}


def coord(x,y,size):return COLS[x]+str(size-y)


def _node(state):
    node=state['lesson']['tree']
    for move in state.get('moves',[]):
        node=next((n for n in node.get('children',[]) if n['move']==[move['x'],move['y']]),None)
        if node is None:return None
    return node


def review_position(state):
    if state.get('mode')!='lesson' or not (state.get('lesson') or {}).get('sequence') or state.get('demo_active') or (state.get('lesson_progress') or {}).get('status')!='unlisted' or not state.get('lesson_attempted'):
        raise ValueError('请先在连续题中下一手，再复核参考答案以外的走法。')
    candidate=(state.get('moves') or [None])[-1];previous=(state.get('history') or [None])[-1]
    if not candidate or candidate.get('pass') or not previous or type(previous.get('move_number'))is not int or previous['move_number']!=len(state['moves'])-1:raise ValueError('这手缺少落子前的局面，请重练后再复核。')
    before=deepcopy(state);before.update(deepcopy(previous))
    before['moves']=deepcopy(state['moves'][:previous['move_number']]);before['history']=deepcopy(state['history'][:-1])
    children=(_node(before) or {}).get('children',[])
    if not children or before['to_play']!=candidate['color']:raise ValueError('这手没有可比较的参考变化，请查看参考解法。')
    replayed,_=play(before['board'],candidate['x'],candidate['y'],candidate['color'],[key(before['board'])]+[key(h['board']) for h in before['history']])
    if key(replayed)!=key(state['board']):raise ValueError('落子历史与棋盘不一致，请重练后再复核。')
    before['review']={'candidate':{'x':candidate['x'],'y':candidate['y']},'reference':{'x':children[0]['move'][0],'y':children[0]['move'][1]}}
    return before


def _variation(before,values):
    if not isinstance(values,list):return []
    board=before['board'];color=before['to_play'];seen=[key(board)]+[key(h['board']) for h in before.get('history',[])];pv=[]
    for value in values[:8]:
        if isinstance(value,str) and value.lower()=='pass':break
        match=re.fullmatch(r'([A-HJ-Z])([0-9]+)',value.upper()) if isinstance(value,str) else None
        if not match:return []
        x=COLS.index(match[1]);y=before['size']-int(match[2])
        try:board,_=play(board,x,y,color,seen)
        except ValueError:return []
        pv.append(dict(x=x,y=y,color=color));seen.append(key(board));color=3-color
    return pv


def unavailable_review(before=None):
    return dict(source='unavailable',verdict='uncertain',summary='复核服务暂时没有完成，请再试一次。',explanation='这手已保留。可以点击“重新复核”，或查看参考解法；本次不计对错。',pv=[],reference_move=(before or {}).get('review',{}).get('reference'))


def capture_goal_complete(state):
    objective=(state.get('lesson') or {}).get('objective',{});targets=objective.get('targets',[])
    boards=[state['board']]+[h['board'] for h in state.get('history',[])]
    captured=[any(board[y][x]!=3-state['initial_player'] for board in boards) for x,y in targets]
    return bool(targets) and (all(captured) if objective.get('kind')=='capture' else any(captured) if objective.get('kind')=='capture_any' else False)


def rule_review(state):
    return dict(source='rules',verdict='solved',summary='目标已提掉，这手完成了题目。',explanation='已按实际落子历史核对目标提子，可以通过本题，不要求与参考答案完全相同。',pv=[],reference_move=None) if capture_goal_complete(state) else None


def author_review(state,trusted_lesson):
    lesson=state.get('lesson') or {}
    if not trusted_lesson or trusted_lesson['id']!=lesson.get('id') or trusted_lesson.get('to_play',1)!=state.get('initial_player'):return None
    if lesson.get('objective',{}).get('kind')!='authored_solution' or lesson.get('source',{}).get('url')!=trusted_lesson.get('source',{}).get('url'):return None
    size=trusted_lesson.get('size',9);initial=[[0]*size for _ in range(size)]
    for p in trusted_lesson['stones']:
        x,y,color=(p['x'],p['y'],p['color']) if isinstance(p,dict) else p
        initial[y][x]=color
    if key(initial)!=key(state.get('initial_board',[])):return None
    moves=state.get('moves',[])
    record=next((r for r in AUTHOR_VARIATIONS.get(trusted_lesson['id'],[]) if len(r['moves'])==len(moves) and all(m['x']==x and m['y']==y and m['color']==(state['initial_player'] if i%2==0 else 3-state['initial_player']) for i,((x,y),m) in enumerate(zip(r['moves'],moves)))),None)
    if not record:return None
    board=state['board'];color=state['to_play'];seen=[key(board)]+[key(h['board']) for h in state.get('history',[])];pv=[]
    for x,y in record['pvReply']:
        try:board,_=play(board,x,y,color,seen)
        except ValueError:return None
        pv.append(dict(x=x,y=y,color=color));seen.append(key(board));color=3-color
    labels='，'.join(f"{label['label']}={coord(*label['move'],state['size'])}" for label in record.get('evidence_labels',[]))
    explanation=record.get('reason_zh') or '原作者明确指出，这条变化不能完成黑棋的目标。'
    if pv:explanation+=f" 对手可在 {coord(pv[0]['x'],pv[0]['y'],state['size'])} 应对。"
    if labels:explanation+=' 原图标记：'+labels+'。'
    return dict(source='author',verdict='mistake',summary='这手不成立，原作者收录了反驳。',explanation=explanation+' 可以重练或查看参考解法。',author_comment=record['reason'],source_url=record['source']['url'],pv=pv,reference_move=None)


def engine_review(before,result):
    candidate_name=coord(**before['review']['candidate'],size=before['size']);reference_name=coord(**before['review']['reference'],size=before['size'])
    review=dict(source='katago',verdict='uncertain',summary='KataGo 还不能可靠地区分这两手。',explanation='计算证据不足，本次不计对错；可以重练，或查看参考解法。',pv=[],reference_move=before['review']['reference'])
    if not isinstance(result,dict):return review
    if result.get('engine_backend') is not None:review['engine_backend']=result['engine_backend']
    candidate=result.get('candidate');reference=result.get('reference')
    if type(result.get('revision'))is not int or result.get('revision')!=before['revision'] or result.get('perspective')!='black' or not isinstance(candidate,dict) or not isinstance(reference,dict) or candidate.get('move')!=candidate_name or reference.get('move')!=reference_name:return review
    def number(value):
        if type(value) not in (int,float):return False
        try:return math.isfinite(value)
        except OverflowError:return False
    info=lambda v:v.get('rootInfo') if isinstance(v.get('rootInfo'),dict) else {}
    candidate_score=info(candidate).get('scoreLead');reference_score=info(reference).get('scoreLead');counts=[info(candidate).get('visits'),info(reference).get('visits')]
    visits=min(counts) if all(type(n)is int and 0<=n<=9007199254740991 for n in counts) else 0
    moves=candidate.get('moves');best=next((m for m in moves if isinstance(m,dict) and m.get('move')==candidate_name),{}) if isinstance(moves,list) else {}
    pv=_variation(before,best.get('pv'))
    if not pv or pv[0]['x']!=before['review']['candidate']['x'] or pv[0]['y']!=before['review']['candidate']['y']:return review
    review['pv']=pv
    owns=lambda values:isinstance(values,list) and len(values)==before['size']**2 and all(number(v) and abs(v)<=1.001 for v in values)
    if not number(candidate_score) or not number(reference_score) or not owns(candidate.get('ownership')) or not owns(reference.get('ownership')) or visits<24:
        review['explanation']='当前计算量或局部证据还不足，先看下方试算变化；需要时可重新复核，本次不计对错。';return review
    sign=1 if before['to_play']==1 else -1;score_loss=(reference_score-candidate_score)*sign
    local_loss=0;worst_group_loss=0;visited=set()
    for y,row in enumerate(before['board']):
        for x,color in enumerate(row):
            if not color or (x,y) in visited:continue
            stones,_=group(before['board'],x,y);loss=0
            for a,b in stones:
                visited.add((a,b));i=b*before['size']+a
                loss+=(reference['ownership'][i]-candidate['ownership'][i])*sign
            local_loss+=max(0,loss);worst_group_loss=max(worst_group_loss,loss/len(stones))
    if not visited:return review
    review['evidence']=dict(score_loss=round(score_loss,1),local_ownership_loss=round(local_loss,2),worst_group_loss=round(worst_group_loss,2),min_visits=visits)
    reply=pv[1] if len(pv)>1 else None;reply_text=f"对手可在 {coord(reply['x'],reply['y'],before['size'])} 应对，具体试算见下方。" if reply else '具体试算见下方。'
    if score_loss>=4 and local_loss>=1.5:
        review.update(verdict='mistake',summary='KataGo 复核：这手有明显损失，建议换一手。',explanation=f'与你的 {candidate_name} 相比，参考着 {reference_name} 的估计结果约好 {score_loss:.1f} 目，原有棋块的局部预测也更有利。'+reply_text)
    elif score_loss<=1.5 and local_loss<=0.5 and worst_group_loss<=.25:
        review.update(verdict='reasonable',summary='KataGo 复核：这手未见明显问题。',explanation=f'你的 {candidate_name} 与参考着 {reference_name} 比较，暂未发现明显损失。'+reply_text)
    else:
        review['summary']=f'KataGo 复核：更倾向 {reference_name}，但还不能判错。' if score_loss>0 and local_loss>0 else 'KataGo 复核：这手还需核对局部变化。'
        comparison=f'参考着 {reference_name} 比你的 {candidate_name}' if score_loss>=0 else f'你的 {candidate_name} 比参考着 {reference_name}'
        review['explanation']=f'本次试算中，{comparison}的全局估计约好 {abs(score_loss):.1f} 目；分数差和局部证据还不足以判定本题成败。'+reply_text
    review['explanation']+=' 这是有限计算下的走法评价，不代表已证明做活、杀棋或完成本题，也不计入通关与正确率。'
    return review


def set_review(state,review):
    state['assessment']={**(state.get('assessment') or {}),'correct':True if review['source']=='rules' else False if review['source']=='author' else None,'summary':review['summary'],'explanation':review['explanation'],'review':review}
    if review['source']=='rules':state['lesson_progress']['status']='solved'
    if review['source']=='author':state['lesson_progress']['status']='failed'
    state['lesson_progress']['message']=review['summary'];state['message']=review['summary']+' '+review['explanation']
