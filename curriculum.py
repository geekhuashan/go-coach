"""Local rule-based curriculum with validated tactical sequences and imports."""
import json
import re
from pathlib import Path
from copy import deepcopy
from go_rules import group

SKILLS = {'escape': '救棋与数气', 'capture': '打吃与提子', 'connect': '连接棋块', 'cut': '阻断直接连接', 'tsumego': '死活与手筋'}


def _transform(p, variant):
    x, y = p
    if variant >= 4:
        x = 8-x
    for _ in range(variant % 4):
        x, y = 8-y, x
    return x, y


def _make_catalog():
    # All seeds are asymmetric with respect to the board center. Rotations and
    # reflections are practice variants, not additional difficulty levels.
    seeds = [
        ('escape', 1, [(2,3)], [(1,3),(2,2),(3,3)], {'targets': [(2,3)]}, '救出被打吃的黑棋', '黑棋只剩一口气。下一手，让这块黑棋至少有两口气。'),
        ('escape', 2, [(2,3),(3,3)], [(1,3),(2,2),(3,2),(4,3),(2,4)], {'targets': [(2,3),(3,3)]}, '救出整块黑棋', '两颗相连黑棋共享气。下一手，让整块棋至少有两口气。'),
        ('capture', 1, [(1,3),(2,2),(3,3)], [(2,3)], {'targets': [(2,3)]}, '提掉一颗白棋', '找到目标白棋最后一口气，下一手把它提掉。'),
        ('capture', 2, [(1,3),(2,2),(3,2),(4,3),(2,4)], [(2,3),(3,3)], {'targets': [(2,3),(3,3)]}, '提掉整块白棋', '两颗白棋相连。数整块棋的气，下一手把目标白棋全部提掉。'),
        ('connect', 1, [(1,3),(3,3)], [(2,2)], {'targets': [(1,3),(3,3)]}, '把两颗黑棋连起来', '下一手，让两颗目标黑棋上下左右相连，成为同一块棋。'),
        ('connect', 2, [(1,3),(1,4),(3,3),(4,3),(2,4)], [(2,2),(3,4)], {'targets': [(1,3),(3,3)]}, '连接两块黑棋', '先认出两个目标棋块。下一手，把它们连成同一块棋。'),
        ('cut', 1, [(2,2)], [(1,3),(3,3)], {'targets': [(1,3),(3,3)], 'point': (2,3)}, '阻止白棋直接连上', '两颗目标白棋中间有一个直接连接点。黑棋下一手，占住这个点。'),
        ('cut', 2, [(2,2),(2,1)], [(1,3),(1,4),(3,3),(4,3),(2,4),(2,5)], {'targets': [(1,3),(3,3)], 'point': (2,3)}, '找出两块白棋的连接点', '辨认两块目标白棋，下一手占住它们之间的直接连接点；不要求判断整盘死活。'),
    ]
    out = []
    for skill, difficulty, blacks, whites, objective, title, prompt in seeds:
        for v in range(8):
            t = lambda p: _transform(p, v)
            obj = {'targets': [list(t(p)) for p in objective['targets']]}
            if 'point' in objective:
                obj['point'] = list(t(objective['point']))
            targets = obj['targets']
            hint = {'escape': '从目标黑棋出发，数整块棋上下左右的空点；试着从最后一口气向外长。', 'capture': '先把相连白棋看成整体，找它还没有被黑棋占住的最后一口气。', 'connect': '寻找同时挨着两个目标黑棋块的空点。斜着挨着不算连接。', 'cut': '找同时紧挨着两块目标白棋的空点，占住它就能阻止白棋在这里直接连上。'}[skill]
            out.append({'id': f'{skill}-{difficulty}-{v+1}', 'title': f'{title} · {v+1}', 'prompt': prompt, 'hint': hint, 'skill': skill, 'difficulty': difficulty, 'variant': v+1, 'family_id': f'{skill}-{difficulty}', 'to_play': 1, 'stones': [{'x': t(p)[0], 'y': t(p)[1], 'color': c} for c, ps in ((1,blacks),(2,whites)) for p in ps], 'objective': obj, 'marks': [{'x': p[0], 'y': p[1], 'label': str(i+1)} for i,p in enumerate(targets[:2])]})
    return out


