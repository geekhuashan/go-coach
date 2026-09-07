"""Original, finite capture variations; recorded replies are not exhaustive defense.

Import validation replays every supplied branch using the same rules as the UI.
It proves legal moves and actual captures, not that a move is uniquely optimal.
"""
from copy import deepcopy
import re
from go_rules import group, key, play

MAX_NODES = 256
MAX_DEPTH = 31


def validate_lesson(value):
    """Return a bounded, sanitized lesson or raise ValueError (untrusted imports)."""
    def fail(message):
        raise ValueError('题目校验失败：' + message)

    def text(value, label, maximum=1200, required=True):
        if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
            fail(label + '需要长度合适的文字。')
        if any(ord(c) < 32 and c not in '\n\t' for c in value):
            fail(label + '含不支持的控制字符。')
        return value.strip()

    def point(value, label):
        if not isinstance(value, (list, tuple)) or len(value) != 2 or any(type(c) is not int or not 0 <= c < size for c in value):
            fail(label + f'必须是 0–{size-1} 的两个整数坐标。')
        return list(value)

    if not isinstance(value, dict):
        fail('需要 JSON 对象。')
    size = value.get('size', 9)
    if type(size) is not int or size not in (9, 19):
        fail('棋盘尺寸必须是 9 或 19。')
    capacity = size * size
    identity = text(value.get('id'), 'id', 80)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', identity):
        fail('id 只支持英文字母、数字、短横线和下划线。')
    if value.get('skill') not in ('capture', 'tsumego') or value.get('sequence') is not True:
        fail('当前导入支持连续吃子题或作者解答题（skill=capture/tsumego、sequence=true）。')
    if type(value.get('difficulty')) is not int or value['difficulty'] not in (1, 2, 3, 4, 5):
        fail('难度必须是 1–5 的整数。')
    if type(value.get('to_play')) is not int or value['to_play'] not in (1, 2):
        fail('先行方必须是 1（黑）或 2（白）。')
    out = {k: text(value.get(k), k, 160 if k == 'title' else 1200) for k in ('title', 'prompt', 'hint')}
    out.update(id=identity, size=size, skill=value['skill'], sequence=True, difficulty=value['difficulty'], to_play=value['to_play'])
    if 'concept' in value: out['concept']=text(value['concept'],'题型',80)
    defender = 3 - out['to_play']
    stones = value.get('stones')
    if not isinstance(stones, list) or not 1 <= len(stones) <= capacity:
        fail(f'初始棋子需为 1–{capacity} 项。')
    board = [[0]*size for _ in range(size)]
    out['stones'] = []
    for stone in stones:
        if not isinstance(stone, dict):
            fail('棋子格式错误。')
        x, y = point([stone.get('x'), stone.get('y')], '棋子')
        color = stone.get('color')
        if type(color) is not int or color not in (1, 2) or board[y][x]:
            fail('棋子颜色错误或同一点重复放置。')
        board[y][x] = color
        out['stones'].append(dict(x=x, y=y, color=color))
    for stone in out['stones']:
        if not group(board, stone['x'], stone['y'])[1]:
            fail('初始局面存在无气棋块。')
    objective = value.get('objective')
    if not isinstance(objective, dict) or objective.get('kind') not in ('capture', 'capture_any', 'authored_solution'):
        fail('目标类型需为 capture、capture_any 或 authored_solution。')
    authored = objective['kind'] == 'authored_solution'
    if (authored and value['skill'] != 'tsumego') or (not authored and value['skill'] != 'capture'):
        fail('作者解答使用 tsumego 分类，提子目标使用 capture 分类。')
    raw_targets = [] if authored else objective.get('targets')
    if not authored and (not isinstance(raw_targets, list) or not 1 <= len(raw_targets) <= capacity):
        fail(f'需要 1–{capacity} 个目标坐标。')
    targets = [point(p, '目标') for p in raw_targets]
    target_set = {tuple(p) for p in targets}
    if len(target_set) != len(targets) or any(board[y][x] != defender for x, y in targets):
        fail('目标必须是初始对方棋子，且不能重复。')
    out['objective'] = dict(kind=objective['kind']) if authored else dict(kind=objective['kind'], targets=targets)
    marks = value.get('marks', [])
    if not isinstance(marks, list) or len(marks) > capacity:
        fail(f'标记最多 {capacity} 个。')
    out['marks'] = []
    for mark in marks:
        if not isinstance(mark, dict):
            fail('标记格式错误。')
        x, y = point([mark.get('x'), mark.get('y')], '标记')
        out['marks'].append(dict(x=x, y=y, label=text(mark.get('label'), '标记文字', 16)))
    source = value.get('source', {'kind': 'manual'})
    if not isinstance(source, dict) or source.get('kind') not in ('original', 'book', 'manual', 'licensed'):
        fail('来源类型需为 original、book、manual 或 licensed。')
    if authored and not (source.get('kind') == 'licensed' and source.get('license') and source.get('url')):
        fail('作者答案题需要授权来源、许可和来源链接。')
    out['source'] = {'kind': source['kind']}
    source_fields = ('title', 'page', 'problem', 'note')
    if source['kind'] == 'licensed':
        source_fields += ('author', 'license', 'url', 'commit', 'attribution', 'original_prompt')
    for field in source_fields:
        if field in source:
            raw = source[field]
            if field in ('page', 'problem') and type(raw) is int:
                raw = str(raw)
            out['source'][field] = text(raw, '来源 ' + field, 2000 if field == 'original_prompt' else 600, required=False)
    counter = [0]
    active = set()

    def visit(node, before, seen, removed, depth):
        if not isinstance(node, dict) or id(node) in active:
            fail('答案节点必须是无循环对象。')
        if depth > MAX_DEPTH:
            fail('答案最多 31 手。')
        counter[0] += 1
        if counter[0] > MAX_NODES:
            fail('答案树节点过多。')
        active.add(id(node))
        clean = {}
        after = before
        captured = set(removed)
        if depth:
            move = point(node.get('move'), '答案落子')
            color = out['to_play'] if depth % 2 else defender
            try:
                after, _ = play(before, *move, color, seen)
            except ValueError as exc:
                fail(f'第 {depth} 手不合法：{exc}')
            captured |= {p for p in target_set - captured if before[p[1]][p[0]] == defender and after[p[1]][p[0]] != defender}
            seen = seen + (key(after),)
            clean.update(move=move, explanation=text(node.get('explanation'), '每步讲解'))
        children = node.get('children', [])
        if not isinstance(children, list) or len(children) > 16:
            fail('每个节点最多 16 个分支。')
        goal = (node.get('correct') is True or (node.get('result') == 'success' and node.get('author_verdict') == 'correct')) if authored else (bool(captured & target_set) if objective['kind'] == 'capture_any' else target_set <= captured)
        if children and goal:
            fail('目标已完成后仍有多余走法。')
        if not children:
            if depth < 1 or (not authored and depth % 2 != 1) or not goal:
                fail('每个终点须有明确作者正确标记。' if authored else '每个终点须由先行方实际提掉指定目标。')
            if authored:
                clean.update(result='success', author_verdict='correct')
        moves = []
        for child in children:
            if not isinstance(child, dict):
                fail('答案子节点格式错误。')
            moves.append(tuple(point(child.get('move'), '答案落子')))
        if len(set(moves)) != len(moves):
            fail('同一节点存在重复走法。')
        clean['children'] = [visit(child, after, seen, captured, depth+1) for child in children]
        active.remove(id(node))
        return clean

    out['tree'] = visit(value.get('tree'), board, (key(board),), set(), 0)
    return deepcopy(out)


