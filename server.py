#!/usr/bin/env python3
"""Local shared teaching board, stdlib only. Bind exclusively to loopback."""
import argparse
import hashlib
import copy
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from go_rules import group, key, play
import curriculum

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('GO_COACH_DATA_DIR',str(ROOT / '.local')))
FILE = DATA_DIR / 'state.json'
LOCK = threading.RLock()
PROFILE_FILE = DATA_DIR / 'profiles.json'
IMPORT_FILE = DATA_DIR / 'imported-lessons.json'

def now():
    return datetime.now(timezone.utc).isoformat()

def lesson_public(lesson):
    out={k:copy.deepcopy(v) for k,v in lesson.items() if k not in ('objective','solutions','solution','tree')}
    points=[(p['x'],p['y']) if isinstance(p,dict) else tuple(p[:2]) for p in lesson.get('stones',[])]
    def walk(node):
        if node.get('move'): points.append(tuple(node['move']))
        for child in node.get('children',[]): walk(child)
    walk(lesson.get('tree',{}))
    size=lesson.get('size',9)
    points=[p for p in points if len(p)==2 and all(type(v)is int and 0<=v<size for v in p)]
    out['focus_bounds']={'min_x':min(x for x,y in points),'min_y':min(y for x,y in points),'max_x':max(x for x,y in points),'max_y':max(y for x,y in points)} if points else None
    return out


def practice_progress(profile,current_id=None,advance=False):
    import re
    catalog=[l for l in curriculum.catalog() if not l.get('legacy')]
    ids_order={l['id']:i for i,l in enumerate(catalog)}
    group_start={}
    for l in catalog: group_start.setdefault(re.sub(r'\d+$','',l['id']),ids_order[l['id']])
    catalog.sort(key=lambda l:(group_start[re.sub(r'\d+$','',l['id'])],int(re.search(r'\d+$',l['id']).group()) if re.search(r'\d+$',l['id']) else 0))
    mode=profile.get('practice_mode','recommended')
    current=next((l for l in catalog if l['id']==current_id),None)
    collection=curriculum.sequential_collection(current) if mode=='sequential' else None
    if mode=='sequential':
        if collection:
            catalog=[l for l in catalog if curriculum.sequential_collection(l)==collection]
            if collection[0]=='licensed':
                catalog.sort(key=lambda l:(l.get('difficulty') or 99,curriculum.sequential_problem_number(l),l['id']))
            else:
                catalog.sort(key=lambda l:(curriculum.sequential_problem_number(l),l['id']))
        else:
            catalog=[l for l in catalog if curriculum.sequential_collection(l) is None]
            catalog.sort(key=lambda l:curriculum.sequential_rank(l,group_start))
    ordered_ids=[l['id'] for l in catalog]
    catalog=[l for l in catalog if curriculum.available_lesson(l)]
    completed={a['lesson_id'] for a in profile['attempts'] if a.get('correct') is True}
    review=set(profile.get('helped_lesson_ids',[]))|{a['lesson_id'] for a in profile['attempts'] if a.get('correct') is False}
    ids=[l['id'] for l in catalog]
    index=ids.index(current_id) if current_id in ids else -1
    anchor=ordered_ids.index(current_id) if current_id in ordered_ids else -1
    pool=[identity for identity in ids if identity not in completed and (mode!='review' or identity in review)]
    next_id=next((identity for identity in pool if ordered_ids.index(identity)>anchor),pool[0] if pool else None) if advance else (pool[0] if pool else None)
    result=dict(mode=mode,total=len(ids),completed=len(set(ids)&completed),remaining=len(set(ids)-completed),current_index=index+1 if index>=0 else None,next_index=ids.index(next_id)+1 if next_id else None,review_count=len((set(ids)&review)-completed),next_id=next_id)
    if collection: result.update(book_title=collection[1],chapter=curriculum.sequential_chapter(current),book_complete=not pool)
    return result


def blank(revision=0, mode='free', size=9):
    if type(size) is not int or size not in (9,19): raise ValueError('棋盘尺寸须为 9 或 19 路。')
    return dict(last_human_assessment=None,assessment=None,assisted=False,revision=revision,size=size,board=[[0]*size for _ in range(size)],to_play=1,move_number=0,captures={'black':0,'white':0},last_move=None,mode=mode,lesson=None,message='黑棋先行。可以落子，也可以选择一项练习。',marks=[],history=[],ended=False,engine={'available':False},feedback=[],passes=0,demo_active=False,lesson_attempted=False,demo_step=0,demo_total=0,initial_board=[[0]*size for _ in range(size)],initial_player=1,moves=[])


def lesson_state(identity, revision):
    lesson = curriculum.get_lesson(identity)
    if not lesson:
        raise ValueError('没有这项练习。')
    s = blank(revision,'lesson',lesson.get('size',9))
    s['lesson'] = copy.deepcopy(lesson)
    s['message'] = lesson['prompt']
    s['marks'] = copy.deepcopy(lesson.get('marks',[]))
    for piece in lesson['stones']:
        if isinstance(piece,dict): x,y,c=piece['x'],piece['y'],piece['color']
        else: x,y,c=piece
        s['board'][y][x]=c
    s['to_play']=s['initial_player']=lesson.get('to_play',1)
    s['initial_board']=copy.deepcopy(s['board'])
    if lesson.get('sequence'):
        s['lesson_progress']={'status':'playing','ply':0,'message':'连续计算题：你落子后，对手会按收录变化自动应手。'}
    return s