_CATALOG = _make_catalog()
_BY_ID = {item['id']: item for item in _CATALOG}
# Preserve the first release's exact positions during profile migration.
for _skill, _pieces, _targets in (
    ('escape', [(3,5,1),(2,5,2),(3,4,2),(4,5,2)], [[3,5]]),
    ('capture', [(3,5,2),(2,5,1),(3,4,1),(4,5,1)], [[3,5]]),
    ('connect', [(2,5,1),(4,5,1),(2,4,2),(4,4,2)], [[2,5],[4,5]]),
):
    _legacy = deepcopy(_BY_ID[f'{_skill}-1-1'])
    _legacy.update(id=_skill, variant=0, title=_legacy['title'].split(' · ')[0], stones=[{'x': x, 'y': y, 'color': c} for x,y,c in _pieces], objective={'targets': _targets}, marks=[{'x': p[0], 'y': p[1], 'label': str(i+1)} for i,p in enumerate(_targets)])
    _BY_ID[_skill] = _legacy


def _validate_new_lessons(lessons):
    """Validate a whole batch without exposing a partially registered catalog."""
    import tactics
    if not isinstance(lessons, list):
        raise ValueError('导入课本必须是 JSON 题目列表。')
    staged = []
    seen = set(_BY_ID)
    for lesson in lessons:
        if not isinstance(lesson, dict):
            raise ValueError('每道导入题必须是一个 JSON 对象。')
        identity = lesson.get('id')
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('每道导入题都需要非空 id。')
        if identity in seen:
            raise ValueError(f'题目 id 已存在，不能覆盖：{identity}')
        validated = tactics.validate_lesson(deepcopy(lesson))
        if not isinstance(validated, dict) or validated.get('id') != identity:
            raise ValueError('题目校验未返回一致的题目 id。')
        staged.append(validated)
        seen.add(identity)
    return staged


def _commit_lessons(lessons):
    for lesson in lessons:
        _CATALOG.append(lesson)
        _BY_ID[lesson['id']] = lesson


def register_lesson(lesson):
    validated = _validate_new_lessons([lesson])
    _commit_lessons(validated)
    return deepcopy(validated[0])


def load_imports(path):
    """Load an optional local book atomically; malformed books remain errors."""
    path = Path(path)
    if not path.exists():
        return 0
    try:
        lessons = json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError('导入课本不是有效的 UTF-8 JSON，请修正原文件。') from exc
    validated = _validate_new_lessons(lessons)
    _commit_lessons(validated)
    return len(validated)


# tactics validates authored trees once during its own initialization.
# Avoid repeating full-tree checks here or during catalog reads.
import tactics as _tactics
_authored = _tactics.catalog()
_ORIGINAL_CONCEPTS={'tactic-double-atari':'double_atari','tactic-double-group':'double_atari','tactic-edge-chase':'edge_chase','tactic-edge-chain':'edge_chase','tactic-snapback':'snapback','tactic-counter-atari':'atari','tactic-short-ladder':'ladder','tactic-two-stone-ladder':'ladder'}
for _lesson in _authored: _lesson['concept']=_ORIGINAL_CONCEPTS[_lesson['id']]
_authored_ids = [lesson['id'] for lesson in _authored]
if len(set(_authored_ids)) != len(_authored_ids) or set(_authored_ids) & set(_BY_ID):
    raise ValueError('内置连续题的 id 与现有题库重复。')
_original_start=len(_CATALOG)
_commit_lessons(_authored)
# The bundled licensed book is shared by local and cloud deployments.
load_imports(Path(__file__).resolve().parent / 'data/original-extra/lessons.json')
_CATALOG[_original_start:]=sorted(_CATALOG[_original_start:],key=lambda l:l['difficulty'])
load_imports(Path(__file__).resolve().parent / 'data/gogameguru/lessons.json')


