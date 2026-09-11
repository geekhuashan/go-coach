#!/usr/bin/env python3
"""Search original 3-ply capture lessons from classic beginner shapes."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import tactics
from go_rules import play, group, key

def fp(lesson):
    variants = []
    for flip in (False, True):
        for turns in range(4):
            points = []
            for p in lesson['stones']:
                x, y = p['x'], p['y']
                if flip:
                    x = 8 - x
                for _ in range(turns):
                    x, y = 8 - y, x
                points.append((x, y, p['color']))
            mx = min(p[0] for p in points)
            my = min(p[1] for p in points)
            variants.append(tuple(sorted((x - mx, y - my, c) for x, y, c in points)))
    return min(variants)

existing = {fp(l) for l in tactics.catalog()}
for l in json.loads((Path(__file__).parent / 'lessons.json').read_text()):
    existing.add(fp(l))

def board_of(blacks, whites):
    b = [[0] * 9 for _ in range(9)]
    for x, y in blacks:
        if not (0 <= x < 9 and 0 <= y < 9):
            raise ValueError('oob')
        b[y][x] = 1
    for x, y in whites:
        if not (0 <= x < 9 and 0 <= y < 9):
            raise ValueError('oob')
        b[y][x] = 2
    return b

def winfo(b):
    groups, seen = [], set()
    for y in range(9):
        for x in range(9):
            if b[y][x] == 2 and (x, y) not in seen:
                stones, libs = group(b, x, y)
                seen |= stones
                groups.append((sorted(stones), sorted(libs)))
    return groups

def empties(b):
    return [(x, y) for y in range(9) for x in range(9) if b[y][x] == 0]

def find_three_ply(blacks, whites):
    start = board_of(blacks, whites)
    seen0 = [key(start)]
    lines = []
    for first in empties(start):
        try:
            after, n = play(start, *first, 1, seen0)
        except ValueError:
            continue
        inf = winfo(after)
        if n or not inf or len(inf[0][1]) != 1:
            continue
        run = inf[0][1][0]
        try:
            mid, _ = play(after, *run, 2, seen0 + [key(after)])
        except ValueError:
            continue
        inf2 = winfo(mid)
        if not inf2 or len(inf2[0][1]) != 1:
            continue
        cap = inf2[0][1][0]
        try:
            end, _ = play(mid, *cap, 1, seen0 + [key(after), key(mid)])
        except ValueError:
            continue
        if winfo(end):
            continue
        lines.append((first, run, cap))
        if len(lines) >= 2:
            break
    return lines

def find_double(blacks, whites):
    start = board_of(blacks, whites)
    seen0 = [key(start)]
    init = winfo(start)
    if len(init) < 2:
        return None
    targets = [g[0][0] for g in init]
    for first in empties(start):
        try:
            after, n = play(start, *first, 1, seen0)
        except ValueError:
            continue
        inf = winfo(after)
        if n or len(inf) != 2 or any(len(g[1]) != 1 for g in inf):
            continue
        branches = []
        for stones, libs in inf:
            run = libs[0]
            try:
                mid, _ = play(after, *run, 2, seen0 + [key(after)])
            except ValueError:
                branches = []
                break
            left = winfo(mid)
            one = [g for g in left if len(g[1]) == 1]
            if len(one) != 1:
                branches = []
                break
            cap = one[0][1][0]
            try:
                end, n2 = play(mid, *cap, 1, seen0 + [key(after), key(mid)])
            except ValueError:
                branches = []
                break
            if n2 < 1:
                branches = []
                break
            branches.append((run, cap))
        if len(branches) == 2:
            return first, branches, targets
    return None

def find_snapback(blacks, whites):
    start = board_of(blacks, whites)
    seen0 = [key(start)]
    for first in empties(start):
        try:
            after, n = play(start, *first, 1, seen0)
        except ValueError:
            continue
        if n or after[first[1]][first[0]] != 1:
            continue
        tlibs = group(after, *first)[1]
        if len(tlibs) != 1:
            continue
        take = next(iter(tlibs))
        try:
            mid, n2 = play(after, *take, 2, seen0 + [key(after)])
        except ValueError:
            continue
        if n2 != 1 or mid[first[1]][first[0]] != 0:
            continue
        inf = winfo(mid)
        if not inf or len(inf[0][1]) != 1 or inf[0][1][0] != first:
            continue
        try:
            end, n3 = play(mid, *first, 1, seen0 + [key(after), key(mid)])
        except ValueError:
            continue
        remaining = {tuple(p) for g in winfo(end) for p in g[0]}
        captured = [p for p in inf[0][0] if p not in remaining]
        if n3 >= 2 and captured:
            return first, take, captured
    return None

def find_five_ply(blacks, whites):
    start = board_of(blacks, whites)
    seen0 = [key(start)]
    for first in empties(start):
        try:
            a, n = play(start, *first, 1, seen0)
        except ValueError:
            continue
        inf = winfo(a)
        if n or not inf or len(inf[0][1]) != 2:
            continue
        for run in inf[0][1]:
            try:
                b, _ = play(a, *run, 2, seen0 + [key(a)])
            except ValueError:
                continue
            inf2 = winfo(b)
            if not inf2:
                continue
            libs2 = inf2[0][1]
            atari_moves = []
            if len(libs2) == 1:
                atari_moves = [libs2[0]]
            else:
                for mv in empties(b):
                    try:
                        c, n2 = play(b, *mv, 1, seen0 + [key(a), key(b)])
                    except ValueError:
                        continue
                    inf3 = winfo(c)
                    if n2 or not inf3 or len(inf3[0][1]) != 1:
                        continue
                    atari_moves.append(mv)
            for second in atari_moves[:3]:
                try:
                    c, n2 = play(b, *second, 1, seen0 + [key(a), key(b)])
                except ValueError:
                    continue
                inf3 = winfo(c)
                if not inf3 or len(inf3[0][1]) != 1:
                    continue
                run2 = inf3[0][1][0]
                try:
                    d, _ = play(c, *run2, 2, seen0 + [key(a), key(b), key(c)])
                except ValueError:
                    continue
                inf4 = winfo(d)
                if not inf4 or len(inf4[0][1]) != 1:
                    continue
                cap = inf4[0][1][0]
                try:
                    e, _ = play(d, *cap, 1, seen0 + [key(a), key(b), key(c), key(d)])
                except ValueError:
                    continue
                if winfo(e):
                    continue
                return [(first, run, second, run2, cap)]
    return []

ok = []

def commit(name, title, concept, blacks, whites, targets, lines, hint, kind='capture'):
    try:
        lesson = tactics._lesson(name, title, 5, blacks, whites, targets, lines, hint, kind)
    except Exception as exc:
        print('FAIL', name, exc)
        return
    if fp(lesson) in existing:
        print('DUP', name)
        return
    existing.add(fp(lesson))
    lesson['concept'] = concept
    ok.append(lesson)
    print('OK', name, 'lines', len(lines))

def three(name, title, concept, blacks, whites, first_text, run_text, cap_text, hint):
    try:
        lines_found = find_three_ply(blacks, whites)
    except ValueError:
        print('OOB', name)
        return
    if not lines_found:
        print('NONE', name)
        return
    lines = [[(a, first_text), (b, run_text), (c, cap_text)] for a, b, c in lines_found]
    commit(name, title, concept, blacks, whites, whites, lines, hint)

# 门吃 corridors with extra blocking stones so they are not rotations of each other
three('tactic-gate-four', '门吃：四子通道', 'gate',
      [(2, 2), (4, 2), (2, 3), (4, 3), (2, 4), (4, 4), (2, 5), (4, 5), (2, 6), (4, 6)],
      [(3, 3), (3, 4), (3, 5), (3, 6)],
      '先关上通道的一端。', '白棋从另一头逃。', '关门提子。', '通道两端都是门。')
three('tactic-gate-wide', '门吃：宽门口的两子', 'gate',
      [(1, 3), (1, 4), (1, 5), (3, 3), (3, 4), (4, 5), (4, 2)],
      [(2, 4), (2, 5)],
      '关上门口。', '白棋向外逃。', '提掉门里的白棋。', '先关一头。')
three('tactic-gate-hook', '门吃：拐过一个弯', 'gate',
      [(4, 2), (5, 2), (5, 3), (5, 4), (3, 3), (3, 4), (3, 5), (6, 5)],
      [(4, 3), (4, 4)],
      '封住拐弯的门口。', '白棋向下逃。', '把门关死。', '门口在拐角时先封宽口。')

# 抱吃
three('tactic-hug-three', '抱吃：三子弯块', 'hug',
      [(2, 2), (3, 2), (4, 2), (5, 2), (2, 3), (5, 3), (2, 4), (5, 4), (2, 5)],
      [(3, 3), (4, 3), (4, 4)],
      '从开口抱住白棋。', '白棋逃出一格。', '继续包住提子。', '往己方棋多的方向赶。')
three('tactic-hug-left', '抱吃：竖块从左包住', 'hug',
      [(5, 2), (5, 3), (5, 4), (5, 5), (4, 2), (3, 2), (3, 5), (4, 6), (6, 3), (6, 4)],
      [(4, 3), (4, 4)],
      '从左侧抱住。', '白棋向外逃。', '提掉被抱住的白棋。', '开口在哪边就从哪边包。')
three('tactic-hug-wall', '抱吃：赶到厚壁', 'hug',
      [(2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (2, 3), (6, 3), (2, 5), (6, 5), (3, 3), (5, 3)],
      [(3, 4), (4, 4)],
      '把白棋赶到厚壁。', '白棋向下逃。', '封住出口。', '抱吃是往自己棋多的方向赶。')
three('tactic-hug-row', '抱吃：横三从下包', 'hug',
      [(2, 2), (3, 2), (4, 2), (5, 2), (2, 3), (5, 3), (2, 4), (5, 4)],
      [(3, 3), (4, 3)],
      '从下面抱住横块。', '白棋向下逃。', '封住出口。', '往棋多的方向赶。')

def five(name, title, concept, blacks, whites, texts, hint):
    try:
        found = find_five_ply(blacks, whites)
    except ValueError:
        print('OOB', name)
        return
    if not found:
        print('NONE5', name)
        return
    seq = found[0]
    labels = texts
    lines = [[(seq[i], labels[i]) for i in range(5)]]
    commit(name, title, concept, blacks, whites, whites, lines, hint)

five('tactic-net-low', '枷吃：向下跳枷', 'net',
     [(3, 2), (2, 3), (4, 1), (1, 4), (5, 3), (4, 2), (4, 4), (2, 5), (6, 4)],
     [(3, 3)],
     ['飞一着套住白棋。', '白棋往枷里长。', '继续拦住出路。', '白棋再长。', '提掉被套住的白棋。'],
     '先拦住出路，不是立刻紧气。')
five('tactic-net-high', '枷吃：向上套住', 'net',
     [(3, 5), (2, 4), (4, 6), (1, 3), (5, 4), (4, 5), (4, 3), (2, 2), (6, 3)],
     [(3, 4)],
     ['向上飞枷。', '白棋往枷里长。', '继续拦住。', '白棋再长。', '提掉套住的白棋。'],
     '飞枷不是立刻紧气。')
five('tactic-net-pair', '枷吃：套住相连两子', 'net',
     [(2, 2), (2, 3), (3, 1), (4, 2), (5, 3), (3, 5), (4, 4), (1, 4), (6, 2)],
     [(3, 2), (3, 3)],
     ['飞在前方套住两子。', '白棋往枷里长。', '继续拦住。', '白棋再长。', '提掉整块。'],
     '枷住的是整块。')
five('tactic-ladder-shift', '征吃：两子短征', 'ladder',
     [(1, 3), (2, 2), (3, 2), (4, 3), (5, 5), (0, 4)],
     [(2, 3), (3, 3)],
     ['打吃相连两子。', '白棋向下长。', '继续打吃。', '白棋再长。', '提掉整块。'],
     '整块一起数气。')
five('tactic-ladder-turn', '征吃：拐向厚势', 'ladder',
     [(2, 2), (3, 1), (2, 3), (5, 4), (1, 4)],
     [(3, 2)],
     ['从右侧打吃。', '白棋向下长。', '从下方打吃。', '白棋右转。', '提掉这条白棋。'],
     '每步重新数气。')

# 挖吃
three('tactic-wedge-two', '挖吃：挖开弯三', 'wedge',
      [(1, 2), (1, 3), (1, 4), (4, 2), (4, 3), (2, 5), (3, 5), (3, 1), (2, 1), (5, 1)],
      [(2, 3), (3, 3), (3, 2)],
      '挖进弯三中间。', '白棋向外逃。', '提掉整块。', '要点在棋形里面。')
three('tactic-wedge-belly', '挖吃：挖进腹部', 'wedge',
      [(2, 1), (2, 2), (2, 3), (5, 1), (5, 2), (5, 3), (3, 4), (4, 4), (3, 0), (4, 0)],
      [(3, 2), (4, 2), (4, 3)],
      '挖进白棋肚子。', '白棋向外逃。', '提掉整块。', '不要在外面追。')
three('tactic-wedge-tight', '挖吃：挖紧两口气', 'wedge',
      [(2, 2), (3, 1), (4, 1), (5, 2), (2, 4), (5, 4), (3, 5), (4, 5), (1, 3)],
      [(3, 3), (4, 3), (4, 2)],
      '挖在内部空点。', '白棋逃出。', '提掉整块。', '挖吃下在形里。')

# 边线 / 整块
three('tactic-edge-four', '边线追吃：三子沿边', 'edge_chase',
      [(1, 1), (1, 2), (1, 3), (1, 4), (1, 6)],
      [(0, 2), (0, 3), (0, 4)],
      '封住一端。', '白棋向另一头逃。', '追住提子。', '边界不会提供气。')
three('tactic-edge-corner', '边线追吃：逼进角', 'edge_chase',
      [(2, 1), (1, 2), (1, 3), (2, 4)],
      [(0, 2), (0, 3)],
      '封住离角更远的出口。', '白棋进角。', '提掉边上的白棋。', '先封远口。')
three('tactic-atari-block', '整块打吃：弯三整块', 'atari',
      [(2, 2), (3, 2), (4, 2), (2, 3), (4, 3), (2, 4), (5, 5)],
      [(3, 3), (3, 4), (4, 4)],
      '打吃整块。', '白棋向外长。', '提掉整块。', '相连白棋共享气。')
three('tactic-atari-row', '整块打吃：横排三子', 'atari',
      [(2, 3), (3, 3), (4, 3), (2, 5), (3, 5), (4, 5), (6, 3)],
      [(2, 4), (3, 4), (4, 4)],
      '打吃横排。', '白棋向右长。', '提掉整块。', '数整块的气。')

# 接不归：已知能用的基本型加相邻子
base_b = [(1, 2), (2, 1), (1, 3), (2, 4), (3, 4)]
base_w = [(2, 2), (3, 3)]
trap_lines = [
    [((3, 2), '打吃上方目标。'), ((2, 3), '白棋连接同伴。'), ((4, 3), '连接后整块仍只有一口气，全部提掉。')],
    [((3, 2), '打吃上方目标。'), ((4, 3), '白棋向外逃。'), ((2, 3), '直接提掉目标。')],
]
commit('tactic-trap-wide', '接不归：旁边还有一块也接不上', 'connection_trap',
       base_b + [(0, 2), (0, 4)], base_w, [base_w[0]], trap_lines,
       '接上之前先数连接后的气。')
commit('tactic-trap-low', '接不归：向下接也无路', 'connection_trap',
       base_b + [(3, 5), (4, 5)], base_w, [base_w[0]], trap_lines,
       '接上之后气没有增加，就不要接。')

# 双打吃搜索
double_specs = [
    ('tactic-double-far', '双打吃：隔开的两颗', [(1, 2), (2, 1), (4, 1), (5, 2), (2, 3), (4, 3)], [(2, 2), (4, 2)]),
    ('tactic-double-stack', '双打吃：单子与弯块', [(1, 3), (2, 2), (2, 4), (4, 2), (5, 3), (4, 4)], [(2, 3), (4, 3), (3, 4)]),
    ('tactic-double-split', '双打吃：左右两块', [(2, 2), (4, 2), (1, 3), (5, 3), (2, 4), (4, 4)], [(2, 3), (4, 3)]),
]
for name, title, blacks, whites in double_specs:
    found = find_double(blacks, whites)
    if not found:
        print('NODBL', name)
        continue
    first, branches, targets = found
    lines = [[(first, '同时打吃两块。'), (run, '白棋救一边。'), (cap, '提掉另一边。')] for run, cap in branches]
    commit(name, title, 'double_atari', blacks, whites, targets, lines, '白救一边，你提另一边。', 'capture_any')

# 倒扑搜索
snap_specs = [
    ('tactic-snapback-side', '倒扑：边上送一子回提', [(3, 0), (4, 0), (5, 0), (3, 1), (5, 1), (3, 2), (4, 3), (6, 2)], [(4, 1), (4, 2), (5, 2)]),
    ('tactic-snapback-u', '倒扑：口袋里送子', [(2, 1), (3, 1), (4, 1), (2, 2), (4, 2), (2, 3), (4, 3), (3, 4)], [(3, 2), (3, 3)]),
    ('tactic-snapback-bag', '倒扑：送一子回提四子', [(1, 1), (2, 1), (3, 1), (1, 2), (3, 2), (1, 3), (3, 3), (2, 4)], [(2, 2), (2, 3)]),
]
for name, title, blacks, whites in snap_specs:
    found = find_snapback(blacks, whites)
    if not found:
        print('NOSNAP', name)
        continue
    first, take, captured = found
    lines = [[(first, '扑入一子，让白棋来提。'), (take, '白棋提掉扑入的黑子，自己只剩一口气。'), (first, '在原处回提。')]]
    commit(name, title, 'snapback', blacks, whites, captured, lines, '先算白棋提子后还剩几口气。')

# more unique wedges: L-shape belly
wedge_specs = [
    ('tactic-wedge-l', '挖吃：挖弯三的肚子', [(2, 2), (3, 1), (4, 1), (5, 2), (2, 4), (5, 4), (3, 5), (4, 5), (1, 3), (6, 3)], [(3, 3), (4, 3), (4, 2)]),
    ('tactic-wedge-n', '挖吃：挖进长条', [(2, 1), (2, 2), (2, 3), (2, 4), (5, 1), (5, 2), (5, 3), (5, 4), (3, 5), (4, 0)], [(3, 2), (4, 2), (3, 3), (4, 3)]),
    ('tactic-wedge-c', '挖吃：挖缺了一口的方块', [(2, 2), (3, 2), (4, 2), (2, 3), (4, 3), (2, 4), (3, 5), (4, 4), (5, 1)], [(3, 3), (3, 4)]),
]
for name, title, blacks, whites in wedge_specs:
    three(name, title, 'wedge', blacks, whites, '挖进白棋内部。', '白棋向外逃。', '提掉整块。', '挖吃下在形里。')
    five(name + '-5', title, 'wedge', blacks, whites,
         ['挖进白棋内部。', '白棋向外长。', '继续挖紧。', '白棋再逃。', '提掉整块。'], '挖吃下在形里。')

# more snapbacks with extra unique stones
snap_more = [
    ('tactic-snapback-rim', [(0, 2), (1, 1), (2, 1), (3, 2), (0, 3), (3, 3), (1, 4), (2, 4), (4, 4)], [(1, 2), (2, 2), (1, 3)]),
    ('tactic-snapback-low', [(4, 4), (5, 4), (6, 4), (4, 5), (6, 5), (4, 6), (5, 7), (6, 6), (7, 3)], [(5, 5), (5, 6)]),
    ('tactic-snapback-mid', [(2, 3), (3, 2), (4, 2), (5, 3), (2, 4), (5, 4), (3, 5), (4, 5), (1, 1)], [(3, 3), (4, 3), (3, 4)]),
]
for name, blacks, whites in snap_more:
    found = find_snapback(blacks, whites)
    if not found:
        print('NOSNAP', name)
        continue
    first, take, captured = found
    lines = [[(first, '扑入一子，让白棋来提。'), (take, '白棋提掉扑入的黑子，自己只剩一口气。'), (first, '在原处回提。')]]
    commit(name, '倒扑：再送一子回提', 'snapback', blacks, whites, captured, lines, '先算白棋提子后还剩几口气。')

def clone_with(name, title, concept, source_id, extras, hint):
    src = next(l for l in tactics.catalog() if l['id'] == source_id)
    blacks = [(s['x'], s['y']) for s in src['stones'] if s['color'] == 1] + extras
    whites = [(s['x'], s['y']) for s in src['stones'] if s['color'] == 2]
    targets = [tuple(p) if not isinstance(p, dict) else (p['x'], p['y']) for p in src['objective']['targets']]
    def walk(node):
        lines = []
        if node.get('move'):
            return None
        def collect(n, path):
            if not n.get('children'):
                lines.append(path)
                return
            for c in n['children']:
                collect(c, path + [(tuple(c['move']), c['explanation'])])
        collect(n, [])
        return lines
    lines = []
    def collect(n, path):
        if not n.get('children'):
            if path:
                lines.append(path)
            return
        for c in n['children']:
            collect(c, path + [(tuple(c['move']), c['explanation'])])
    collect(src['tree'], [])
    commit(name, title, concept, blacks, whites, targets, lines, hint, src['objective']['kind'])

clone_with('tactic-wedge-wide', '挖吃：挖开后再追', 'wedge', 'tactic-wedge', [(6, 1), (1, 4)], '挖在形里，再看它往哪逃。')
clone_with('tactic-wedge-mark', '挖吃：挖进有后援的肚子', 'wedge', 'tactic-wedge', [(0, 2), (7, 3)], '先挖内部要点。')
clone_with('tactic-snapback-extra', '倒扑：多一颗后援再回提', 'snapback', 'tactic-snapback', [(4, 3), (5, 2)], '提掉你一子后还剩几口气。')
clone_with('tactic-snapback-far', '倒扑：边上有子也照样回提', 'snapback', 'tactic-snapback-pack', [(6, 4), (7, 1)], '这不是劫。')
clone_with('tactic-net-extra', '枷吃：飞枷外还有后援', 'net', 'tactic-net', [(7, 2), (0, 5)], '先拦住出路。')
clone_with('tactic-hug-extra', '抱吃：厚势里抱住', 'hug', 'tactic-hug', [(1, 1), (6, 5)], '往棋多的方向赶。')
clone_with('tactic-gate-extra', '门吃：通道外还有子', 'gate', 'tactic-gate', [(6, 1), (0, 6)], '先关一头。')
clone_with('tactic-ladder-extra', '征吃：前方后援更远', 'ladder', 'tactic-short-ladder', [(6, 6), (0, 5)], '每步重新数气。')

print('\nOK count', len(ok))
print([l['id'] for l in ok])
from collections import Counter
print(Counter(l['concept'] for l in ok))
out = []
for lesson in ok:
    clean = tactics.validate_lesson(lesson)
    clean['concept'] = lesson['concept']
    out.append(clean)
path = Path(__file__).parent / 'more.json'
path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print('wrote', path, 'n=', len(out))