def snapshot(s):
    return copy.deepcopy({k:v for k,v in s.items() if k not in ('history','engine','_demo_backup')})


def save(store):
    PROFILE_FILE.parent.mkdir(parents=True,exist_ok=True)
    # Keep the original single-board file intact and also make an explicit backup.
    if not PROFILE_FILE.exists() and FILE.exists():
        backup=FILE.with_name('state.pre-profiles.json')
        if not backup.exists(): backup.write_bytes(FILE.read_bytes())
    temporary = PROFILE_FILE.with_suffix('.tmp')
    with temporary.open('w',encoding='utf-8') as f:
        json.dump(store,f,ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, PROFILE_FILE)


def make_profile(identity,name,state=None):
    return dict(id=identity,name=name,state=state or lesson_state('escape-1-1',0),attempts=[],notes=[],helped_lesson_ids=[],created_at=now())


def load_store():
    if PROFILE_FILE.exists():
        data=json.loads(PROFILE_FILE.read_text(encoding='utf-8'))
        if data.get('schema')!=2: raise ValueError('学习档案版本不支持，原档案未修改。')
        data.setdefault('matches',{})
        for p in data['profiles'].values():p.setdefault('helped_lesson_ids',[])
        return data
    state=lesson_state('escape-1-1',0)
    if FILE.exists():
        state=json.loads(FILE.read_text(encoding='utf-8'))
        state['assessment']=None
        state.setdefault('assisted',False)
        # Upgrade a built-in lesson definition; do not infer historical scores.
        if state.get('lesson') and state['lesson'].get('id')!='custom':
            state['lesson']=copy.deepcopy(curriculum.get_lesson(state['lesson']['id']))
    parent=make_profile('parent','我',state)
    parent['notes']=copy.deepcopy(state.get('feedback',[]))
    return dict(schema=2,matches={},revision=state.get('revision',0),active_profile_id='parent',profiles={'parent':parent,'child':make_profile('child','宝宝')})


def computer_turn(s):
    match=s.get('match') or {}
    side=match.get('black' if s['to_play']==1 else 'white',{})
    return s['mode']=='free' and not s['ended'] and not s['demo_active'] and side.get('type')=='ai'


def participants(record):
    return {p.get('profile_id') for p in record['players'].values() if p.get('profile_id')}


def match_list(store,identity):
    records=[r for r in store.get('matches',{}).values() if identity in participants(r)]
    return sorted(records,key=lambda r:r['updated_at'],reverse=True)


def save_match(store,s):
    if s.get('mode')!='free' or not s.get('match'): return
    # Teaching demonstrations never overwrite the playable game record.
    source=s.get('_demo_backup',s) if s.get('demo_active') else s
    archived=copy.deepcopy(source)
    def strip_notes(value):
        if isinstance(value,dict):
            value.pop('feedback',None)
            for v in value.values():strip_notes(v)
        elif isinstance(value,list):
            for v in value:strip_notes(v)
    strip_notes(archived)
    version=store['revision']+1
    archived['_match_version']=version
    s['_match_version']=version
    match=s['match']
    store.setdefault('matches',{})[match['id']]=dict(id=match['id'],mode=match['mode'],players={'black':copy.deepcopy(match['black']),'white':copy.deepcopy(match['white'])},move_number=source['move_number'],ended=source['ended'],updated_at=now(),version=version,state=archived)


def create_match(store,action):
    mode=action.get('match_mode','two_player')
    if mode not in ('human_ai','two_player'):raise ValueError('请选择人机对弈或双人对弈。')
    active=store['active_profile_id']
    def human(identity):
        if identity not in store['profiles']:raise ValueError('找不到对局参与者。')
        return {'type':'human','profile_id':identity,'name':store['profiles'][identity]['name']}
    match={'id':uuid.uuid4().hex,'mode':mode}
    if mode=='human_ai':
        color=action.get('human_color',1)
        if type(color)is not int or color not in (1,2):raise ValueError('执棋颜色无效。')
        match.update(human_color=color)
        match['black' if color==1 else 'white']=human(active)
        match['white' if color==1 else 'black']={'type':'ai','name':'KataGo'}
    else:
        black=action.get('black_profile_id',active)
        white=action.get('white_profile_id',next((p for p in store['profiles'] if p!=black),None))
        if black==white:raise ValueError('双人对弈请选择两位不同的学习者。')
        if active not in (black,white):raise ValueError('当前学习者需要参与这盘棋。')
        match.update(black=human(black),white=human(white))
    return match


def active_state(store):
    profile=store['profiles'][store['active_profile_id']]
    s=profile['state']
    record=store.get('matches',{}).get(s.get('match_id'))
    if record and not s.get('demo_active') and record['version']>s.get('_match_version',-1):
        s=copy.deepcopy(record['state']);profile['state']=s
        s['feedback']=copy.deepcopy(profile['notes'])
    s['revision']=store['revision']
    return s