def available_lesson(lesson):
    if lesson.get('legacy') or lesson['id'] in ('escape','capture','connect'): return False
    match=None if lesson.get('sequence') else re.fullmatch(r'(escape|capture|connect|cut)-([12])-([1-8])',lesson['id'])
    return not match or int(match[3]) <= (3 if match[2]=='1' else 5)


def catalog():
    return deepcopy(_CATALOG)


def get_lesson(lesson_id):
    if lesson_id not in _BY_ID:
        raise ValueError('找不到这道练习。')
    return deepcopy(_BY_ID[lesson_id])


def _coord(p):
    return 'ABCDEFGHJ'[p[0]] + str(9-p[1])


def grade(lesson, before_board, after_board, move, captured):
    skill = lesson['skill']
    targets = [tuple(p) for p in lesson['objective']['targets']]
    a = targets[0]
    marks = []
    if skill == 'escape':
        stones, libs = group(after_board, *a)
        correct = after_board[a[1]][a[0]] == 1 and len(libs) >= 2
        _, before_libs = group(before_board, *a)
        summary = '救棋成功，已解除打吃。' if correct else '这块黑棋仍被打吃，再数一数整块棋的气。'
        explanation = f'目标黑棋原有 {len(before_libs)} 口气，现在有 {len(libs)} 口气。相连黑棋共享气，重复的空点只算一次。' + ('至少两口气只表示当前没有被打吃，不代表已经做活。' if correct else '本题需要下一手让目标棋块至少有两口气。')
        marks = [{'x': x, 'y': y, 'label': '气'} for x,y in sorted(libs)]
    elif skill == 'capture':
        remaining = sum(after_board[y][x] == 2 for x,y in targets)
        correct = remaining == 0 and captured >= len(targets)
        summary = '提子成功，目标白棋已全部提掉。' if correct else '还没有提掉目标白棋。'
        explanation = f'本题目标共有 {len(targets)} 颗白棋，落子后还剩 {remaining} 颗。只有占掉整块棋最后一口气，才会提掉这块棋。'
        marks = [{'x': x, 'y': y, 'label': '目标'} for x,y in targets]
    elif skill == 'connect':
        stones, _ = group(after_board, *a)
        correct = all(after_board[y][x] == 1 and (x,y) in stones for x,y in targets)
        summary = '连接成功，目标黑棋属于同一块棋。' if correct else '目标黑棋还没有连成一块。'
        explanation = '沿黑棋上下左右走，' + ('现在可以从一个目标走到另一个目标，中途不用经过空点。' if correct else '目前仍不能从一个目标走到另一个目标。找能同时挨着两块棋的空点。') + '斜着相邻不算连接。'
        marks = [{'x': x, 'y': y, 'label': str(i+1)} for i,(x,y) in enumerate(targets)]
    else:
        p = tuple(lesson['objective']['point'])
        correct = before_board[p[1]][p[0]] == 0 and after_board[p[1]][p[0]] == 1 and (move.get('x'), move.get('y')) == p
        summary = '占住连接点，阻止了白棋在这里直接连上。' if correct else '白棋的直接连接点还没有被黑棋占住。'
        explanation = f'{_coord(targets[0])} 与 {_coord(targets[1])} 所在白棋块原本可以在 {_coord(p)} 直接连接。' + ('黑棋现在占住了这个点。' if correct else '本题要求黑棋占住这个共同相邻的空点。') + '这只核对局部直接连接；白棋以后能否绕路连接或做活，尚未判断。'
        marks = [{'x': p[0], 'y': p[1], 'label': '连接点'}]
    return {'correct': bool(correct), 'summary': summary, 'explanation': explanation, 'marks': marks, 'skill': skill, 'difficulty': lesson['difficulty']}


def _evidence(attempts):
    # Input is chronological. A first assisted response is not later converted
    # into independent evidence by retrying that same exact puzzle.
    seen, independent = set(), []
    for attempt in attempts:
        lesson_id = attempt.get('lesson_id')
        if lesson_id not in _BY_ID or lesson_id in seen:
            continue
        seen.add(lesson_id)
        if not attempt.get('assisted', False) and attempt.get('attempt_no', 1) == 1:
            independent.append(attempt)
    return independent