def _tree(lines):
    root = {'children': []}
    for line in lines:
        node = root
        for move, explanation in line:
            matching = next((c for c in node['children'] if c['move'] == list(move)), None)
            if matching is None:
                matching = {'move': list(move), 'explanation': explanation, 'children': []}
                node['children'].append(matching)
            node = matching
    return root


def _lesson(identity, title, difficulty, blacks, whites, targets, lines, hint, kind='capture'):
    return validate_lesson(dict(
        id=identity, title=title, prompt='黑先，' + ('提掉任一标记目标。' if kind == 'capture_any' else '提掉所有标记目标。') + '请连续计算；白棋会按题目收录的变化应手。这是已验证变化练习，不代表穷尽所有防守或证明唯一最佳着。',
        hint=hint, size=9, skill='capture', difficulty=difficulty, sequence=True, to_play=1,
        stones=[dict(x=x, y=y, color=c) for c, points in ((1, blacks), (2, whites)) for x, y in points],
        objective=dict(kind=kind, targets=[list(p) for p in targets]),
        marks=[dict(x=x, y=y, label=str(i+1)) for i, (x,y) in enumerate(targets)],
        tree=_tree(lines), source=dict(kind='original', note='原创局部计算题。逐分支合法性与提子目标由规则程序校验；未作全局最优或穷尽防守证明。')))


