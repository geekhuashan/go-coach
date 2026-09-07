import copy
import unittest
from unittest.mock import patch
import curriculum
import server

class PracticeTest(unittest.TestCase):
    def store(self):
        return dict(schema=2,revision=0,active_profile_id='parent',matches={},profiles={identity:server.make_profile(identity,identity) for identity in ('parent','child')})
    def test_modes_and_assisted_completion(self):
        store=self.store()
        for action in ({'type':'lesson','id':'escape-1-1'},{'type':'hint'},{'type':'practice_mode','mode':'review'},{'type':'play','x':2,'y':4}):server.apply_store(store,action)
        profile=store['profiles']['parent'];progress=server.practice_progress(profile)
        self.assertEqual(progress['completed'],1);self.assertEqual(progress['review_count'],0)
        self.assertTrue(profile['attempts'][0]['assisted'])
        server.apply_store(store,{'type':'next_lesson'});self.assertIn('没有待复习',profile['state']['message'])
        server.apply_store(store,{'type':'practice_mode','mode':'sequential'});first=profile['state']['lesson']['id']
        server.apply_store(store,{'type':'next_lesson'});self.assertNotEqual(first,profile['state']['lesson']['id'])
        self.assertEqual(store['profiles']['child'].get('practice_mode','recommended'),'recommended')
    def test_solution_initial_replay_restore_and_no_attempt(self):
        store=self.store();lesson=next(l for l in curriculum.catalog() if l.get('sequence'))
        server.apply_store(store,{'type':'lesson','id':lesson['id']});s=server.active_state(store)
        m=lesson['tree']['children'][0]['move'];server.apply_store(store,{'type':'play','x':m[0],'y':m[1]});original=copy.deepcopy(s['board']);before=len(store['profiles']['parent']['attempts'])
        server.apply_store(store,{'type':'solution'});self.assertEqual(s['demo_step'],1);self.assertEqual(len(s['moves']),1)
        with patch.object(server,'engine_info',lambda:{}):visible=server.public(s)
        self.assertNotIn('tree',visible['lesson']);self.assertNotIn('_demo_moves',visible);self.assertIsNotNone(visible['lesson']['focus_bounds'])
        while s['demo_step']<s['demo_total']:server.apply_store(store,{'type':'demo_next'})
        server.apply_store(store,{'type':'restore_demo'});self.assertEqual(original,s['board']);self.assertTrue(s['assisted']);self.assertEqual(before,len(store['profiles']['parent']['attempts']))
    def test_partial_sequence_switch_to_review_restarts_immediately(self):
        store=self.store();server.apply_store(store,{'type':'lesson','id':'tactic-short-ladder'})
        s=server.active_state(store);m=s['lesson']['tree']['children'][0]['move'];server.apply_store(store,{'type':'play','x':m[0],'y':m[1]})
        self.assertEqual(len(s['moves']),2);self.assertFalse(s['lesson_attempted'])
        server.apply_store(store,{'type':'practice_mode','mode':'review'})
        self.assertEqual(s['lesson']['id'],'tactic-short-ladder');self.assertEqual(s['moves'],[]);self.assertTrue(s['assisted'])
