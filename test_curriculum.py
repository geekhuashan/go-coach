import unittest
from curriculum import catalog, get_lesson, grade, learning, recommend
from go_rules import play, group, key


def board_for(lesson):
    board = [[0]*9 for _ in range(9)]
    for p in lesson['stones']:
        board[p['y']][p['x']] = p['color']
    return board


def attempt(lesson_id, correct=True, **kwargs):
    l = get_lesson(lesson_id)
    return dict(lesson_id=lesson_id, skill=l['skill'], difficulty=l['difficulty'], correct=correct, assisted=kwargs.get('assisted',False), attempt_no=kwargs.get('attempt_no',1))


class CurriculumTests(unittest.TestCase):
    def test_all_variants_unique_and_solvable_with_wrong_moves(self):
        lessons = [l for l in catalog() if not l.get("sequence")]
        self.assertGreaterEqual(len(lessons),48)
        self.assertEqual(len({key(board_for(l)) for l in lessons}),len(lessons))
        for lesson in lessons:
            with self.subTest(lesson=lesson['id']):
                board = board_for(lesson)
                for p in lesson['stones']:
                    self.assertTrue(group(board,p['x'],p['y'])[1], 'initial zero-liberty group')
                correct, incorrect = [], []
                for y in range(9):
                    for x in range(9):
                        try:
                            after,captured = play(board,x,y,1)
                        except ValueError:
                            continue
                        result = grade(lesson,board,after,{'x':x,'y':y},captured)
                        self.assertTrue(result['summary'])
                        self.assertTrue(result['explanation'])
                        (correct if result['correct'] else incorrect).append((x,y))
                self.assertTrue(correct, 'no legal answer')
                self.assertGreater(len(incorrect),40)
                self.assertEqual(len(correct),1, 'unrelated move accepted')

    def test_real_difficulty_and_variant_label(self):
        for skill in ('escape','capture','connect','cut'):
            low,high=get_lesson(f'{skill}-1-1'),get_lesson(f'{skill}-2-1')
            self.assertGreater(len(high['stones']),len(low['stones']))
            self.assertEqual({l['difficulty'] for l in catalog() if l['skill']==skill and not l.get('sequence')},{1,2})
        for skill in ('escape','capture'):
            self.assertEqual(len(get_lesson(f'{skill}-2-1')['objective']['targets']),2)

    def test_duplicate_retry_and_hint_do_not_inflate(self):
        records=[attempt('escape-1-1',False),attempt('escape-1-1',True,attempt_no=2),attempt('escape-1-2',True,assisted=True),attempt('escape-1-2',True,attempt_no=2)]
        result=learning(records)
        self.assertEqual(result['attempts_count'],4)
        self.assertEqual(result['independent_attempts'],1)
        self.assertEqual(result['independent_correct'],0)
        self.assertEqual(result['skills'][0]['stage'],'待评估')
        self.assertEqual(result['skills'][0]['next_difficulty'],1)

    def test_evidence_threshold_and_difficulty(self):
        two=[attempt(f'escape-1-{i}') for i in (1,2)]
        self.assertEqual(learning(two)['skills'][0]['next_difficulty'],1)
        three=two+[attempt('escape-1-3')]
        self.assertEqual(learning(three)['skills'][0]['next_difficulty'],2)
        three.append(attempt('escape-1-4',False))
        self.assertEqual(learning(three)['skills'][0]['next_difficulty'],2)
        three.append(attempt('escape-1-5',False))
        self.assertEqual(learning(three)['skills'][0]['next_difficulty'],1)

    def test_recommendation_remediation_and_coverage(self):
        self.assertEqual(recommend([])['skill'],'escape')
        records=[attempt('escape-1-1',False)]
        second=recommend(records)
        self.assertEqual(second['skill'],'escape')
        self.assertNotEqual(second['id'],'escape-1-1')
        records.append(attempt(second['id'],False))
        self.assertEqual(recommend(records)['skill'],'capture')
        for _ in range(12):
            new=recommend(records)
            self.assertNotEqual(new['id'],records[-1]['lesson_id'])
            records.append(attempt(new['id']))
        self.assertEqual({a['skill'] for a in records},{'escape','capture','connect','cut'})

    def test_cut_feedback_does_not_claim_global_cut(self):
        lesson=get_lesson('cut-2-1')
        b=board_for(lesson)
        x,y=lesson['objective']['point']
        a,c=play(b,x,y,1)
        result=grade(lesson,b,a,{'x':x,'y':y},c)
        self.assertTrue(result['correct'])
        self.assertIn('尚未判断',result['explanation'])

    def test_advanced_mastery_and_independent_step_back(self):
        records=[attempt(f'escape-1-{i}') for i in (1,2,3)]
        records += [attempt(f'escape-2-{i}') for i in (1,2,3)]
        self.assertEqual(learning(records)['skills'][0]['stage'],'进阶题较稳')
        records += [attempt('escape-2-4',False,assisted=True),attempt('escape-2-5',False,assisted=True)]
        self.assertEqual(learning(records)['skills'][0]['next_difficulty'],2)
        records += [attempt('escape-2-6',False),attempt('escape-2-7',False)]
        self.assertEqual(learning(records)['skills'][0]['next_difficulty'],1)
        self.assertEqual(learning(records)['skills'][0]['stage'],'继续巩固基础')

    def test_legacy_positions_and_evidence(self):
        for skill, move in [('escape',(3,6)),('capture',(3,6)),('connect',(3,5))]:
            lesson=get_lesson(skill)
            board=board_for(lesson)
            after,captured=play(board,*move,1)
            self.assertTrue(grade(lesson,board,after,dict(x=move[0],y=move[1]),captured)['correct'])
            result=learning([attempt(skill),attempt(skill,attempt_no=2)])
            self.assertEqual(result['independent_attempts'],1)

    def test_catalog_isolation(self):
        a=get_lesson('escape-1-1')
        a['stones'].clear()
        self.assertTrue(get_lesson('escape-1-1')['stones'])
        with self.assertRaises(ValueError):
            get_lesson('missing')


if __name__=='__main__':
    unittest.main()
