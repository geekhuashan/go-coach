"""Navigation tests use synthetic positions and public book metadata only."""
import copy
import unittest
from unittest.mock import patch

import curriculum
import server
from study_path import STUDY_PATHS, study_path, study_scope


def book(path_index, number, *, old=False, title=None, concept=None):
    lesson = curriculum.get_lesson('escape-1-1')
    prefixes = ['zhangjie-beginner10k-', 'zhangjie-tesuji-10k5k-', 'zhangjie-life-beginner10k-']
    lesson['id'] = f'zhangjie-10k5k-u01-{number:03d}' if old else f'{prefixes[path_index]}{number:05d}'
    lesson['source'] = {'kind':'book', 'title':title or STUDY_PATHS[path_index]['title'], 'problem':f'第一单元第{number:03d}题' if old else f'第{number}题'}
    if concept:
        lesson['concept'] = concept
    return lesson


class StudyPathTest(unittest.TestCase):
    def setUp(self):
        self.base = curriculum.get_lesson('escape-1-1')
        self.first = [book(0,n) for n in (241,307,780)]
        self.second = [book(1,264,old=True),book(1,265,title='手筋专项训练 从10级到5级'),book(1,420),book(1,422),book(1,768)]
        self.third = [book(2,n) for n in (1,528)]
        self.extra = [curriculum.get_lesson(i) for i in ('ggg-easy-140','ggg-intermediate-01')]
        self.lessons = [*self.extra,self.base,curriculum.get_lesson('capture-1-1'),*reversed(self.third),*reversed(self.second),*reversed(self.first)]
        self.store = dict(schema=2,revision=0,active_profile_id='parent',matches={},profiles={'parent':server.make_profile('parent','parent')})
        self.profile = self.store['profiles']['parent']
        self.profile['practice_mode'] = 'sequential'
        self.patches = [patch.object(curriculum,'_CATALOG',copy.deepcopy(self.lessons)),patch.object(curriculum,'_BY_ID',{l['id']:copy.deepcopy(l) for l in self.lessons})]
        for p in self.patches:p.start();self.addCleanup(p.stop)

    def complete(self, lessons):
        self.profile['attempts'].extend(dict(lesson_id=l['id'],correct=True,assisted=False,attempt_no=1) for l in lessons)

    def test_title_aliases_and_original_ids_are_preserved(self):
        original=copy.deepcopy(self.second)
        self.assertEqual(study_path(self.second[0])['id'],study_path(self.second[1])['id'])
        self.assertEqual(study_path(self.second[0])['chapter'],'实战常形')
        self.assertEqual(study_path(self.second[1])['chapter'],'综合运用')
        self.assertEqual(curriculum.sequential_collection(self.second[0]),curriculum.sequential_collection(self.second[1]))
        self.assertEqual(self.second,original)

    def test_complete_264_continues_265_and_skips_quarantined_421(self):
        self.complete(self.second[:1])
        progress=server.practice_progress(self.profile,self.second[0]['id'],True)
        self.assertEqual((progress['total'],progress['completed'],progress['next_id']),(5,1,self.second[1]['id']))
        self.complete(self.second[1:3])
        self.assertEqual(server.practice_progress(self.profile,self.second[2]['id'],True)['next_id'],self.second[3]['id'])

    def test_main_order_crosses_books_and_optional_supplement_is_excluded(self):
        progress=server.practice_progress(self.profile,self.base['id'],True)
        self.assertEqual((progress['path_title'],progress['next_id'],progress['total']),('三书主线',self.first[0]['id'],3))
        self.complete(self.first)
        progress=server.practice_progress(self.profile,self.first[-1]['id'],True)
        self.assertEqual(progress['next_id'],self.second[0]['id'])
        self.assertEqual(progress['next_book_title'],STUDY_PATHS[1]['title'])
        self.complete(self.second)
        self.assertEqual(server.practice_progress(self.profile,self.second[-1]['id'],True)['next_id'],self.third[0]['id'])

    def test_manual_book_entry_stays_in_selected_main_book(self):
        progress=server.practice_progress(self.profile,self.second[0]['id'],True)
        self.assertEqual(progress['study_path']['id'],'intermediate-tesuji')
        self.assertEqual(progress['next_id'],self.second[1]['id'])
        progress=server.practice_progress(self.profile,self.second[1]['id'],True)
        self.assertEqual(progress['chapter'],'综合运用')

    def test_failed_then_successful_or_assisted_completed_not_reassigned(self):
        lesson=self.first[0]
        self.profile['attempts']=[dict(lesson_id=lesson['id'],correct=False,assisted=False,attempt_no=1),dict(lesson_id=lesson['id'],correct=True,assisted=True,attempt_no=2)]
        before=copy.deepcopy(self.profile['attempts'])
        choice=curriculum.recommend(self.profile['attempts'],self.base['id'])
        self.assertEqual(choice['id'],self.first[1]['id'])
        self.assertEqual(curriculum.learning(self.profile['attempts'])['independent_correct'],0)
        self.assertEqual(server.practice_progress(self.profile)['completed'],1)
        self.assertEqual(self.profile['attempts'],before)

    def test_main_completion_stops_both_modes_without_extra_jump(self):
        self.complete([*self.first,*self.second,*self.third])
        server.apply_store(self.store,dict(type='lesson',id=self.third[-1]['id']))
        before=copy.deepcopy(self.profile['attempts'])
        for mode in ('sequential','recommended'):
            self.profile['practice_mode']=mode
            self.assertIsNone(curriculum.recommend(self.profile['attempts'],self.third[-1]['id']))
            progress=server.practice_progress(self.profile,self.third[-1]['id'],True)
            self.assertTrue(progress['main_path_complete']);self.assertIsNone(progress['next_id'])
            server.apply_store(self.store,dict(type='next_lesson'))
            self.assertEqual(self.profile['state']['lesson']['id'],self.third[-1]['id'])
            self.assertIn('三书主线已完成',self.profile['state']['message'])
        self.assertEqual(self.profile['attempts'],before)

    def test_explicit_extra_stays_in_extra_in_both_modes(self):
        for mode in ('recommended','sequential'):
            self.profile['practice_mode']=mode
            progress=server.practice_progress(self.profile,self.extra[0]['id'],True)
            self.assertEqual((progress['path_title'],progress['next_id']),('自选拓展',self.extra[1]['id']))
            self.assertEqual(curriculum.recommend([],self.extra[0]['id'])['id'],self.extra[1]['id'])

    def test_completed_extra_uses_its_own_completion_message(self):
        self.complete([*self.first,*self.second,*self.third,*self.extra])
        server.apply_store(self.store,dict(type='lesson',id=self.extra[-1]['id']))
        server.apply_store(self.store,dict(type='next_lesson'))
        self.assertIn('Go Game Guru',self.profile['state']['message'])
        self.assertNotIn('三书主线已完成',self.profile['state']['message'])

    def test_public_lesson_state_and_recommendation_have_same_metadata(self):
        lesson=self.second[1];snapshot=copy.deepcopy(lesson)
        server.apply_store(self.store,dict(type='lesson',id=lesson['id']))
        with patch.object(server,'engine_info',return_value={}):visible=server.public_store(self.store)
        public=server.lesson_public(lesson)
        self.assertEqual(public['study_path'],visible['lesson']['study_path'])
        self.assertEqual(visible['practice_progress']['study_path']['id'],'intermediate-tesuji')
        self.assertEqual(visible['learning']['recommendation']['study_path']['id'],'intermediate-tesuji')
        for k in ('tree','objective','answer'):self.assertNotIn(k,public)
        spoof=dict(lesson,study_path={'id':'untrusted'})
        self.assertEqual(server.lesson_public(spoof)['study_path'],public['study_path'])
        self.assertEqual(lesson,snapshot)

    def test_review_keeps_old_completed_and_helped_semantics(self):
        self.profile['practice_mode']='review'
        self.profile['helped_lesson_ids']=[self.base['id']]
        progress=server.practice_progress(self.profile,self.first[0]['id'],True)
        self.assertNotIn('study_path',progress)
        self.assertEqual(progress['next_id'],self.base['id'])

    def test_no_three_book_data_keeps_legacy_sequence(self):
        with patch.object(curriculum,'_CATALOG',[self.base,*self.extra]):
            self.assertIsNone(study_scope([self.base,*self.extra],self.base['id']))
            progress=server.practice_progress(self.profile,self.base['id'],True)
            self.assertEqual(progress['total'],1);self.assertNotIn('study_path',progress)
            progress=server.practice_progress(self.profile,self.extra[0]['id'],True)
            self.assertEqual(progress['next_id'],self.extra[1]['id'])
            self.assertEqual(progress['book_title'],'Go Game Guru Weekly Go Problems')

    def test_unrelated_private_book_keeps_own_sequence(self):
        custom=book(0,1,title='其他私用书');custom['id']='unrelated-book-1'
        with patch.object(curriculum,'_CATALOG',self.lessons+[custom]):
            self.assertIsNone(study_scope(self.lessons+[custom],custom['id']))
            p=server.practice_progress(self.profile,custom['id'],True)
            self.assertEqual((p['total'],p['book_title']),(1,'其他私用书'))

    def test_original_prefixes_and_supplement_chapter_mapping(self):
        for identity in ('tactic-net','original-l3-01','original-diverse-edge-turn'):
            l=dict(self.base,id=identity,source={'kind':'original'},concept='net')
            self.assertEqual(study_path(l)['role'],'supplement')
            self.assertEqual(study_path(l)['chapter'],'枷吃')
        l=dict(self.base,id='original-diverse-edge-turn',source={'kind':'original'},concept='edge_chase')
        self.assertEqual(study_path(l)['chapter'],'吃一线子')


if __name__ == '__main__':unittest.main()