def learning(attempts):
    evidence = _evidence(attempts)
    skills = []
    for skill,name in SKILLS.items():
        records = [a for a in evidence if _BY_ID[a['lesson_id']]['skill'] == skill]
        correct = sum(bool(a.get('correct')) for a in records)
        total = len(records)
        if skill in ('capture','tsumego'):
            levels = sorted({l['difficulty'] for l in _CATALOG if l['skill'] == skill})
            difficulty = levels[0]
            for current, following in zip(levels, levels[1:]):
                level_records = [a for a in records if _BY_ID[a['lesson_id']]['difficulty'] == current]
                available = sum(l['skill'] == skill and l['difficulty'] == current for l in _CATALOG)
                threshold = min(3, available)
                ready = threshold > 0 and len(level_records) >= threshold and sum(bool(a.get('correct')) for a in level_records) / len(level_records) >= .75
                if not ready:
                    break
                difficulty = following
            recent_failed = records[-2:]
            if len(recent_failed) == 2 and all(not a.get('correct') for a in recent_failed):
                failed_levels = {_BY_ID[a['lesson_id']]['difficulty'] for a in recent_failed}
                if len(failed_levels) == 1 and next(iter(failed_levels)) > 1:
                    difficulty = min(difficulty, next(iter(failed_levels))-1)
            stage = '待评估' if total < 3 else ('继续巩固基础' if difficulty == 1 else f'可练习难度 {difficulty}（按独立作答记录）')
        else:
            basics = [a for a in records if _BY_ID[a['lesson_id']]['difficulty'] == 1]
            ready = len(basics) >= 3 and sum(bool(a.get('correct')) for a in basics)/len(basics) >= .75
            advanced = [a for a in records if _BY_ID[a['lesson_id']]['difficulty'] == 2]
            advanced_ready = len(advanced) >= 3 and sum(bool(a.get('correct')) for a in advanced)/len(advanced) >= .75
            step_back = len(records) >= 2 and all(_BY_ID[a['lesson_id']]['difficulty'] == 2 and not a.get('correct') for a in records[-2:])
            if step_back:
                ready = False
            stage = '待评估' if total < 3 else ('进阶题较稳' if advanced_ready and not step_back else ('基础较稳，可尝试进阶' if ready else '继续巩固基础'))
            difficulty = 2 if ready else 1
        skills.append({'id': skill, 'name': name, 'stage': stage, 'independent_attempts': total, 'correct': correct, 'total': total, 'accuracy': round(correct/total,3) if total else None, 'next_difficulty': difficulty})
    recommendation = _recommend(attempts, skills)
    return {'stage': '待评估' if len(evidence) < 3 else '按技能逐项练习（不对应段位）', 'attempts_count': len(attempts), 'independent_correct': sum(bool(a.get('correct')) for a in evidence), 'independent_attempts': len(evidence), 'skills': skills, 'recommendation': {k: recommendation[k] for k in ('id','title','skill','difficulty','reason','adjustment')}}


CONCEPT_NAMES={'double_atari':'双打吃','ladder':'征子','snapback':'倒扑','connection_trap':'接不归','edge_chase':'边线追吃','capture_race':'对杀','atari':'打吃'}

