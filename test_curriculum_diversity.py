"""Curation must remove tactical duplicates without rewriting any saved problem."""
import json
import unittest
from collections import Counter
from pathlib import Path

import curriculum
import tactics
from go_rules import key, play


def core_fingerprint(lesson):
    anchors = {(s['x'], s['y']) for s in lesson['stones'] if s['color'] == 3 - lesson['to_play']}
    def walk(node):
        if node.get('move'): anchors.add(tuple(node['move']))
        for child in node.get('children', []): walk(child)
    walk(lesson.get('tree', {}))
    stones = [s for s in lesson['stones'] if any(abs(s['x'] - x) + abs(s['y'] - y) <= 1 for x, y in anchors)]
    forms = []
    for flip in (False, True):
        for turns in range(4):
            points = []
            for s in stones:
                x, y = s['x'], s['y']
                if flip: x = -x
                for _ in range(turns): x, y = -y, x
                points.append((x, y, s['color']))
            mx, my = min(p[0] for p in points), min(p[1] for p in points)
            forms.append(tuple(sorted((x - mx, y - my, c) for x, y, c in points)))
    return min(forms)


class DiversityTests(unittest.TestCase):
    def test_visible_originals_have_distinct_tactical_cores(self):
        originals = [l for l in curriculum.catalog() if l.get('source', {}).get('kind') == 'original' and curriculum.available_lesson(l)]
        self.assertEqual(len(originals), 43)
        seen = {}
        for l in originals:
            fp = (l['concept'], core_fingerprint(l))
            self.assertNotIn(fp, seen, (seen.get(fp), l['id']))
            seen[fp] = l['id']
        counts = Counter(l['concept'] for l in originals)
        self.assertEqual({c: counts[c] for c in ['net','gate','edge_chase','snapback','connection_trap']}, dict(net=3,gate=5,edge_chase=8,snapback=6,connection_trap=4))

    def test_retired_ids_keep_exact_stones_answers_and_evidence(self):
        old = {l['id']: l for l in json.loads(Path('data/original-extra/more.json').read_text())}
        retired = curriculum._CURATION['retired']
        self.assertEqual(len(retired), 77)
        for identity, record in retired.items():
            l = curriculum.get_lesson(identity)
            self.assertFalse(curriculum.available_lesson(l))
            self.assertEqual(l['stones'], old[identity]['stones'])
            self.assertEqual(l['tree'], old[identity]['tree'])
            representative = curriculum.get_lesson(record['representative'])
            self.assertTrue(curriculum.available_lesson(representative))
            self.assertEqual(core_fingerprint(l), core_fingerprint(representative))
        self.assertEqual(curriculum.learning([dict(lesson_id='extra-net-15', correct=True, assisted=False, attempt_no=1)])['independent_correct'], 1)

    def test_retained_and_new_solutions_are_legal_and_reach_targets(self):
        for l in curriculum.catalog():
            if l.get('source', {}).get('kind') == 'original' and curriculum.available_lesson(l):
                with self.subTest(lesson=l['id']): tactics.validate_lesson(l)
        l = curriculum.get_lesson('original-diverse-snapback-center')
        self.assertEqual(len(l['tree']['children']), 2)
        for first in l['tree']['children']:
            b = [[0]*9 for _ in range(9)]
            for s in l['stones']: b[s['y']][s['x']] = s['color']
            seen = [key(b)]; captured = []
            node = first
            for color in (1,2,1):
                b, n = play(b, *node['move'], color, seen)
                seen.append(key(b)); captured.append(n)
                node = node['children'][0] if node['children'] else None
            self.assertEqual(captured, [0, 1, 11])

if __name__ == '__main__': unittest.main()
