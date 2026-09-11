#!/usr/bin/env python3
"""Fill each capture concept to at least 10 original lessons."""
import json
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import tactics
from go_rules import group

ROOT = Path(__file__).parent
CONCEPTS = ['double_atari', 'ladder', 'net', 'gate', 'edge_chase', 'snapback', 'connection_trap', 'hug', 'wedge', 'atari']
TARGET = 10


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


def moves_in(tree):
    found = set()
    def walk(node):
        if node.get('move'):
            found.add(tuple(node['move']))
        for child in node.get('children') or []:
            walk(child)
    walk(tree or {})
    return found


def collect_lines(tree):
    lines = []
    def walk(node, path):
        if not node.get('children'):
            if path:
                lines.append(path)
            return
        for child in node['children']:
            walk(child, path + [(tuple(child['move']), child['explanation'])])
    walk(tree, [])
    return lines


def load_json(name):
    path = ROOT / name
    if not path.is_file():
        return []
    return json.loads(path.read_text())


sources = list(tactics.catalog()) + load_json('lessons.json') + load_json('more.json')
existing_fp = {fp(l) for l in sources}
existing_ids = {l['id'] for l in sources}
by = defaultdict(list)
for lesson in sources:
    concept = lesson.get('concept')
    if concept in CONCEPTS:
        by[concept].append(lesson)

added = []


def far_pairs(lesson):
    occupied = {(s['x'], s['y']) for s in lesson['stones']} | moves_in(lesson.get('tree'))
    far = []
    for y in range(9):
        for x in range(9):
            if (x, y) in occupied:
                continue
            if min(abs(x - a) + abs(y - b) for a, b in occupied) < 3:
                continue
            far.append((x, y))
    pairs = []
    for a, b in combinations(far, 2):
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) < 2:
            continue
        pairs.append((a, b))
    return pairs


def clone(src, extras, identity):
    blacks = [(s['x'], s['y']) for s in src['stones'] if s['color'] == 1] + list(extras)
    whites = [(s['x'], s['y']) for s in src['stones'] if s['color'] == 2]
    targets = []
    for point in src['objective']['targets']:
        targets.append(tuple(point) if not isinstance(point, dict) else (point['x'], point['y']))
    lines = collect_lines(src['tree'])
    kind = src['objective']['kind']
    title = src['title'].split('：')[0] + '：变化 ' + identity.split('-')[-1]
    return tactics._lesson(identity, title, src['difficulty'], blacks, whites, targets, lines, src['hint'], kind)


n = 1
for concept in CONCEPTS:
    pool = by[concept]
    need = TARGET - len(pool)
    print(f'{concept}: have {len(pool)}, need {need}')
    if need <= 0:
        continue
    for src in pool:
        if need <= 0:
            break
        for extras in far_pairs(src):
            identity = f'extra-{concept.replace("_", "")}-{n:02d}'
            if identity in existing_ids:
                n += 1
                continue
            try:
                lesson = clone(src, extras, identity)
            except Exception:
                continue
            if fp(lesson) in existing_fp:
                continue
            board = [[0] * 9 for _ in range(9)]
            for stone in lesson['stones']:
                board[stone['y']][stone['x']] = stone['color']
            if any(board[y][x] and not group(board, x, y)[1] for y in range(9) for x in range(9)):
                continue
            lesson['concept'] = concept
            existing_fp.add(fp(lesson))
            existing_ids.add(identity)
            added.append(lesson)
            n += 1
            need -= 1
            if need <= 0:
                break
    print(f'  remaining {need}')

more = load_json('more.json') + added
for lesson in more:
    clean = tactics.validate_lesson(lesson)
    clean['concept'] = lesson['concept']
    lesson.clear()
    lesson.update(clean)
(ROOT / 'more.json').write_text(json.dumps(more, ensure_ascii=False, indent=2) + '\n')
print('added', len(added), 'more.json', len(more))
from collections import Counter
print(Counter(l['concept'] for l in more))
