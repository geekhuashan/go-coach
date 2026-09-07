import copy
import http.client
import threading
import unittest
from unittest.mock import patch
import server
import test_profiles


class MatchesTest(unittest.TestCase):
    setUp=test_profiles.ProfilesHTTPTest.setUp
    tearDown=test_profiles.ProfilesHTTPTest.tearDown
    request=test_profiles.ProfilesHTTPTest.request
    state=test_profiles.ProfilesHTTPTest.state
    action=test_profiles.ProfilesHTTPTest.action

    def test_human_black_auto_turn_and_feedback(self):
        s=self.action('new',match_mode='human_ai',human_color=1)
        self.assertFalse(s['computer_turn'])
        s=self.action('play',x=0,y=0);human=copy.deepcopy(s['last_human_assessment'])
        self.assertTrue(s['computer_turn'])
        code,_=self.request('POST','/api/action',{'type':'play','revision':s['revision'],'x':1,'y':1})
        self.assertEqual(code,400)
        with patch('engine.choose_move',return_value={'x':2,'y':2}):s=self.action('ai_move')
        self.assertFalse(s['computer_turn']);self.assertEqual(s['move_number'],2)
        self.assertEqual(s['last_human_assessment'],human)
        self.assertEqual(s['recent_attempts'],[])
        s=self.action('undo');self.assertEqual(s['move_number'],0);self.assertFalse(s['computer_turn'])
        self.action('play',x=1,y=1);s=self.action('undo')
        self.assertEqual(s['move_number'],0)

    def test_human_white_initial_turn_and_undo(self):
        s=self.action('new',match_mode='human_ai',human_color=2)
        self.assertTrue(s['computer_turn'])
        with patch('engine.choose_move',return_value={'x':0,'y':0}):s=self.action('ai_move')
        self.assertEqual(s['to_play'],2)
        code,_=self.request('POST','/api/action',{'type':'undo','revision':s['revision']})
        self.assertEqual(code,400)
        self.action('play',x=1,y=1)
        with patch('engine.choose_move',return_value={'x':2,'y':2}):self.action('ai_move')
        s=self.action('undo');self.assertEqual(s['move_number'],1);self.assertEqual(s['to_play'],2)

    def test_two_player_shared_history_and_latest_restore(self):
        self.action('feedback',text='我的私人想法')
        s=self.action('new',match_mode='two_player',black_profile_id='parent',white_profile_id='child')
        identity=s['match_id'];self.action('play',x=0,y=0)
        child=self.action('switch_profile',profile_id='child')
        self.assertEqual(child['mode'],'lesson');self.assertEqual(child['recent_matches'][0]['id'],identity)
        self.action('resume_match',match_id=identity);self.action('play',x=1,y=1)
        p=self.action('switch_profile',profile_id='parent')
        self.assertEqual(p['move_number'],2);self.assertEqual(p['board'][1][1],2)
        self.assertEqual(len(p['feedback']),1)
        self.assertEqual(p['recent_attempts'],[])
        with patch('engine.choose_move') as choose:
            code,_=self.request('POST','/api/action',{'type':'ai_move','revision':p['revision']})
            self.assertEqual(code,400);choose.assert_not_called()
        s=self.action('undo');self.assertEqual(s['move_number'],1)
        self.action('new');self.assertGreaterEqual(len(self.state()['recent_matches']),2)
        code,records=self.request('GET','/api/matches');self.assertEqual(code,200)
        record=next(r for r in records if r['id']==identity)
        self.assertEqual(record['move_number'],1)
        self.assertNotIn('我的私人想法',str(record))
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        s=self.action('resume_match',match_id=identity);self.assertEqual(s['move_number'],1)
        self.action('add_profile',name='第三人')
        code,_=self.request('POST','/api/action',{'type':'resume_match','revision':self.state()['revision'],'match_id':identity})
        self.assertEqual(code,400)

    def test_two_passes_and_historical_sgf(self):
        s=self.action('new',match_mode='two_player');identity=s['match_id']
        self.action('play',x=0,y=0);self.action('pass');s=self.action('pass')
        self.assertTrue(s['ended']);self.assertIn('不自动',s['message'])
        self.action('new')
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request('GET','/api/sgf?match_id='+identity);r=c.getresponse();data=r.read().decode();c.close()
        self.assertEqual(r.status,200);self.assertIn(';B[aa];W[];B[]',data)

    def test_parallel_ai_requests_only_one_commits(self):
        self.action('new',match_mode='human_ai');s=self.action('play',x=0,y=0)
        barrier=threading.Barrier(2)
        def choose(_):barrier.wait(timeout=5);return {'x':1,'y':1}
        results=[]
        def request():results.append(self.request('POST','/api/action',{'type':'ai_move','revision':s['revision']})[0])
        with patch('engine.choose_move',side_effect=choose):
            threads=[threading.Thread(target=request) for _ in range(2)]
            for t in threads:t.start()
            for t in threads:t.join(timeout=10)
        self.assertEqual(sorted(results),[200,409]);self.assertEqual(self.state()['move_number'],2)

if __name__=='__main__':unittest.main()
