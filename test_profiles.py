import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import server


class ProfilesHTTPTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old_store,self.old_state=server.STORE,server.STATE
        self.patches=[patch.object(server,'FILE',Path(self.tmp.name)/'state.json'),patch.object(server,'PROFILE_FILE',Path(self.tmp.name)/'profiles.json'),patch.object(server,'engine_info',lambda:{'available':False})]
        for p in self.patches:p.start()
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join()
        server.STORE,server.STATE=self.old_store,self.old_state
        for p in self.patches[::-1]:p.stop()
        self.tmp.cleanup()
    def request(self,method,url,payload=None):
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request(method,url,None if payload is None else json.dumps(payload),{'Content-Type':'application/json'})
        r=c.getresponse();result=(r.status,json.loads(r.read()));c.close();return result
    def state(self):return self.request('GET','/api/state')[1]
    def action(self,kind,**kwargs):
        code,result=self.request('POST','/api/action',dict(type=kind,revision=self.state()['revision'],**kwargs))
        self.assertEqual(code,200,result);return result
    def test_profile_isolation_reload_and_stale_revision(self):
        p=self.action('play',x=3,y=6)
        self.assertTrue(p['assessment']['correct']);self.assertEqual(len(p['recent_attempts']),1)
        self.action('feedback',text='我理解连起来共享气')
        old=self.state()['revision']
        child=self.action('switch_profile',profile_id='child')
        self.assertEqual(child['profile']['name'],'宝宝');self.assertEqual(child['recent_attempts'],[])
        self.assertEqual(child['feedback'],[]);self.assertEqual(child['board'][6][3],0)
        code,_=self.request('POST','/api/action',{'type':'play','x':0,'y':0,'revision':old})
        self.assertEqual(code,409)
        self.action('play',x=0,y=0)
        server.STORE=server.load_store();server.STATE=server.active_state(server.STORE)
        restored=self.action('switch_profile',profile_id='parent')
        self.assertEqual(restored['board'][6][3],1)
        self.assertEqual(len(restored['feedback']),1)
        self.assertEqual(restored['recent_attempts'][0]['profile_id'],'parent')
    def test_retry_undo_new_keep_attempts_and_notes(self):
        self.action('hint');self.action('retry');first=self.action('play',x=3,y=6)
        self.assertTrue(first['recent_attempts'][0]['assisted'])
        self.action('feedback',text='再练一遍')
        self.action('retry');second=self.action('play',x=3,y=6)
        self.assertEqual(second['recent_attempts'][0]['attempt_no'],2)
        self.assertEqual(second['learning']['independent_correct'],0)
        self.action('undo');third=self.action('play',x=3,y=6)
        self.assertEqual(third['recent_attempts'][0]['attempt_no'],3)
        new=self.action('new');self.assertEqual(len(new['recent_attempts']),3)
        self.assertEqual(len(new['feedback']),1)
        self.action('lesson',id='capture');self.assertEqual(len(self.state()['feedback']),1)
    def test_inspect_assistance_and_new_profile(self):
        self.action('inspect',x=3,y=5);s=self.action('play',x=3,y=6)
        self.assertTrue(s['recent_attempts'][0]['assisted'])
        learner=self.action('add_profile',name='妈妈')
        self.assertEqual(learner['profile']['name'],'妈妈');self.assertEqual(len(learner['profiles']),3)
        self.assertEqual(learner['recent_attempts'],[])
    def test_lessons_redacted_and_next_recommended(self):
        code,lessons=self.request('GET','/api/lessons')
        self.assertEqual(code,200);self.assertGreater(len(lessons),3)
        self.assertNotIn('objective',json.dumps(lessons))
        self.assertNotIn('objective',json.dumps(self.state()))
        s=self.action('next_lesson');self.assertEqual(s['mode'],'lesson')
    def test_migration_preserves_original_without_grading(self):
        old=server.lesson_state('escape',17)
        server.apply(old,{'type':'play','x':3,'y':6})
        server.FILE.write_text(json.dumps(old))
        data=server.load_store();self.assertEqual(data['profiles']['parent']['attempts'],[])
        self.assertEqual(data['profiles']['parent']['state']['board'][6][3],1)
        server.save(data)
        self.assertEqual(json.loads(server.FILE.read_text()),old)
        self.assertTrue(server.FILE.with_name('state.pre-profiles.json').exists())
        self.assertEqual(server.load_store()['revision'],17)

if __name__=='__main__':unittest.main()
