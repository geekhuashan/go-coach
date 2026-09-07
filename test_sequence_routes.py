import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import curriculum
import server
import test_profiles


class SequenceRoutesTest(unittest.TestCase):
    request=test_profiles.ProfilesHTTPTest.request
    state=test_profiles.ProfilesHTTPTest.state
    action=test_profiles.ProfilesHTTPTest.action

    def setUp(self):
        test_profiles.ProfilesHTTPTest.setUp(self)
        self.bank=[l for l in curriculum.catalog() if l.get('sequence')]
        self.extra=[patch.object(server,'IMPORT_FILE',Path(self.tmp.name)/'imported-lessons.json'),
                    patch.object(curriculum,'_CATALOG',copy.deepcopy(curriculum._CATALOG)),
                    patch.object(curriculum,'_BY_ID',copy.deepcopy(curriculum._BY_ID))]
        for p in self.extra:p.start()

    def tearDown(self):
        for p in self.extra[::-1]:p.stop()
        test_profiles.ProfilesHTTPTest.tearDown(self)

    def finish(self):
        for _ in range(100):
            s=self.state()
            if s['lesson_attempted']:return s
            node=server.sequence_node(server.STATE)
            x,y=node['children'][0]['move']
            self.action('play',x=x,y=y)
        self.fail('sequence did not terminate')

    def test_intermediate_auto_reply_terminal_grade_and_profile_restore(self):
        lesson=self.bank[0]
        s=self.action('lesson',id=lesson['id'])
        x,y=lesson['tree']['children'][0]['move']
        s=self.action('play',x=x,y=y)
        self.assertEqual(s['move_number'],2)
        self.assertFalse(s['lesson_attempted'])
        self.assertIsNone(s['assessment']['correct'])
        self.assertEqual(s['recent_attempts'],[])
        self.assertEqual(s['to_play'],s['initial_player'])
        self.action('switch_profile',profile_id='child')
        self.assertEqual(self.state()['recent_attempts'],[])
        self.action('switch_profile',profile_id='parent')
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        self.assertEqual(self.state()['move_number'],2)
        s=self.finish()
        self.assertTrue(s['assessment']['correct'])
        self.assertEqual(s['lesson_progress']['status'],'solved')
        self.assertEqual(len(s['recent_attempts']),1)
        self.assertFalse(s['recent_attempts'][0]['assisted'])
        code,_=self.request('POST','/api/action',dict(type='play',x=8,y=8,revision=s['revision']))
        self.assertEqual(code,400)

    def test_unlisted_legal_move_is_unrated_and_retry_not_independent(self):
        lesson=self.bank[0];self.action('lesson',id=lesson['id'])
        known={tuple(n['move']) for n in lesson['tree']['children']}
        for y in range(9):
            for x in range(9):
                if (x,y) in known:continue
                try:server.play(server.STATE['board'],x,y,lesson['to_play'])
                except ValueError:continue
                s=self.action('play',x=x,y=y)
                self.assertEqual(s['lesson_progress']['status'],'unlisted')
                self.assertIsNone(s['assessment']['correct'])
                self.assertEqual(s['recent_attempts'],[])
                self.action('retry');s=self.finish()
                self.assertTrue(s['recent_attempts'][0]['assisted'])
                self.assertEqual(s['learning']['independent_attempts'],0)
                return
        self.fail('no legal alternative')

    def test_pair_undo_and_retry_preserve_assistance(self):
        lesson=self.bank[0];initial=self.action('lesson',id=lesson['id'])
        x,y=lesson['tree']['children'][0]['move']
        self.action('play',x=x,y=y)
        s=self.action('undo')
        self.assertEqual(s['board'],initial['board'])
        self.assertEqual(s['move_number'],0)
        self.assertEqual(s['to_play'],lesson['to_play'])
        self.assertTrue(s['assisted'])
        self.action('retry');s=self.finish()
        self.assertTrue(s['recent_attempts'][0]['assisted'])

    def test_every_authored_lesson_executes_and_retry_cycles_branches(self):
        branched=False
        for lesson in self.bank:
            replies=[]
            for seed in range(3):
                s=self.action('lesson',id=lesson['id']) if seed==0 else self.action('retry')
                x,y=lesson['tree']['children'][0]['move']
                s=self.action('play',x=x,y=y)
                if len(s['moves'])>1:replies.append((s['moves'][1]['x'],s['moves'][1]['y']))
                s=self.finish()
                self.assertTrue(s['assessment']['correct'],lesson['id'])
            branched=branched or len(set(replies))>1
        self.assertTrue(branched,'no variable opponent replies')

    def test_abandon_to_match_then_return_is_not_first_independent(self):
        lesson=self.bank[0];self.action('lesson',id=lesson['id'])
        x,y=lesson['tree']['children'][0]['move']
        self.action('play',x=x,y=y)
        self.action('new',match_mode='two_player')
        self.action('lesson',id=lesson['id'])
        s=self.finish()
        self.assertTrue(s['recent_attempts'][0]['assisted'])

    def test_nineteen_board_corners_sgf_shared_match_and_import(self):
        s=self.action('new',match_mode='two_player',size=19)
        self.assertEqual(len(s['board']),19)
        s=self.action('play',x=18,y=18)
        self.assertIn('T1',s['assessment']['explanation'])
        self.action('play',x=18,y=0)
        s=self.action('inspect',x=18,y=0)
        self.assertEqual(len(s['inspection']['liberties']),2)
        sgf=server.export_sgf(server.STATE)
        self.assertIn('SZ[19]',sgf);self.assertIn(';B[ss];W[sa]',sgf)
        match=s['match']['id']
        self.action('switch_profile',profile_id='child')
        s=self.action('resume_match',match_id=match)
        self.assertEqual(s['size'],19);self.assertEqual(s['board'][0][18],2)
        self.action('undo');self.assertEqual(self.state()['board'][0][18],0)
        import test_tactics
        lesson=test_tactics.TacticsTests().corner_19(attacker=2)
        lesson['id']='nineteen-book'
        code,r=self.request('POST','/api/lessons/import',{'lesson':lesson,'revision':self.state()['revision']})
        self.assertEqual(code,200,r)
        s=self.action('lesson',id=lesson['id']);self.assertEqual(s['size'],19)
        s=self.action('play',x=18,y=17)
        self.assertTrue(s['assessment']['correct']);self.assertEqual(s['board'][18][18],0)
        self.assertEqual(s['captures']['white'],1)
        s=self.action('retry');self.assertEqual(s['size'],19);self.assertEqual(s['board'][18][18],1)
        self.assertEqual(s['to_play'],2)
        s=self.action('setup',size=19,stones=lesson['stones'],to_play=2)
        self.assertEqual(s['size'],19)
        self.action('annotate',marks=[{'x':18,'y':18,'label':'目标'}])
        self.action('play',x=18,y=17)
        self.assertEqual(self.state()['board'][18][18],0)
        current=self.state()
        code,_=self.request('POST','/api/action',{'type':'new','size':13,'revision':current['revision']})
        self.assertEqual(code,400);self.assertEqual(self.state()['board'],current['board'])

    def test_import_persistence_validation_duplicate_and_redaction(self):
        lesson=copy.deepcopy(self.bank[0]);lesson['id']='book-test-import'
        lesson['source']={'kind':'book','title':'本地测试题','page':'12','problem':'3'}
        before=self.state()
        code,r=self.request('POST','/api/lessons/import',{'lesson':lesson,'revision':before['revision']})
        self.assertEqual(code,200,r)
        self.assertNotIn('tree',json.dumps(r))
        self.assertEqual(self.state()['board'],before['board'])
        self.assertEqual(len(json.loads(server.IMPORT_FILE.read_text())),1)
        code,_=self.request('POST','/api/lessons/import',{'lesson':lesson,'revision':self.state()['revision']})
        self.assertEqual(code,400)
        broken=copy.deepcopy(lesson);broken['id']='broken-import';broken['tree']['children'][0]['move']=[99,0]
        code,_=self.request('POST','/api/lessons/import',{'lesson':broken,'revision':self.state()['revision']})
        self.assertEqual(code,400)
        self.assertEqual(len(json.loads(server.IMPORT_FILE.read_text())),1)
        self.action('lesson',id=lesson['id']);self.finish()
        serialized=json.dumps(self.state())
        self.assertNotIn('"tree"',serialized)
        self.assertNotIn('"objective"',serialized)
        self.assertNotIn('"_branch_seed"',serialized)
        curriculum._CATALOG=[l for l in curriculum._CATALOG if l['id']!=lesson['id']]
        del curriculum._BY_ID[lesson['id']]
        self.assertEqual(curriculum.load_imports(server.IMPORT_FILE),1)
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        self.assertEqual(self.state()['lesson']['source']['page'],'12')
        self.assertEqual(self.state()['lesson_progress']['status'],'solved')
        self.assertTrue(self.state()['recent_attempts'][0]['correct'])

if __name__=='__main__':unittest.main()
