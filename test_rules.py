import copy
import unittest
from go_rules import group,play,key
from server import apply,blank,lesson_state,export_sgf

class RulesTest(unittest.TestCase):
    def test_shared_liberties(self):
        b=[[0]*5 for _ in range(5)]
        b[2][2]=b[2][3]=1
        stones,libs=group(b,2,2)
        self.assertEqual(len(stones),2)
        self.assertEqual(len(libs),6)
    def test_capture(self):
        s=lesson_state('capture',0)
        apply(s,{'type':'play','x':3,'y':6})
        self.assertEqual(s['board'][5][3],0)
        self.assertEqual(s['captures']['black'],1)
    def test_suicide(self):
        b=[[0,2,0],[2,0,2],[0,2,0]]
        with self.assertRaises(ValueError):play(b,1,1,1)
    def test_ko(self):
        b=[[0]*5 for _ in range(5)]
        for x,y in [(1,2),(2,1),(3,2)]:b[y][x]=1
        for x,y in [(2,2),(1,3),(3,3),(2,4)]:b[y][x]=2
        after,n=play(b,2,3,1,[key(b)])
        self.assertEqual(n,1)
        with self.assertRaises(ValueError):play(after,2,2,2,[key(b),key(after)])
    def test_undo_passes(self):
        s=blank()
        apply(s,{'type':'play','x':2,'y':2})
        before=copy.deepcopy(s['board'])
        apply(s,{'type':'pass'});apply(s,{'type':'pass'})
        self.assertTrue(s['ended'])
        apply(s,{'type':'undo'})
        self.assertFalse(s['ended']);self.assertEqual(s['passes'],1)
        apply(s,{'type':'undo'});apply(s,{'type':'undo'})
        self.assertEqual(s['board'],blank()['board']);self.assertEqual(s['moves'],[])
    def test_demo_restore(self):
        s=lesson_state('escape',5)
        original=copy.deepcopy(s)
        apply(s,{'type':'demo','moves':[{'x':3,'y':6}]})
        self.assertTrue(s['demo_active'])
        with self.assertRaises(ValueError):apply(s,{'type':'play','x':0,'y':0})
        apply(s,{'type':'restore_demo'})
        self.assertEqual(s['board'],original['board'])
        self.assertEqual(s['history'],original['history'])
        self.assertEqual(s['moves'],[])
    def test_lesson_facts(self):
        s=lesson_state('escape',0)
        apply(s,{'type':'play','x':0,'y':0})
        self.assertIn('仍被打吃',s['message'])
        s=lesson_state('connect',0)
        apply(s,{'type':'play','x':3,'y':5})
        self.assertIn('同一块',s['message'])
    def test_escape(self):
        s=lesson_state('escape',0)
        apply(s,{'type':'play','x':3,'y':6})
        self.assertIn('已解除打吃',s['message'])
        self.assertEqual(s['initial_board'][6][3],0)

    def test_custom_setup(self):
        s=blank(8)
        apply(s,{'type':'setup','stones':[{'x':1,'y':1,'color':2}], 'to_play':1,'title':'气','prompt':'练习'})
        self.assertEqual(s['revision'],8)
        self.assertEqual(s['lesson']['id'],'custom')
        self.assertEqual(s['moves'],[])
        self.assertEqual(s['initial_board'][1][1],2)
        apply(s,{'type':'play','x':0,'y':0})
        self.assertIn('气与提子结果',s['message'])
        self.assertNotIn('C4',s['message'])
    def test_retry_custom(self):
        s=blank()
        apply(s,{'type':'setup','stones':[{'x':1,'y':1,'color':2}], 'to_play':2})
        apply(s,{'type':'play','x':2,'y':1})
        apply(s,{'type':'retry'})
        self.assertEqual(s['to_play'],2)
        self.assertEqual(s['board'][1][2],0)
        self.assertEqual(s['lesson']['id'],'custom')
        self.assertFalse(s['lesson_attempted'])
    def test_demo_steps(self):
        s=blank()
        apply(s,{'type':'demo','moves':[{'x':1,'y':1},{'x':2,'y':2}]})
        self.assertEqual(s['demo_step'],1)
        self.assertEqual(s['board'][2][2],0)
        apply(s,{'type':'demo_next'})
        self.assertEqual(s['demo_step'],2)
        self.assertEqual(s['board'][2][2],2)
        apply(s,{'type':'restore_demo'})
        self.assertEqual(s['board'],blank()['board'])
    def test_invalid_setups(self):
        invalid=[
            [{'x':1,'y':1,'color':1},{'x':1,'y':1,'color':2}],
            [{'x':9,'y':0,'color':1}],
            [{'x':1,'y':1,'color':0}],
            [{'x':0,'y':0,'color':1},{'x':1,'y':0,'color':2},{'x':0,'y':1,'color':2}],
        ]
        for pieces in invalid:
            s=blank();before=copy.deepcopy(s)
            with self.assertRaises(ValueError):apply(s,{'type':'setup','stones':pieces})
            self.assertEqual(s,before)
    def test_undo_preserves_feedback(self):
        s=blank()
        apply(s,{'type':'play','x':1,'y':1})
        apply(s,{'type':'feedback','text':'我认为这里有四口气'})
        feedback=copy.deepcopy(s['feedback'])
        apply(s,{'type':'undo'})
        self.assertEqual(s['feedback'],feedback)
        self.assertEqual(s['board'][1][1],0)
    def test_restore_demo_preserves_feedback(self):
        s=blank()
        apply(s,{'type':'demo','moves':[{'x':1,'y':1}]})
        apply(s,{'type':'feedback','text':'这步演示我看懂了'})
        feedback=copy.deepcopy(s['feedback'])
        apply(s,{'type':'restore_demo'})
        self.assertEqual(s['feedback'],feedback)
        self.assertFalse(s['demo_active'])
        self.assertEqual(s['board'][1][1],0)
    def test_sgf(self):
        s=lesson_state('capture',0)
        apply(s,{'type':'play','x':3,'y':6})
        s['feedback']=[{'text':'PRIVATE'}]
        text=export_sgf(s)
        self.assertIn('CA[UTF-8]',text)
        self.assertIn('SZ[9]',text)
        self.assertIn('AW[df]',text)
        self.assertIn(';B[dg]',text)
        self.assertNotIn('PRIVATE',text)
        s=blank();apply(s,{'type':'pass'})
        self.assertIn(';B[]',export_sgf(s))

if __name__=='__main__':unittest.main()
