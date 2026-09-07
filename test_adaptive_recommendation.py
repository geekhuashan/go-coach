import unittest
from unittest.mock import patch
import curriculum
import server

def attempt(identity,correct,assisted=False):return dict(lesson_id=identity,correct=correct,assisted=assisted,attempt_no=1)

class AdaptiveTest(unittest.TestCase):
    def test_win_loss_assistance_and_rotation(self):
        wins=[attempt(f'escape-1-{n}',True) for n in (1,2,3)]
        r=curriculum.recommend(wins);self.assertNotEqual(r['skill'],'escape');self.assertEqual(r['adjustment']['kind'],'reduce_frequency');self.assertIn('连续做对3道不同题',r['reason'])
        losses=[attempt('escape-2-1',False),attempt('escape-2-2',False)]
        r=curriculum.recommend(losses);self.assertEqual(r['skill'],'escape');self.assertEqual(r['difficulty'],1);self.assertEqual(r['adjustment']['kind'],'reinforce')
        r=curriculum.recommend(losses+[attempt('escape-1-1',False)]);self.assertNotEqual(r['skill'],'escape');self.assertEqual(r['adjustment']['kind'],'rotate')
        assisted=[dict(a,assisted=True) for a in wins];self.assertNotEqual(curriculum.recommend(assisted)['adjustment']['kind'],'reduce_frequency');self.assertEqual(curriculum.learning(assisted)['independent_correct'],0)
        self.assertEqual(curriculum.recommend([dict(a,attempt_no=2) for a in wins])['adjustment']['kind'],'reduce_frequency')
        interleaved=[event for a in wins for event in (dict(a,correct=False),dict(a,attempt_no=2))]
        self.assertNotEqual(curriculum.recommend(interleaved)['adjustment']['kind'],'reduce_frequency')
        interrupted=[dict(wins[0],correct=False),dict(wins[1],correct=False),wins[0],dict(wins[0],correct=False),attempt('capture-1-1',True)]
        self.assertNotEqual(curriculum.recommend(interrupted)['adjustment']['kind'],'reinforce')
        self.assertNotEqual(curriculum.recommend([wins[0]]*3)['adjustment']['kind'],'reduce_frequency')
        self.assertEqual(curriculum.recommend([attempt('escape-1-1',None)])['adjustment']['kind'],'balanced')
    def test_concept_group_and_profile_isolation(self):
        base=next(l for l in curriculum.catalog() if l.get('sequence') and l['difficulty']==3)
        book=[dict(base,id=f'edge-test-{n}',concept='edge_chase') for n in (1,2,3)]+[dict(base,id='ladder-test',concept='ladder')]
        records=[attempt(l['id'],True) for l in book[:3]]
        with patch.object(curriculum,'_CATALOG',book),patch.object(curriculum,'_BY_ID',{l['id']:l for l in book}):
            stats=[dict(id='capture',next_difficulty=3)]
            r=curriculum._recommend(records,stats);self.assertEqual(r['concept'],'ladder');self.assertIn('边线追吃',r['reason'])
        parent=server.make_profile('parent','家长');child=server.make_profile('child','孩子')
        parent['attempts']=[attempt('escape-2-1',False),attempt('escape-2-2',False)]
        self.assertEqual(curriculum.recommend(parent['attempts'])['adjustment']['kind'],'reinforce')
        self.assertEqual(curriculum.recommend(child['attempts'])['adjustment']['kind'],'balanced')