def _recommend(attempts, skills, current_id=None):
    def group_key(l): return f"concept:{l['skill']}:{l['concept']}" if l.get('concept') else f"skill:{l['skill']}"
    valid=[a for a in reversed(attempts) if a.get('lesson_id') in _BY_ID and isinstance(a.get('correct'),bool)][:30]
    seen={a['lesson_id'] for a in attempts}
    groups={}
    for l in _CATALOG:
        if not available_lesson(l): continue
        identity=group_key(l)
        groups.setdefault(identity,dict(id=identity,skill=l['skill'],name=CONCEPT_NAMES.get(l.get('concept')) or l.get('concept') or SKILLS[l['skill']],lessons=[],records=[]))['lessons'].append(l)
    for g in groups.values():
        g['records']=[a for a in valid if group_key(_BY_ID[a['lesson_id']])==g['id']]
        g['wins']=g['losses']=0;won=set();lost=set()
        for a in g['records']:
            if a['correct'] is not True or a.get('assisted'): break
            if a['lesson_id'] not in won: won.add(a['lesson_id']);g['wins']+=1
        for a in g['records']:
            if a['correct'] is not False: break
            if a['lesson_id'] not in lost: lost.add(a['lesson_id']);g['losses']+=1
        g['count']=len({a['lesson_id'] for a in attempts if a.get('lesson_id') in _BY_ID and group_key(_BY_ID[a['lesson_id']])==g['id']})
    latest=valid[0] if valid else None;last_group=group_key(_BY_ID[latest['lesson_id']]) if latest else None
    run=0
    for a in valid:
        if group_key(_BY_ID[a['lesson_id']])!=last_group: break
        run+=1
    pool=[g for g in groups.values() if not (run>=3 and g['id']==last_group and len(groups)>1)]
    urgent=sorted([g for g in pool if g['losses']>=2],key=lambda g:valid.index(g['records'][0]))
    chosen=urgent[0] if urgent else None;kind='reinforce' if chosen else None
    if not chosen and latest and latest['correct'] is False and run==1:
        chosen=next((g for g in pool if g['id']==last_group),None);kind='retry_skill'
    if not chosen:
        chosen=min(pool,key=lambda g:g['count']+2*len(g['records'])+(12 if g['wins']>=3 else 0)+(100 if min(l['difficulty'] for l in g['lessons'])>next(s['next_difficulty'] for s in skills if s['id']==g['skill']) else 0))
        kind='reduce_frequency' if any(g['wins']>=3 for g in groups.values()) else 'rotate' if run>=3 else 'balanced'
    stat=next(s for s in skills if s['id']==chosen['skill']);levels=sorted({l['difficulty'] for l in chosen['lessons']});desired=stat['next_difficulty']
    if kind=='reinforce': desired=min(desired,max(1,_BY_ID[chosen['records'][0]['lesson_id']]['difficulty']-1))
    difficulty=next((d for d in reversed(levels) if d<=desired),levels[0]);candidates=[l for l in chosen['lessons'] if l['difficulty']==difficulty]
    excluded=current_id or (latest['lesson_id'] if latest else None);recent_ids={a['lesson_id'] for a in valid[:3]}
    eligible=[l for l in candidates if l['id']!=excluded] or candidates
    rested=[l for l in eligible if l['id'] not in recent_ids];fresh=[l for l in (rested or eligible) if l['id'] not in seen]
    last_index={}
    for i,a in enumerate(valid): last_index.setdefault(a['lesson_id'],i)
    lesson=deepcopy((fresh or rested or sorted(eligible,key=lambda l:-last_index.get(l['id'],1000000)))[0])
    cooled=next((g for g in groups.values() if g['wins']>=3 and g['id']!=chosen['id']),None)
    if kind=='reduce_frequency' and not cooled: kind='balanced'
    if kind=='reinforce': reason=f"{chosen['name']}最近连续{chosen['losses']}道不同题答错，优先换题巩固"+('，先降低难度' if difficulty<_BY_ID[chosen['records'][0]['lesson_id']]['difficulty'] else '')+'。'
    elif kind=='retry_skill': reason=f"刚才的{chosen['name']}还没掌握，换一道题再练一次。"
    elif kind=='rotate': reason=f"刚连续练了同一类题，先换成{chosen['name']}；需要巩固的内容之后还会安排。"
    elif kind=='reduce_frequency': reason=f"{cooled['name']}近期连续做对{cooled['wins']}道不同题，暂时少安排一些，换练{chosen['name']}。"
    else: reason=f"根据近期练习和首次作答记录，换练{chosen['name']}。"
    lesson.update(reason=reason,adjustment=dict(kind=kind,skill=chosen['skill'],concept=lesson.get('concept'),group=chosen['name'],streak=chosen['losses'] if kind=='reinforce' else cooled['wins'] if kind=='reduce_frequency' else 0,window=30))
    return lesson


def recommend(attempts, current_id=None):
    return _recommend(attempts, learning(attempts)['skills'], current_id)