def context_key(s):
    context={k:s.get(k) for k in ('board','moves','initial_board','to_play','mode','move_number','captures','ended','demo_active')}
    context['lesson_id']=(s.get('lesson') or {}).get('id')
    context['match_id']=s.get('match_id')
    review=(s.get('assessment') or {}).get('review')
    if review is not None:context['review']=review
    return hashlib.sha256(json.dumps(context,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def public_store(store):
    profile=store['profiles'][store['active_profile_id']]
    out=public(active_state(store))
    out.update(profile={'id':profile['id'],'name':profile['name']},profiles=[{'id':p['id'],'name':p['name']} for p in store['profiles'].values()],learning=curriculum.learning(profile['attempts']),recent_attempts=copy.deepcopy(profile['attempts'][-10:][::-1]))
    suggested=curriculum.recommend(profile['attempts'],(out.get('lesson') or {}).get('id'))
    out['learning']['recommendation']={k:suggested[k] for k in ('id','title','skill','difficulty','reason','adjustment','concept') if k in suggested}
    current_key=context_key(out)
    out['context_key']=current_key
    out['llm_explanation']=next((copy.deepcopy(e) for e in reversed(profile.get('llm_explanations',[])) if e.get('context_key')==current_key),None)
    out['practice_mode']=profile.get('practice_mode','recommended')
    out['practice_progress']=practice_progress(profile,(out.get('lesson') or {}).get('id'),True)
    out['computer_turn']=computer_turn(out)
    out['recent_matches']=[{k:copy.deepcopy(v) for k,v in r.items() if k not in ('state','version')} for r in match_list(store,profile['id'])[:5]]
    return out


def apply_store(store,action,ai_choice=None,reviewer=None):
    kind=action.get('type')
    if kind=='switch_profile':
        identity=action.get('profile_id')
        if identity not in store['profiles']: raise ValueError('找不到这位学习者。')
        store['active_profile_id']=identity
    elif kind=='add_profile':
        name=str(action.get('name','')).strip()
        if not name or len(name)>30: raise ValueError('名称需要 1 至 30 个字符。')
        if len(store['profiles'])>=20: raise ValueError('最多保存 20 位学习者。')
        if any(p['name']==name for p in store['profiles'].values()): raise ValueError('已有同名学习者，请换个名称。')
        identity='learner-'+uuid.uuid4().hex[:12]
        store['profiles'][identity]=make_profile(identity,name)
        store['active_profile_id']=identity
    else:
        profile=store['profiles'][store['active_profile_id']]
        s=active_state(store)
        if kind=='practice_mode' and action.get('mode') not in ('recommended','sequential','review'): raise ValueError('练习模式无效。')
        if kind in ('next_lesson','practice_mode') and s.get('demo_active'): raise ValueError('请先返回原局面。')
        if kind in ('next_lesson','practice_mode') and (s.get('lesson') or {}).get('sequence') and s.get('moves') and not s.get('lesson_attempted'):
            pending=s['lesson']['id'];helped=profile.setdefault('helped_lesson_ids',[])
            if pending not in helped: helped.append(pending)
        if kind in ('next_lesson','practice_mode'):
            if s.get('demo_active'): raise ValueError('请先返回原局面。')
            if kind=='practice_mode':
                if action.get('mode') not in ('recommended','sequential','review'): raise ValueError('练习模式无效。')
                profile['practice_mode']=action['mode']
            if profile.get('practice_mode','recommended')=='recommended':
                choice=curriculum.recommend(profile['attempts'],(s.get('lesson') or {}).get('id'))
                identity=choice if isinstance(choice,str) else choice.get('id',choice.get('lesson_id'))
            else: identity=practice_progress(profile,(s.get('lesson') or {}).get('id'),kind=='next_lesson')['next_id']
            if not identity:
                progress=practice_progress(profile,(s.get('lesson') or {}).get('id'))
                s['message']='当前没有待复习的题目。' if profile.get('practice_mode')=='review' else f'《{progress["book_title"]}》已导入的题目全部完成。' if progress.get('book_title') else '本轮题目已全部通关。'
                store['revision']+=1
                active_state(store)
                return store
            action={'type':'lesson','id':identity}
        notes=copy.deepcopy(profile['notes'])
        helped=profile.setdefault('helped_lesson_ids',[])
        lesson_id=(s.get('lesson') or {}).get('id')
        if lesson_id in helped: s['assisted']=True
        if kind in ('retry','lesson','next_lesson','practice_mode','new','setup','resume_match') and (s.get('lesson') or {}).get('sequence') and s.get('moves') and not s.get('lesson_attempted'):
            if lesson_id not in helped: helped.append(lesson_id)
        if kind=='new':
            match=create_match(store,action)
            if s.get('mode')=='free' and not s.get('match') and s.get('moves'):
                legacy=create_match(store,{'match_mode':'two_player'})
                s.update(match=legacy,match_id=legacy['id']);save_match(store,s)
            apply(s,action)
            s.update(match=match,match_id=match['id'])
            s['message']='人机对弈已开始。KataGo 棋力较强；可以悔棋练习。' if match['mode']=='human_ai' else '双人对弈已开始。请按黑白轮流落子。'
        elif kind=='resume_match':
            record=store.get('matches',{}).get(action.get('match_id'))
            if not record or profile['id'] not in participants(record):raise ValueError('找不到这位学习者参与的对局。')
            new=copy.deepcopy(record['state']);new['revision']=s['revision']
            s.clear();s.update(new)
            s['message']='已恢复这盘棋的最新进度。'
        elif kind=='ai_move':
            if not computer_turn(s):raise ValueError('当前没有轮到电脑。')
            apply(s,{'type':'pass'} if ai_choice is None or ai_choice.get('pass') else {'type':'play','x':ai_choice['x'],'y':ai_choice['y']})
        else:
            if kind in ('play','pass') and computer_turn(s):raise ValueError('现在轮到电脑，请等待电脑应手。')
            if kind=='undo' and (s.get('match') or {}).get('mode')=='human_ai':
                human_color=s['match']['human_color']
                if not any(m['color']==human_color for m in s.get('moves',[])):raise ValueError('你还没有落子，暂时没有可悔的决定。')
                apply(s,action)
                while s['history'] and s['to_play']!=human_color:apply(s,action)
                s['message']='已退回到你上次落子前，可以重新选择。'
            else:apply(s,action)
        if kind=='play' and s['mode']=='free':
            s['last_human_assessment']=copy.deepcopy(s.get('assessment'))
        did_review=False
        if kind=='review_move' or kind=='play' and (s.get('lesson_progress') or {}).get('status')=='unlisted':
            import lesson_review
            before=lesson_review.review_position(s);before['revision']=store['revision']
            review=lesson_review.rule_review(s) or lesson_review.author_review(s,curriculum.get_lesson(s['lesson']['id']))
            if not review:
                try:review=lesson_review.engine_review(before,reviewer(before)) if reviewer else lesson_review.unavailable_review(before)
                except Exception:review=lesson_review.unavailable_review(before)
            lesson_review.set_review(s,review);s['assisted']=True;did_review=True
            if lesson_id not in helped:helped.append(lesson_id)
        if lesson_id and (kind in ('hint','demo','solution') or kind=='inspect' and s.get('inspection',{}).get('stones') or kind=='undo' and (s.get('lesson') or {}).get('sequence') or (s.get('lesson_progress') or {}).get('status')=='unlisted'):
            if lesson_id not in helped: helped.append(lesson_id)
        if (s.get('lesson') or {}).get('id') in helped: s['assisted']=True
        if (s.get('lesson') or {}).get('sequence') and kind in ('lesson','next_lesson','retry','practice_mode'):
            identity=s['lesson']['id']
            runs=profile.setdefault('lesson_runs',{})
            s['_branch_seed']=runs.get(identity,0)
            runs[identity]=s['_branch_seed']+1
        if kind=='feedback':
            note=copy.deepcopy(s['feedback'][-1]);note.update(created_at=now(),profile_id=profile['id'],lesson_id=(s.get('lesson') or {}).get('id'))
            notes.append(note)
        profile['notes']=notes
        s['feedback']=copy.deepcopy(notes)
        if (kind=='play' or kind=='review_move' and did_review) and s.get('assessment') and s.get('lesson') and s['lesson'].get('id')!='custom':
            lesson=s['lesson'];assessment=s['assessment']
            if isinstance(assessment.get('correct'),bool):
                count=sum(a['lesson_id']==lesson['id'] for a in profile['attempts'])+1
                event=dict(created_at=now(),profile_id=profile['id'],lesson_id=lesson['id'],title=lesson['title'],skill=lesson['skill'],difficulty=lesson['difficulty'],correct=assessment['correct'],assisted=s.get('assisted',False),attempt_no=count,move=copy.deepcopy(s['moves'][-1]),summary=assessment.get('summary',''))
                profile['attempts'].append(event)
    if kind not in ('switch_profile','add_profile'):
        save_match(store,store['profiles'][store['active_profile_id']]['state'])
    store['revision']+=1
    active_state(store)
    return store


def engine_info():
    try:
        import engine
        return engine.info()
    except ImportError:
        return {'available':False,'message':'KataGo 尚未配置；教学摆题与双人落子可用。'}


def public(s):
    out=copy.deepcopy(s)
    if s.get('lesson'): out['lesson']=lesson_public(s['lesson'])
    out.pop('_demo_backup',None)
    out.pop('_demo_moves',None)
    def redact(value):
        if isinstance(value,dict):
            for name in ('objective','solutions','solution','tree','_branch_seed'): value.pop(name,None)
            for item in value.values(): redact(item)
        elif isinstance(value,list):
            for item in value: redact(item)
    redact(out)
    out['engine']=engine_info()
    return out


def move(s,x,y,color=None):
    if s['ended']:
        raise ValueError('双方已停一手，对局结束。可以悔棋或重新开始。')
    color=color or s['to_play']
    seen=[key(s['board'])]+[key(h['board']) for h in s['history']]
    before=copy.deepcopy(s['board'])
    board,captured=play(s['board'],x,y,color,seen)
    s['history'].append(snapshot(s))
    s.update(board=board,to_play=3-color,move_number=s['move_number']+1,last_move={'x':x,'y':y},passes=0,marks=[])
    s.setdefault('moves',[]).append({'color':color,'x':x,'y':y,'pass':False})
    s['captures']['black' if color==1 else 'white']+=captured
    _,libs=group(board,x,y)
    coord='ABCDEFGHJKLMNOPQRST'[x]+str(s['size']-y)
    s['message']=f'{"黑" if color==1 else "白"}棋落在 {coord}，这块棋有 {len(libs)} 口气。'+(f'本手提走 {captured} 颗棋子。' if captured else '')
    if s['mode']=='free' and not s['demo_active']:
        from feedback import free_feedback
        s['assessment']=free_feedback(before,board,{'x':x,'y':y},color,captured)
        s['marks']=copy.deepcopy(s['assessment'].get('marks',[]))
        s['message']=s['assessment'].get('summary','')+' '+s['assessment'].get('explanation','')
    if s['mode']=='lesson' and not s['demo_active'] and not s['lesson'].get('sequence'):
        s['lesson_attempted']=True
        if s['lesson']['id']=='custom':
            s['assessment']=None
            s['message']+='这一步的气与提子结果已显示。自定义题尚无评分目标，不计入学习水平。'
        else:
            assessment=curriculum.grade(s['lesson'],before,board,{'x':x,'y':y,'color':color},captured)
            s['assessment']=assessment
            s['marks']=copy.deepcopy(assessment.get('marks',[]))
            explanation=assessment.get('explanation','')
            if isinstance(explanation,list): explanation=' '.join(explanation)
            s['message']+=' '+assessment.get('summary','')+' '+explanation


def sequence_node(s):
    node=s['lesson']['tree']
    for m in s['moves']:
        node=next((n for n in node.get('children',[]) if n['move']==[m['x'],m['y']]),None)
        if node is None: return None
    return node


def sequence_play(s,x,y):
    """Follow validated continuations; unlisted alternatives are not called wrong."""
    node=sequence_node(s)
    if node is None: raise ValueError('当前变化未收录，请重试这道题。')
    child=next((n for n in node.get('children',[]) if n['move']==[x,y]),None)
    move(s,x,y)
    lesson=s['lesson']
    import lesson_review
    if lesson_review.capture_goal_complete(s):
        s['lesson_attempted']=True;status='solved';correct=True
        summary='目标已提掉，这手完成了题目。';explanation='已按棋盘规则核对实际提子结果，不要求落子与参考答案完全相同。'
    elif child is None:
        s['lesson_attempted']=True
        summary='这手走出了参考变化，等待复核。'
        explanation='可以复核这手的效果，也可以看参考解法或重练。'
        s['assisted']=True
        status='unlisted'; correct=None
    else:
        explanation=child.get('explanation','')
        replies=child.get('children',[])
        if replies:
            # Cycle authored replies across retries, keeping the choice stable
            # after reload and independent of timing or external model calls.
            reply=replies[(s.get('_branch_seed',0)+len(s['moves'])//2)%len(replies)]
            move(s,*reply['move'])
            explanation+=' '+reply.get('explanation','')
            child=reply
        solved=not child.get('children')
        s['lesson_attempted']=solved
        correct=True if solved else None
        status='solved' if solved else 'playing'
        summary=('已完成作者收录的正确变化。' if lesson.get('objective',{}).get('kind')=='authored_solution' else '这条吃子变化完成，目标已提掉。') if solved else '对手已应手，请继续计算下一手。'
    s['assessment']={'correct':correct,'summary':summary,'explanation':explanation.strip(),'marks':[], 'skill':lesson['skill'],'difficulty':lesson['difficulty']}
    s['lesson_progress']={'status':status,'ply':len(s['moves']),'message':summary}
    s['message']=summary+' '+explanation.strip()


def apply(s,a):
    t=a.get('type')
    if t=='play':
        if s['demo_active']: raise ValueError('正在演示，请先返回原局面。')
        if s['mode']=='lesson' and s.get('lesson_attempted'): raise ValueError('本轮练习已结束，请重试或选择下一题。')
        if (s.get('lesson') or {}).get('sequence'):
            sequence_play(s,a.get('x'),a.get('y'))
        else: move(s,a.get('x'),a.get('y'))
    elif t=='review_move':
        import lesson_review
        lesson_review.review_position(s)
    elif t=='ai_move':
        if s['demo_active'] or s['mode']=='lesson': raise ValueError('请在自由对弈中使用电脑应手。')
        try:
            import engine
        except ImportError:
            raise ValueError('KataGo 尚未配置。')
        choice=engine.choose_move(copy.deepcopy(s))
        if choice is None or choice.get('pass'):
            apply(s,{'type':'pass'})
        else:
            move(s,choice['x'],choice['y'])
    elif t=='pass':
        if s['demo_active'] or s['mode']=='lesson': raise ValueError('教学题与演示中不需要停一手。')
        if s['ended']: raise ValueError('对局已结束。')
        s['history'].append(snapshot(s))
        s.setdefault('moves',[]).append({'color':s['to_play'],'pass':True})
        s.update(to_play=3-s['to_play'],move_number=s['move_number']+1,last_move=None,passes=s['passes']+1)
        s['ended']=s['passes']>=2
        s['message']='双方连续停一手，对局结束。本版不自动判定死活与数目。' if s['ended'] else '已停一手，轮到对方。'
    elif t=='undo':
        if s['demo_active']: raise ValueError('请先返回演示前的局面。')
        if not s['history']: raise ValueError('还没有可以撤回的落子。')
        sequence=(s.get('lesson') or {}).get('sequence')
        hist=s['history']
        old=hist.pop()
        if sequence:
            while hist and old['to_play']!=s['initial_player']: old=hist.pop()
        revision=s['revision']
        feedback=copy.deepcopy(s.get('feedback',[]))
        s.clear();s.update(old,history=hist,revision=revision,feedback=feedback)
        if sequence: s['assisted']=True
        s['message']='已撤回上一步。'
    elif t=='retry':
        if not s.get('lesson') or s['demo_active']: raise ValueError('请在教学题原局面中重试。')
        new=blank(s['revision'],'lesson',s['size'])
        new.update(board=copy.deepcopy(s['initial_board']),initial_board=copy.deepcopy(s['initial_board']),to_play=s['initial_player'],initial_player=s['initial_player'],lesson=copy.deepcopy(s['lesson']),message=s['lesson']['prompt'])
        if s['lesson'].get('sequence'):
            new['lesson_progress']={'status':'playing','ply':0,'message':'已重置本题，再试一条收录变化。'}
        s.clear();s.update(new)
    elif t=='setup':
        pieces=a.get('stones',[])
        color=a.get('to_play',1)
        if type(color)is not int or color not in (1,2): raise ValueError('执棋颜色无效。')
        size=a.get('size',9)
        new=blank(s['revision'],'lesson',size)
        if not isinstance(pieces,list) or len(pieces)>size*size: raise ValueError('摆子格式无效。')
        for piece in pieces:
            if not isinstance(piece,dict): raise ValueError('摆子格式无效。')
            x,y,c=piece.get('x'),piece.get('y'),piece.get('color')
            if type(x)is not int or type(y)is not int or not 0<=x<size or not 0<=y<size or type(c)is not int or c not in (1,2): raise ValueError('摆子坐标或颜色无效。')
            if new['board'][y][x]: raise ValueError('不能在同一个点重复摆子。')
            new['board'][y][x]=c
        for y,row in enumerate(new['board']):
            for x,c in enumerate(row):
                if c and not group(new['board'],x,y)[1]: raise ValueError('摆题中的每块棋至少需要一口气。')
        title=str(a.get('title','老师的练习题'))[:200]
        prompt=str(a.get('prompt','请观察局面，再试着下一手。'))[:2000]
        new.update(to_play=color,initial_player=color,initial_board=copy.deepcopy(new['board']),lesson={'id':'custom','size':size,'title':title,'prompt':prompt,'hint':'先数相关棋块的气，再检查下一手的提子或连接效果。'},message=prompt)
        s.clear();s.update(new)
    elif t in ('new','lesson'):
        revision=s['revision']
        new=blank(revision,size=a.get('size',9)) if t=='new' else lesson_state(a.get('id'),revision)
        s.clear();s.update(new)
    elif t=='hint':
        if s['mode']=='lesson' and not s.get('lesson_attempted'): s['assisted']=True
        s['message']=s['lesson']['hint'] if s['lesson'] else '点击“查看气”，再点一颗棋子，可以检查整块棋的气。'
    elif t=='inspect':
        x,y=a.get('x'),a.get('y')
        if type(x)is not int or type(y)is not int or not (0<=x<s['size'] and 0<=y<s['size']): raise ValueError('坐标无效。')
        stones,libs=group(s['board'],x,y)
        if stones and s['mode']=='lesson' and not s.get('lesson_attempted'): s['assisted']=True
        s['inspection']={'stones':[{'x':a,'y':b} for a,b in sorted(stones)],'liberties':[{'x':a,'y':b} for a,b in sorted(libs)],'color':s['board'][y][x]}
        s['marks']=[{'x':a,'y':b,'label':'气'} for a,b in sorted(libs)]
        s['message']=f'这块棋共有 {len(stones)} 颗棋子、{len(libs)} 口气。斜对角不算气，相同空点只数一次。' if stones else '这里是空点，请选一颗棋子。'
    elif t=='annotate':
        marks=a.get('marks',[])
        if not isinstance(marks,list) or len(marks)>s['size']*s['size']: raise ValueError('标记格式无效。')
        for m in marks:
            if not isinstance(m,dict) or type(m.get('x'))is not int or type(m.get('y'))is not int or not 0<=m['x']<s['size'] or not 0<=m['y']<s['size']: raise ValueError('标记坐标无效。')
        s['marks']=[{'x':m['x'],'y':m['y'],'label':str(m.get('label',''))[:20]} for m in marks]
        s['message']=str(a.get('message',''))[:4000]
    elif t=='demo':
        if s['demo_active']: raise ValueError('请先恢复原局面，再开始新演示。')
        moves=a.get('moves',[])
        if not isinstance(moves,list) or len(moves)>100: raise ValueError('演示最多 100 手。')
        if not moves: raise ValueError('请提供至少一手演示。')
        checked=copy.deepcopy(s)
        checked['demo_active']=True
        for m in moves:
            if not isinstance(m,dict): raise ValueError('演示走法格式无效。')
            c=m.get('color',checked['to_play'])
            if type(c)is not int or c not in (1,2): raise ValueError('棋子颜色无效。')
            move(checked,m.get('x'),m.get('y'),c)
        s['_demo_backup']=copy.deepcopy(s)
        s.update(demo_active=True,demo_step=0,demo_total=len(moves),_demo_moves=copy.deepcopy(moves))
        apply(s,{'type':'demo_next'})
    elif t=='solution':
        if s['demo_active'] or not (s.get('lesson') or {}).get('sequence'): raise ValueError('请在连续练习原局面查看参考解法。')
        initial=lesson_state(s['lesson']['id'],s['revision'])
        def path(node,state,moves):
            if not node.get('children'): return moves if moves and node.get('correct') is not False else None
            for child in node['children']:
                checked=copy.deepcopy(state);checked['demo_active']=True
                try: move(checked,*child['move'])
                except ValueError: continue
                result=path(child,checked,moves+[{'x':child['move'][0],'y':child['move'][1]}])
                if result: return result
            return None
        moves=path(s['lesson']['tree'],initial,[])
        if not moves: raise ValueError('这道题暂时没有可演示的合法参考解法。')
        s['assisted']=True
        backup=copy.deepcopy(s)
        s.clear();s.update(initial,assisted=True,_demo_backup=backup,_demo_moves=moves,demo_active=True,demo_step=0,demo_total=len(moves))
        apply(s,{'type':'demo_next'})
    elif t=='demo_next':
        if not s['demo_active'] or s.get('demo_step',0)>=s.get('demo_total',0): raise ValueError('没有下一手演示。')
        m=s['_demo_moves'][s['demo_step']]
        move(s,m['x'],m['y'],m.get('color',s['to_play']))
        s['demo_step']+=1
        s['message']=f"演示第 {s['demo_step']} / {s['demo_total']} 手。"+s['message']+' 可以逐手查看，或返回原局面。'
    elif t=='restore_demo':
        if not s.get('_demo_backup'): raise ValueError('当前没有演示。')
        original=s['_demo_backup'];revision=s['revision']
        feedback=copy.deepcopy(s.get('feedback',[]))
        s.clear();s.update(original,revision=revision,feedback=feedback)
        s['message']='已返回演示前的原局面。'
    elif t=='feedback':
        message=str(a.get('text','')).strip()[:4000]
        if not message: raise ValueError('请写下你的想法。')
        s.setdefault('feedback',[]).append({'text':message,'move_number':s['move_number'],'revision':s['revision']})
        s['message']='想法已保存在这位学习者的本地档案中。'
    else: raise ValueError('未知操作。')
    if t!='inspect': s.pop('inspection',None)


def export_sgf(s):
    """Export board and moves only; never include conversation/feedback."""
    initial=s.get('initial_board',[[0]*s['size'] for _ in range(s['size'])])
    def coordinate(x,y): return chr(97+x)+chr(97+y)
    out=f"(;GM[1]FF[4]CA[UTF-8]AP[GoCoach:1]SZ[{s['size']}]KM[7.5]RU[Chinese]PL[{'B' if s.get('initial_player',1)==1 else 'W'}]"
    for color,prop in ((1,'AB'),(2,'AW')):
        points=[coordinate(x,y) for y,row in enumerate(initial) for x,c in enumerate(row) if c==color]
        if points: out+=prop+''.join('['+point+']' for point in points)
    for move in s.get('moves',[]):
        point='' if move.get('pass') else coordinate(move['x'],move['y'])
        out+=';'+('B' if move['color']==1 else 'W')+'['+point+']'
    return out+')'

curriculum.load_imports(IMPORT_FILE)
STORE=load_store()
STATE=active_state(STORE)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT/'static'),**kwargs)
    def log_message(self,*args): pass
    def allowed(self):
        port=self.server.server_port
        expected={f'127.0.0.1:{port}',f'localhost:{port}'}
        if self.headers.get('Host') not in expected: return False
        origin=self.headers.get('Origin')
        return origin is None or origin in {f'http://{h}' for h in expected}
    def respond(self,code,obj):
        body=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        if not self.allowed(): return self.respond(403,{'error':'只允许本地棋盘访问。'})
        route=urlparse(self.path).path
        if route=='/api/sgf':
            with LOCK:
                identity=parse_qs(urlparse(self.path).query).get('match_id',[None])[0]
                record=STORE.get('matches',{}).get(identity) if identity else None
                if identity and (not record or STORE['active_profile_id'] not in participants(record)):return self.respond(404,{'error':'对局不存在。'})
                body=export_sgf(record['state'] if record else STATE).encode('utf-8')
            self.send_response(200);self.send_header('Content-Type','application/x-go-sgf; charset=utf-8');self.send_header('Content-Disposition','attachment; filename=go-coach.sgf');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            return
        if route=='/api/llm/settings':
            try:
                import llm_client
                return self.respond(200,llm_client.settings_public())
            except Exception:
                return self.respond(503,{'error':'暂时无法读取讲解服务配置。'})
        if route=='/api/health': return self.respond(200,{'app':'go-coach','ok':True})
        if route=='/api/state':
            with LOCK: return self.respond(200,public_store(STORE))
        if route=='/api/lessons':
            with LOCK: return self.respond(200,[lesson_public(l) for l in curriculum.catalog() if curriculum.available_lesson(l)])
        if route=='/api/profiles':
            with LOCK: return self.respond(200,public_store(STORE)['profiles'])
        if route=='/api/matches':
            with LOCK:return self.respond(200,copy.deepcopy(match_list(STORE,STORE['active_profile_id'])))
        if route=='/api/history':
            with LOCK:
                identity=parse_qs(urlparse(self.path).query).get('profile_id',[STORE['active_profile_id']])[0]
                profile=STORE['profiles'].get(identity)
                if not profile: return self.respond(404,{'error':'找不到这位学习者。'})
                return self.respond(200,{'profile':{'id':profile['id'],'name':profile['name']},'attempts':copy.deepcopy(profile['attempts']),'notes':copy.deepcopy(profile['notes']),'llm_explanations':copy.deepcopy(profile.get('llm_explanations',[]))})
        if route.startswith('/api/'): return self.respond(404,{'error':'接口不存在。'})
        super().do_GET()
    def do_POST(self):
        global STATE, STORE
        if not self.allowed(): return self.respond(403,{'error':'只允许本地棋盘访问。'})
        if self.path not in ('/api/action','/api/analyze','/api/lessons/import','/api/llm/settings','/api/llm/test','/api/llm/explain'): return self.respond(404,{'error':'接口不存在。'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            limit=262144 if self.path=='/api/lessons/import' else 32768
            if not 0<length<=limit: return self.respond(413,{'error':'请求内容过大或为空。'})
            if self.headers.get_content_type()!='application/json': return self.respond(415,{'error':'需要 JSON 请求。'})
            action=json.loads(self.rfile.read(length))
            if not isinstance(action,dict): raise ValueError('请求格式无效。')
            if self.path=='/api/llm/settings':
                import llm_client
                llm_client.save_settings(action)
                return self.respond(200,llm_client.settings_public())
            if self.path=='/api/llm/test':
                import llm_client
                return self.respond(200,llm_client.test_connection())
            with LOCK:
                if type(action.get('revision'))is not int or action['revision']!=STATE['revision']:
                    return self.respond(409,{'error':'棋盘已更新，请看最新局面后重试。','state':public_store(STORE)})
                candidate=copy.deepcopy(STATE)
                profile_id=STORE['active_profile_id']
                learning=curriculum.learning(STORE['profiles'][profile_id]['attempts'])
                if action.get('expected_profile_id') is not None and action['expected_profile_id']!=profile_id:
                    return self.respond(409,{'error':'学习者已切换，请刷新后重试。','state':public_store(STORE)})
                review_store=copy.deepcopy(STORE) if self.path=='/api/action' and (action.get('type')=='review_move' or action.get('type')=='play' and (candidate.get('lesson') or {}).get('sequence')) else None
            if self.path=='/api/lessons/import':
                import tactics
                lesson=tactics.validate_lesson(action.get('lesson'))
                with LOCK:
                    if STATE['revision']!=candidate['revision']:
                        return self.respond(409,{'error':'棋盘已更新，请重试导入。','state':public_store(STORE)})
                    if any(l['id']==lesson['id'] for l in curriculum.catalog()) or lesson['id'] in ('escape','capture','connect'):
                        raise ValueError('题目编号已存在，不能覆盖已有题目。')
                    imported=json.loads(IMPORT_FILE.read_text(encoding='utf-8')) if IMPORT_FILE.exists() else []
                    imported.append(lesson)
                    IMPORT_FILE.parent.mkdir(parents=True,exist_ok=True)
                    temporary=IMPORT_FILE.with_suffix('.tmp')
                    with temporary.open('w',encoding='utf-8') as f:
                        json.dump(imported,f,ensure_ascii=False)
                        f.flush();os.fsync(f.fileno())
                    os.replace(temporary,IMPORT_FILE)
                    curriculum.register_lesson(lesson)
                    return self.respond(200,{'lesson':lesson_public(lesson)})
            if self.path=='/api/llm/explain':
                question=action.get('question','')
                if not isinstance(question,str) or len(question)>2000:raise ValueError('问题格式无效。')
                import llm_client
                if candidate['mode']=='free' and llm_client.settings_public().get('enabled'):
                    try:
                        import engine
                        candidate['engine_analysis']=engine.analyze(candidate)
                    except Exception:
                        # Engine advice is optional; verified rule feedback still works.
                        pass
                result=llm_client.explain(candidate,learning,question)
                record={'revision':candidate['revision'],'profile_id':profile_id,'question':question,'text':str(result['text']),'model':str(result.get('model','')),'source':'llm','created_at':now(),'context_key':context_key(candidate)}
                with LOCK:
                    updated=copy.deepcopy(STORE)
                    updated['profiles'][profile_id].setdefault('llm_explanations',[]).append(record)
                    stale=STORE['active_profile_id']!=profile_id or STORE['revision']!=candidate['revision'] or context_key(active_state(STORE))!=record['context_key']
                    save(updated)
                    STORE=updated
                    STATE=active_state(STORE)
                return self.respond(200,{**record,'stale':stale})
            if self.path=='/api/analyze':
                import engine
                return self.respond(200,engine.analyze(candidate))
            choice=None
            if action.get('type')=='ai_move':
                if not computer_turn(candidate):
                    raise ValueError('当前没有轮到电脑。')
                import engine
                choice=engine.choose_move(candidate)
            if review_store is not None:
                import engine
                apply_store(review_store,action,reviewer=engine.review)
            with LOCK:
                if STATE['revision']!=candidate['revision'] or STORE['active_profile_id']!=profile_id or context_key(STATE)!=context_key(candidate):
                    return self.respond(409,{'error':'计算期间棋盘已更新，请重试。','state':public_store(STORE)})
                updated=review_store if review_store is not None else copy.deepcopy(STORE)
                if review_store is None:apply_store(updated,action,ai_choice=choice)
                else:
                    # LLM records append without changing the board revision.
                    # Preserve any that arrived while this review was running.
                    for identity,profile in STORE['profiles'].items():
                        if 'llm_explanations' in profile:updated['profiles'][identity]['llm_explanations']=copy.deepcopy(profile['llm_explanations'])
                save(updated)
                STORE=updated
                STATE=active_state(STORE)
                return self.respond(200,public_store(STORE))
        except (ValueError,KeyError,TypeError) as exc:
            if self.path.startswith('/api/llm/'):
                return self.respond(400,{'error':'讲解服务请求未完成，请检查配置、连接和输入内容。'})
            return self.respond(400,{'error':str(exc)})
        except Exception as exc:
            if self.path.startswith('/api/llm/'):
                return self.respond(503,{'error':'讲解服务暂时不可用，请稍后重试。'})
            return self.respond(503,{'error':f'操作未完成：{type(exc).__name__}。原局面保持不变。'})

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8769)
    args=parser.parse_args()
    save(STORE)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
