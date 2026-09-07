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
    def test_variant_limits_keep_history_and_advance_from_hidden(self):
        visible=[l for l in curriculum.catalog() if curriculum.available_lesson(l)]
        self.assertEqual(len(visible),474)
        for skill in ('escape','capture','connect','cut'):
            for difficulty,count in ((1,3),(2,5)):
                self.assertEqual(sum(l.get('family_id')==f'{skill}-{difficulty}' for l in visible),count)
        self.assertTrue(curriculum.available_lesson(dict(id='imported',family_id='escape-1',variant=8)))
        self.assertTrue(curriculum.available_lesson(dict(id='escape-1-9')))
        store=self.store();p=store['profiles']['parent'];self.assertEqual(p['state']['lesson']['id'],'escape-1-1')
        p['attempts']=[dict(lesson_id='escape-1-8',correct=True,assisted=False,attempt_no=1)]
        self.assertEqual(curriculum.learning(p['attempts'])['independent_correct'],1)
        self.assertTrue(curriculum.available_lesson(curriculum.recommend(p['attempts'])))
        p['practice_mode']='sequential';server.apply_store(store,dict(type='lesson',id='escape-1-8'))
        self.assertEqual(p['state']['lesson']['id'],'escape-1-8')
        server.apply_store(store,dict(type='next_lesson'));self.assertEqual(p['state']['lesson']['id'],'escape-2-1')
        p['practice_mode']='review';p['helped_lesson_ids']=['escape-1-8'];self.assertEqual(server.practice_progress(p)['review_count'],0)

    def test_book_sequential_scope_crosses_chapters_and_preserves_records(self):
        store=self.store();profile=store['profiles']['parent']
        base=copy.deepcopy(curriculum.get_lesson('escape-1-1'))
        book=[dict(base,id='private-'+str(n),source={'kind':'book','title':'我的手筋书','problem':str(n)},concept=chapter) for n,chapter in [(10,'第二章'),(2,'第一章'),(1,'第一章')]]
        other=dict(base,id='other-book',source={'kind':'book','title':'别的书','problem':'1'})
        catalog=[base,other,*book]
        with patch.object(curriculum,'catalog',lambda:copy.deepcopy(catalog)),patch.object(curriculum,'get_lesson',lambda identity:copy.deepcopy(next((l for l in catalog if l['id']==identity),None))):
            profile['practice_mode']='sequential'
            server.apply_store(store,{'type':'lesson','id':'private-2'})
            profile['attempts']=[dict(lesson_id='private-1',correct=True,assisted=True),dict(lesson_id='private-2',correct=True,assisted=False)]
            records=copy.deepcopy(profile['attempts'])
            progress=server.practice_progress(profile,'private-2',True)
            self.assertEqual((progress['total'],progress['completed'],progress['current_index']),(3,2,2))
            self.assertEqual((progress['book_title'],progress['chapter'],progress['next_id']),('我的手筋书','第一章','private-10'))
            server.apply_store(store,{'type':'next_lesson'})
            self.assertEqual(profile['state']['lesson']['concept'],'第二章')
            self.assertEqual(profile['attempts'],records)
            profile['attempts'].append(dict(lesson_id='private-10',correct=True))
            server.apply_store(store,{'type':'next_lesson'})
            self.assertEqual(profile['state']['lesson']['id'],'private-10')
            self.assertIn('已导入的题目全部完成',profile['state']['message'])
            self.assertTrue(server.practice_progress(profile,'private-10')['book_complete'])
            self.assertEqual(server.practice_progress(profile,base['id'])['total'],5)
            self.assertNotIn('book_title',server.practice_progress(profile,base['id']))
            for mode in ('review','recommended'):
                profile['practice_mode']=mode
                self.assertEqual(server.practice_progress(profile,'private-10')['total'],5)
                self.assertNotIn('book_title',server.practice_progress(profile,'private-10'))
