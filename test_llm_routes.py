import copy
import http.client
import json
import threading
import types
import unittest
from unittest.mock import Mock, patch
import server
import test_profiles


class LLMRoutesTest(unittest.TestCase):
    request=test_profiles.ProfilesHTTPTest.request
    state=test_profiles.ProfilesHTTPTest.state
    action=test_profiles.ProfilesHTTPTest.action
    def setUp(self):
        test_profiles.ProfilesHTTPTest.setUp(self)
        self.client=types.SimpleNamespace(settings_public=Mock(return_value={'enabled':False,'has_api_key':True,'model':'test'}),save_settings=Mock(),test_connection=Mock(return_value={'ok':True}),explain=Mock(return_value={'text':'这块黑棋共享三口气。','source':'llm','model':'test'}))
        self.client_patch=patch.dict('sys.modules',{'llm_client':self.client});self.client_patch.start()
    def tearDown(self):
        self.client_patch.stop();test_profiles.ProfilesHTTPTest.tearDown(self)
    def test_settings_and_ping_do_not_change_board(self):
        revision=self.state()['revision']
        code,result=self.request('GET','/api/llm/settings');self.assertEqual(code,200)
        self.assertNotIn('api_key',result)
        code,result=self.request('POST','/api/llm/settings',{'api_key':'YOUR_API_KEY','enabled':False})
        self.assertEqual(code,200);self.assertNotIn('YOUR_API_KEY',json.dumps(result))
        self.client.save_settings.assert_called_once()
        code,result=self.request('POST','/api/llm/test',{});self.assertEqual(code,200)
        self.client.test_connection.assert_called_once_with()
        self.client.explain.assert_not_called()
        self.assertEqual(self.state()['revision'],revision)
    def test_explanation_persists_and_context_survives_profile_switch(self):
        self.action('play',x=3,y=6);s=self.state();revision=s['revision']
        code,result=self.request('POST','/api/llm/explain',{'revision':revision,'question':'为什么要连起来？'})
        self.assertEqual(code,200);self.assertFalse(result['stale']);self.assertEqual(result['profile_id'],'parent')
        self.assertEqual(self.state()['revision'],revision)
        self.assertEqual(self.state()['llm_explanation']['text'],result['text'])
        self.action('switch_profile',profile_id='child');self.assertIsNone(self.state()['llm_explanation'])
        self.action('switch_profile',profile_id='parent');self.assertEqual(self.state()['llm_explanation']['text'],result['text'])
        self.action('retry');self.assertIsNone(self.state()['llm_explanation'])
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        code,history=self.request('GET','/api/history?profile_id=parent')
        self.assertEqual(history['llm_explanations'][0]['question'],'为什么要连起来？')
    def test_slow_explanation_stays_with_original_profile(self):
        entered=threading.Event();release=threading.Event();results=[]
        def slow(*args):
            entered.set();release.wait(timeout=5)
            return {'text':'原局面的讲解','model':'test'}
        self.client.explain.side_effect=slow
        revision=self.state()['revision']
        t=threading.Thread(target=lambda:results.append(self.request('POST','/api/llm/explain',{'revision':revision})));t.start()
        self.assertTrue(entered.wait(timeout=3))
        self.action('switch_profile',profile_id='child');child=self.action('play',x=0,y=0)
        child_revision=child['revision'];board=copy.deepcopy(child['board'])
        release.set();t.join(timeout=5)
        self.assertEqual(results[0][0],200);self.assertTrue(results[0][1]['stale'])
        current=self.state();self.assertEqual(current['profile']['id'],'child')
        self.assertEqual(current['revision'],child_revision);self.assertEqual(current['board'],board)
        self.assertIsNone(current['llm_explanation'])
        parent=self.request('GET','/api/history?profile_id=parent')[1]
        child_history=self.request('GET','/api/history?profile_id=child')[1]
        self.assertEqual(len(parent['llm_explanations']),1);self.assertEqual(child_history['llm_explanations'],[])
    def test_stale_input_security_and_redacted_errors(self):
        revision=self.state()['revision'];self.action('hint')
        code,_=self.request('POST','/api/llm/explain',{'revision':revision});self.assertEqual(code,409)
        self.client.explain.assert_not_called()
        self.client.save_settings.side_effect=ValueError('secret-unit-value')
        code,result=self.request('POST','/api/llm/settings',{})
        self.assertEqual(code,400);self.assertNotIn('secret-unit-value',str(result))
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request('POST','/api/llm/test','{}',{'Content-Type':'application/json','Origin':'https://example.invalid'})
        response=c.getresponse();self.assertEqual(response.status,403);response.read();c.close()
        self.client.test_connection.assert_not_called()

if __name__=='__main__':unittest.main()
