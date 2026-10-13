"""Public curriculum navigation only; stored lessons and learning IDs stay intact."""
import re

STUDY_PATHS = (
    {'id': 'beginner-tesuji', 'title': '手筋专项训练（从入门到10级）', 'rank': 1},
    {'id': 'intermediate-tesuji', 'title': '手筋专项训练（从10级到5级）', 'rank': 2},
    {'id': 'beginner-life', 'title': '死活专项训练（从入门到10级）', 'rank': 3},
)
CHAPTERS = {
    'beginner-tesuji': [('问吃',241),('制造问吃',277),('枷吃',307),('制造枷吃',367),('逃子',385),('杀棋',409),('倒扑',469),('制造倒扑',499),('接不归',505),('倒扑和接不归',541),('滚打包收',619),('吃一线子',625),('吃二线子',655),('吃三线子',667),('反击错着',709),('综合运用',763)],
    'intermediate-tesuji': [('二气杀二气',1),('二气杀多气',31),('三气杀三气',55),('有眼杀无眼',187),('实战常形',253),('综合运用',265),('滚打包收',319),('金鸡独立',427),('老鼠偷油',481),('大头鬼',505),('倒脱靴',535),('摆脱对杀',541),('二气的对杀',559),('延气对杀',565),('连接',613),('分断',667),('靠单',697),('宽征',715)],
    'beginner-life': [('真眼假眼',1),('做眼',43),('破眼',73),('判断真眼假眼（一至十）',115),('判断真眼假眼（十一至十二）',175),('判断真眼假眼（十三）',187),('做完整眼',193),('三格眼位',217),('四格眼位',265),('五格六格眼位',295),('直四曲四',313),('做眼综合运用',337),('胀死牛',403),('扩大眼位',433),('占据要点',451),('综合测试',469),('判断活棋死棋',499)],
}
SUPPLEMENT_CONCEPTS = {'double_atari':('双打吃',201),'ladder':('征吃',202),'net':('枷吃',307),'gate':('门吃',203),'edge_chase':('吃一线子',625),'snapback':('倒扑',469),'connection_trap':('接不归',505),'hug':('抱吃',204),'wedge':('挖吃',205),'atari':('打吃',200)}
SUPPLEMENT_SKILLS = {'escape':('数气与救棋',10),'capture':('打吃与提子',20),'connect':('连接基础',30),'cut':('分断基础',40)}


def _normalized_title(value):
    return re.sub(r'[\s（）()《》]', '', str(value or ''))


def study_problem_number(lesson):
    lesson = lesson or {}
    digits = re.findall(r'\d+', str((lesson.get('source') or {}).get('problem') or '')) or re.findall(r'\d+', str(lesson.get('id') or ''))
    return int(digits[-1]) if digits else 0


def study_path(lesson):
    if not lesson:
        return None
    source = lesson.get('source') or {}
    number = study_problem_number(lesson)
    path = next((p for p in STUDY_PATHS if _normalized_title(p['title']) == _normalized_title(source.get('title'))), None) if source.get('kind') == 'book' else None
    if path:
        chapter = lesson.get('concept') or next((title for title,start in reversed(CHAPTERS[path['id']]) if number >= start), '练习')
        rank = next((start for title,start in CHAPTERS[path['id']] if title == chapter), number)
        return dict(path, role='main', chapter=chapter, chapter_rank=rank, number=number)
    identity = lesson.get('id') or ''
    if source.get('kind') == 'licensed' and (re.search(r'go\s*game\s*guru', source.get('title') or '', re.I) or identity.startswith('ggg-')):
        return dict(id='gogameguru', title='Go Game Guru', rank=99, role='extra', chapter={3:'基础',4:'进阶',5:'挑战'}.get(lesson.get('difficulty'),'练习'), chapter_rank=lesson.get('difficulty') or 99, number=number)
    base = re.fullmatch(r'(escape|capture|connect|cut)-[12]-\d+', identity)
    original = source.get('kind') == 'original' and identity.startswith(('tactic-', 'original-'))
    if base or original:
        chapter, rank = SUPPLEMENT_CONCEPTS.get(lesson.get('concept')) or SUPPLEMENT_SKILLS.get(lesson.get('skill')) or ('基础巩固',50)
        return dict(STUDY_PATHS[0], role='supplement', chapter=chapter, chapter_rank=rank, number=number)
    return None


def study_rank(lesson):
    path = study_path(lesson) or {}
    return path.get('rank',100), path.get('chapter_rank',0) if path.get('role') == 'extra' else 0, path.get('number',0), lesson['id']


def study_scope(catalog, current_id=None, completed_ids=()):
    """Accept an available catalog and IDs completed by any successful attempt."""
    main = sorted((l for l in catalog if (study_path(l) or {}).get('role') == 'main'), key=study_rank)
    if not main:
        return None
    completed = set(completed_ids)
    current = next((l for l in catalog if l['id'] == current_id), None)
    current_path = study_path(current)
    if current_path and current_path['role'] == 'extra':
        return dict(path=current_path, main=main, lessons=sorted((l for l in catalog if (study_path(l) or {}).get('id') == current_path['id']), key=study_rank), completed=completed, explicit_extra=True)
    if current and (current.get('source') or {}).get('kind') == 'book' and not current_path:
        return None
    remaining = [l for l in main if l['id'] not in completed]
    target = None
    if current_path and current_path['role'] == 'main':
        target = next((l for l in remaining if study_path(l)['id'] == current_path['id']), None)
        if not target:
            target = next((l for l in remaining if study_path(l)['rank'] > current_path['rank']), None)
    target = target or next(iter(remaining), None)
    active = study_path(target)
    return dict(path=active, main=main, lessons=[l for l in main if study_path(l)['id'] == active['id']] if active else [], completed=completed, explicit_extra=False)


def study_progress(catalog, current_id, completed_ids, review_ids, mode, advance=False):
    if mode == 'review':
        return None
    scope = study_scope(catalog, current_id, completed_ids)
    if scope is None:
        return None
    current_path = study_path(next((l for l in catalog if l['id'] == current_id), None))
    path = scope['path'] or (current_path if current_path and current_path['role'] == 'main' else None)
    if path and current_path and path['id'] == current_path['id']:
        path = current_path
    lessons = scope['lessons'] if scope['path'] else [l for l in scope['main'] if study_path(l)['id'] == (path or {}).get('id')]
    ids = [l['id'] for l in lessons]
    completed = scope['completed']
    pool = [l for l in lessons if l['id'] not in completed]
    index = ids.index(current_id) if current_id in ids else -1
    following = next((l for l in pool if ids.index(l['id']) > index), None) if advance and index >= 0 else None
    following = following or next(iter(pool), None)
    next_path = study_path(following)
    review = set(review_ids)
    return dict(mode=mode, study_path=path, path_title='自选拓展' if scope['explicit_extra'] else '三书主线', book_title=(path or {}).get('title'), chapter=(path or {}).get('chapter'), book_complete=not pool, main_path_complete=all(l['id'] in completed for l in scope['main']), next_book_title=next_path['title'] if next_path and next_path['id'] != (current_path or {}).get('id') else None, total=len(lessons), completed=sum(l['id'] in completed for l in lessons), remaining=len(pool), current_index=index+1 if index >= 0 else None, next_index=ids.index(following['id'])+1 if following else None, review_count=sum(l['id'] in review for l in pool), next_id=following['id'] if following else None)