def _make_catalog():
    return [
        _lesson('tactic-double-atari', '双打吃：白棋救哪边？', 3,
            [(1,3),(2,2),(4,2),(5,3)], [(2,3),(4,3)], [(2,3),(4,3)], [
                [((3,3),'占住共同的气，同时打吃两颗白棋。'),((2,4),'白棋向下长，救左边目标。'),((4,4),'右边白棋仍只有这一口气，提掉它。')],
                [((3,3),'占住共同的气，同时打吃两颗白棋。'),((4,4),'白棋向下长，救右边目标。'),((2,4),'左边白棋仍只有这一口气，提掉它。')]],
            '先寻找两块白棋共同的一口气；白救一边，你提另一边。', 'capture_any'),
        _lesson('tactic-double-group', '双打吃：一颗与整块', 3,
            [(1,3),(2,2),(1,4),(3,4),(4,2),(5,3)], [(2,3),(2,4),(4,3)], [(2,3),(4,3)], [
                [((3,3),'这一手同时紧住左边整块与右边单子的气。'),((2,5),'白棋把左边两子向下长出。'),((4,4),'提掉右边目标，完成任提一块的目标。')],
                [((3,3),'这一手同时紧住左边整块与右边单子的气。'),((4,4),'白棋救右边单子。'),((2,5),'占掉左边整块最后一口气，一起提掉两颗。')]],
            '不要只数目标标记那颗棋；左边两颗白棋共享气。', 'capture_any'),
        _lesson('tactic-edge-chase', '边线追吃：逼向角部', 3,
            [(1,1)], [(0,1)], [(0,1)], [
                [((0,2),'从下面打吃，让白棋只能沿边向角部延伸。'),((0,0),'白棋逃进角部，整块只剩右侧一口气。'),((1,0),'占据最后一口气，提掉角部两颗白棋。')]],
            '棋盘边界不会提供气。先封住离角更远的出口。'),
        _lesson('tactic-edge-chain', '边线追吃：弯曲棋块', 3,
            [(1,4),(2,3),(1,2)], [(0,3),(1,3)], [(0,3),(1,3)], [
                [((0,4),'封住下方出口，打吃整块弯曲的白棋。'),((0,2),'白棋沿左边向上逃出一格。'),((0,1),'新棋子仍不能增加到两口气，追住最后一口气提掉整块。')]],
            '从目标沿上下左右找全棋块，再比较上下两个出口。'),
        _lesson('tactic-snapback', '倒扑：先送一颗再回提', 4,
            [(2,1),(0,2),(1,2)], [(2,0),(0,1),(1,1)], [(0,1),(1,1)], [
                [((1,0),'扑入一子，黑棋自己只剩角上一口气。这里是在计算允许的弃子。'),((0,0),'白棋提掉刚扑入的黑子，但它自己的整块只剩扑入点一口气。'),((1,0),'在刚才被提的位置回提，一次提掉三颗白棋。这不是劫：局面没有还原。')]],
            '计算白棋提掉黑一子后，白棋整块还剩几口气。'),
        _lesson('tactic-counter-atari', '连续紧气：看清白棋反打', 4,
            [(2,1),(0,2)], [(2,0),(0,1),(1,1)], [(0,1),(1,1)], [
                [((1,2),'先补住下方出口，限制白棋向下发展。'),((1,0),'白棋向右连接上方的同伴，暂时有角上和右侧两口气。'),((3,0),'封住右侧出口，白棋整块只剩角上一口气。'),((3,1),'白棋在右侧反打吃黑棋；先计算能否通过提掉目标解除威胁。'),((0,0),'看准目标整块的最后一口气，提掉四颗白棋。')],
                [((1,2),'先补住下方出口，限制白棋向下发展。'),((0,0),'白棋选择在角部连接，但整块只剩右侧一口气。'),((1,0),'直接占掉最后一口气，提掉角部三颗白棋。')]],
            '白棋选择不同连接方向时重新数气；不能机械照搬上一条变化。'),
        _lesson('tactic-short-ladder', '征吃：借助前方黑子', 5,
            [(1,2),(2,1),(1,3),(3,5)], [(2,2)], [(2,2)], [
                [((3,2),'从右侧打吃，把白棋引向下方。'),((2,3),'白棋向下长，现在整块有右、下两口气。'),((2,4),'从下方打吃，迫使白棋向右转。'),((3,3),'白棋转向右边，仍只有两口气。'),((4,3),'从右侧打吃，把白棋再次引向下方。'),((3,4),'白棋向下长，却遇到前方已有黑子，只剩右侧一口气。'),((4,4),'封住最后一口气，提掉整条白棋。')]],
            '每次打吃都要重新数气；注意前方的黑子怎样缩短追逐。'),
        _lesson('tactic-two-stone-ladder', '征吃：从两颗相连白棋算起', 5,
            [(1,2),(2,1),(3,1),(4,2),(4,5)], [(2,2),(3,2)], [(2,2),(3,2)], [
                [((2,3),'紧住左下方的气，向右侧追赶这块白棋。'),((3,3),'白棋向下长，整块有右、下两口气。'),((3,4),'继续从下方打吃。'),((4,3),'白棋向右长，整块仍有两口气。'),((5,3),'从右边打吃，将白棋引向下方的黑子。'),((4,4),'白棋向下长，前方黑子挡住一路，只剩右侧一口气。'),((5,4),'占据最后一口气，提掉包括两个目标在内的整块白棋。')]],
            '目标虽然有两颗，但每一步都要数连接后的整块棋；最后利用下方黑子封路。'),
    ]


_CATALOG = _make_catalog()


def catalog():
    return deepcopy(_CATALOG)
