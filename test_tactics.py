import unittest
from copy import deepcopy
from unittest.mock import patch
import tactics
from go_rules import group, key, play


class TacticsTests(unittest.TestCase):
    def one_move(self, attacker=1):
        defender = 3-attacker
        return dict(id='book-one', title='书题', prompt='提掉目标', hint='数气', skill='capture', difficulty=1,
                    sequence=True, to_play=attacker,
                    stones=[dict(x=0,y=0,color=defender), dict(x=1,y=0,color=attacker)],
                    objective=dict(kind='capture',targets=[[0,0]]),
                    tree={'children':[dict(move=[0,1], explanation='占最后一口气。', children=[])]},
                    source=dict(kind='book',title='本机书题',page=12,problem=3))

    def test_all_branches_replay_to_actual_capture(self):
        lessons = tactics.catalog()
        self.assertGreaterEqual(len(lessons),8)
        depths, branching_replies = [], 0
        for lesson in lessons:
            self.assertEqual(tactics.validate_lesson(lesson),lesson)
            board = [[0]*9 for _ in range(9)]
            for s in lesson['stones']: board[s['y']][s['x']] = s['color']
            targets = {tuple(p) for p in lesson['objective']['targets']}
            def replay(node, board, seen, removed, depth):
                nonlocal branching_replies
                if depth % 2 == 1 and len(node['children']) > 1:
                    branching_replies += 1
                if not node['children']:
                    self.assertGreaterEqual(depth,3)
                    depths.append(depth)
                    if lesson['objective']['kind']=='capture': self.assertTrue(targets <= removed)
                    else: self.assertTrue(targets & removed)
                for child in node['children']:
                    after, _ = play(board, *child['move'], 1 if depth%2==0 else 2, seen)
                    lost = {p for p in targets if board[p[1]][p[0]]==2 and after[p[1]][p[0]]!=2}
                    replay(child,after,seen+[key(after)],removed|lost,depth+1)
            replay(lesson['tree'],board,[key(board)],set(),0)
        self.assertGreaterEqual(max(depths),7)
        self.assertGreaterEqual(branching_replies,3)

    def test_distinct_positions_not_symmetry_padding(self):
        signatures = set()
        for lesson in tactics.catalog():
            variants=[]
            for flip in (False,True):
                for turns in range(4):
                    transformed=[]
                    for s in lesson['stones']:
                        x,y=s['x'],s['y']
                        if flip:x=8-x
                        for _ in range(turns):x,y=8-y,x
                        transformed.append((x,y,s['color']))
                    variants.append(tuple(sorted(transformed)))
            signatures.add(min(variants))
        self.assertEqual(len(signatures),len(tactics.catalog()))

    def test_snapback_sacrifices_then_captures(self):
        lesson=next(l for l in tactics.catalog() if l['id']=='tactic-snapback')
        board=[[0]*9 for _ in range(9)]
        for s in lesson['stones']:board[s['y']][s['x']]=s['color']
        node=lesson['tree']; captures=[]; seen=[key(board)]
        for color in (1,2,1):
            node=node['children'][0]
            board,n=play(board,*node['move'],color,seen)
            captures.append(n);seen.append(key(board))
        self.assertEqual(captures,[0,1,3])

    def test_one_move_and_white_to_play_supported(self):
        for attacker in (1,2):
            value=tactics.validate_lesson(self.one_move(attacker))
            self.assertEqual(value['to_play'],attacker)
            self.assertEqual(value['source']['page'],'12')

    def corner_19(self, attacker=1):
        value = self.one_move(attacker)
        value['size'] = 19
        value['stones'] = [dict(x=18,y=18,color=3-attacker),dict(x=17,y=18,color=attacker)]
        value['objective']['targets'] = [[18,18]]
        value['marks'] = [dict(x=18,y=18,label='目标')]
        value['tree']['children'][0]['move'] = [18,17]
        return value

    def test_nineteen_corner_capture_both_colors(self):
        for attacker in (1,2):
            value = tactics.validate_lesson(self.corner_19(attacker))
            self.assertEqual(value['size'],19)
            self.assertEqual(value['objective']['targets'],[[18,18]])
            self.assertEqual(value['marks'][0]['x'],18)
            self.assertEqual(value['tree']['children'][0]['move'],[18,17])

    def test_default_nine_does_not_silently_accept_nineteen_coordinates(self):
        value = self.corner_19()
        del value['size']
        with self.assertRaisesRegex(ValueError,'0–8'):tactics.validate_lesson(value)
        self.assertEqual(tactics.validate_lesson(self.one_move())['size'],9)
        self.assertTrue(all(l['size']==9 for l in tactics.catalog()))

    def test_nineteen_bounds_for_stones_marks_targets_and_moves(self):
        for field in ('stones','marks','targets','move'):
            for invalid in (-1,19,True):
                value = self.corner_19()
                if field in ('stones','marks'):value[field][0]['x']=invalid
                elif field=='targets':value['objective']['targets'][0][0]=invalid
                else:value['tree']['children'][0]['move'][0]=invalid
                with self.subTest(field=field,invalid=invalid):
                    with self.assertRaises(ValueError):tactics.validate_lesson(value)
        for size in (13,0,True,'19',19.0):
            value = self.corner_19();value['size']=size
            with self.assertRaisesRegex(ValueError,'尺寸'):tactics.validate_lesson(value)

    def test_nineteen_list_limits_scale_with_board(self):
        value = self.corner_19()
        value['marks'] = [dict(x=x,y=y,label='点') for y in range(19) for x in range(19)]
        self.assertEqual(len(tactics.validate_lesson(value)['marks']),361)
        value['marks'].append(dict(x=0,y=0,label='多余'))
        with self.assertRaisesRegex(ValueError,'标记最多'):tactics.validate_lesson(value)
        value = self.corner_19()
        # More than the original nine-board limits, with a legal independent
        # white group spanning the top rows and enough surrounding liberties.
        value['stones'] += [dict(x=x,y=y,color=2) for y in range(5) for x in range(19)]
        self.assertGreater(len(tactics.validate_lesson(value)['stones']),81)
        value = self.corner_19()
        value['objective']['targets'] *= 362
        with self.assertRaisesRegex(ValueError,'目标坐标'):tactics.validate_lesson(value)

    def test_returned_catalog_and_import_are_independent(self):
        lesson=tactics.catalog()[0]
        lesson['tree']['children'].clear()
        self.assertTrue(tactics.catalog()[0]['tree']['children'])
        source=self.one_move()
        clean=tactics.validate_lesson(source)
        clean['stones'][0]['x']=8
        self.assertEqual(source['stones'][0]['x'],0)

    def test_unknown_fields_are_stripped(self):
        value=self.one_move()
        value['raw_image']='private binary'
        value['source']['url']='https://example.invalid/private'
        value['tree']['children'][0]['script']='alert(1)'
        clean=tactics.validate_lesson(value)
        self.assertNotIn('raw_image',clean)
        self.assertNotIn('url',clean['source'])
        self.assertNotIn('script',clean['tree']['children'][0])

    def test_reject_invalid_initial_position(self):
        value=self.one_move()
        value['stones'].append(dict(x=0,y=1,color=1))
        with self.assertRaisesRegex(ValueError,'无气'):tactics.validate_lesson(value)

    def test_reject_duplicate_stones(self):
        value=self.one_move()
        value['stones'].append(deepcopy(value['stones'][0]))
        with self.assertRaisesRegex(ValueError,'重复'):tactics.validate_lesson(value)

    def test_reject_own_or_empty_targets(self):
        for target in ([1,0],[5,5]):
            value=self.one_move();value['objective']['targets']=[target]
            with self.assertRaisesRegex(ValueError,'目标'):tactics.validate_lesson(value)

    def test_reject_duplicate_branches(self):
        value=self.one_move()
        value['tree']['children']*=2
        with self.assertRaisesRegex(ValueError,'重复走法'):tactics.validate_lesson(value)

    def test_reject_unfinished_leaf(self):
        value=self.one_move()
        value['tree']['children'][0]['move']=[5,5]
        with self.assertRaisesRegex(ValueError,'终点'):tactics.validate_lesson(value)

    def test_reject_illegal_branch_even_if_another_succeeds(self):
        value=self.one_move()
        value['tree']['children'].append(dict(move=[1,0],explanation='坏分支',children=[]))
        with self.assertRaisesRegex(ValueError,'不合法'):tactics.validate_lesson(value)

    def test_reject_extra_moves_after_success(self):
        value=self.one_move()
        value['tree']['children'][0]['children']=[dict(move=[5,5],explanation='多余',children=[])]
        with self.assertRaisesRegex(ValueError,'多余'):tactics.validate_lesson(value)

    def test_reject_invalid_types_and_oversized_input(self):
        mutations=[('difficulty',True),('difficulty',6),('to_play',True),('sequence',1),('title','x'*161),('id','../bad')]
        for field,bad in mutations:
            with self.subTest(field=field,bad=bad):
                value=self.one_move();value[field]=bad
                with self.assertRaises(ValueError):tactics.validate_lesson(value)
        value=self.one_move();value['tree']['children'][0]['move']=[True,1]
        with self.assertRaises(ValueError):tactics.validate_lesson(value)

    def test_tree_resource_limits(self):
        value=tactics.catalog()[-1]
        with patch.object(tactics,'MAX_NODES',3):
            with self.assertRaisesRegex(ValueError,'节点过多'):tactics.validate_lesson(value)
        with patch.object(tactics,'MAX_DEPTH',2):
            with self.assertRaisesRegex(ValueError,'最多'):tactics.validate_lesson(value)

    def test_reject_no_moves(self):
        value=self.one_move();value['tree']={'children':[]}
        with self.assertRaisesRegex(ValueError,'终点'):tactics.validate_lesson(value)


if __name__=='__main__':unittest.main()
