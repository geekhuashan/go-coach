import contextlib
import importlib.util
import io
import json
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from scripts import publish_lesson as publish
from scripts import import_local_progress as progress
import tactics


class TransferScriptsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.lesson=tactics.catalog()[0]
        self.lesson['raw_image']='PHOTO_BYTES_SECRET'
        self.file=self.root/'lesson.json';self.file.write_text(json.dumps(self.lesson))
        self.password=self.root/'password';self.password.write_text('PASSWORD_SENTINEL\n')
        self.requests=[];self.user_agents=[];self.fail_path=None;self.redirect=False;self.mismatch=False;self.omit_profile=False
        self.store={'schema':2,'revision':10,'active_profile_id':'p','profiles':{'p':{'id':'p','name':'测试者','state':{'size':9,'board':[[0]*9 for _ in range(9)],'mode':'lesson','to_play':1,'moves':[]},'attempts':[{'lesson_id':'capture','correct':True,'api_key':'APIKEY_SECRET'}],'notes':[],'helped_lesson_ids':[]}},'matches':{},'llm_settings':{'api_key':'APIKEY_SECRET'},'raw_image':'PHOTO_BYTES_SECRET'}
        self.source=self.root/'profiles.json';self.source.write_text(json.dumps(self.store))
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):self.handle_request()
            def do_POST(self):self.handle_request()
            def handle_request(self):
                raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
                data=json.loads(raw) if raw else None
                outer.requests.append((self.command,self.path,data,self.headers.get('Cookie')))
                outer.user_agents.append(self.headers.get('User-Agent'))
                if outer.redirect and self.path=='/api/login':
                    self.send_response(307);self.send_header('Location','http://example.invalid/leak');self.end_headers();return
                if outer.fail_path==self.path:
                    self.send_response(409);self.end_headers();self.wfile.write(b'PASSWORD_SENTINEL COOKIE_SECRET APIKEY_SECRET');return
                if self.path!='/api/login' and self.headers.get('Cookie')!='session=COOKIE_SECRET':
                    self.send_response(401);self.end_headers();return
                if self.path=='/api/login':result={'ok':True}
                elif self.path=='/api/state':result={'revision':12,'profiles':[{'id':'p'}],**({} if outer.omit_profile else {'profile':{'id':'p'}})}
                elif self.path=='/api/lessons':result=[] if outer.mismatch else [{'id':outer.lesson['id']}]
                elif self.path=='/api/migrate':result={'ok':True,'revision':12,'profiles_count':1,'attempts_count':1,'matches_count':0}
                else:result={'ok':True}
                self.send_response(200)
                if self.path=='/api/login':self.send_header('Set-Cookie','session=COOKIE_SECRET; HttpOnly; Path=/')
                self.end_headers();self.wfile.write(json.dumps(result).encode())
        self.http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.stop)
        self.url=f'http://127.0.0.1:{self.http.server_port}'
    def stop(self):self.http.shutdown();self.http.server_close();self.thread.join()
    def call(self,main,args):
        output=io.StringIO()
        with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):code=main(args)
        for sentinel in ('PASSWORD_SENTINEL','COOKIE_SECRET','APIKEY_SECRET','PHOTO_BYTES_SECRET'):
            self.assertNotIn(sentinel,output.getvalue())
        return code,output.getvalue()
    def publish_args(self):return ['--file',str(self.file),'--url',self.url,'--password-file',str(self.password)]
    def migration_args(self):return ['--source',str(self.source),'--url',self.url,'--password-file',str(self.password)]
    def test_publish_default_and_dry_run_never_network(self):
        for flags in ([],['--dry-run'],['--dry-run','--reviewed']):
            self.assertEqual(self.call(publish.main,self.publish_args()+flags)[0],0)
        self.assertEqual(self.requests,[])
    def test_publish_cookie_revision_and_readback(self):
        self.assertEqual(self.call(publish.main,self.publish_args()+['--reviewed'])[0],0)
        self.assertEqual([r[1] for r in self.requests],['/api/login','/api/state','/api/lessons/import','/api/lessons'])
        payload=self.requests[2][2]
        self.assertEqual(payload['revision'],12)
        self.assertEqual(payload['expected_profile_id'],'p')
        self.assertNotIn('raw_image',payload['lesson'])
        self.assertEqual(self.requests[0][2],{'password':'PASSWORD_SENTINEL'})
        self.assertEqual(set(self.user_agents),{'Go-Coach-CLI/1.0'})
    def test_older_server_without_profile_remains_compatible(self):
        self.omit_profile=True
        self.assertEqual(self.call(publish.main,self.publish_args()+['--reviewed'])[0],0)
        payload=next(r[2] for r in self.requests if r[1]=='/api/lessons/import')
        self.assertNotIn('expected_profile_id',payload)
        self.assertEqual(self.call(progress.main,self.migration_args()+['--apply'])[0],0)
        payload=next(r[2] for r in self.requests if r[1]=='/api/migrate')
        self.assertNotIn('expected_profile_id',payload)

    def test_publish_failure_does_not_echo_remote_response(self):
        self.fail_path='/api/lessons/import'
        code,text=self.call(publish.main,self.publish_args()+['--reviewed'])
        self.assertEqual(code,1);self.assertIn('HTTP 409',text)
    def test_publish_readback_mismatch_is_not_success(self):
        self.mismatch=True
        code,text=self.call(publish.main,self.publish_args()+['--reviewed'])
        self.assertEqual(code,1);self.assertIn('回读未找到',text)
    def test_redirect_never_forwards_credentials(self):
        self.redirect=True
        code,text=self.call(publish.main,self.publish_args()+['--reviewed'])
        self.assertEqual(code,1);self.assertIn('跳转',text)
        self.assertEqual(len(self.requests),1)
    def test_bad_lesson_stops_before_login(self):
        self.lesson['tree']['children']=[];self.file.write_text(json.dumps(self.lesson))
        self.assertEqual(self.call(publish.main,self.publish_args()+['--reviewed'])[0],1)
        self.assertEqual(self.requests,[])
    def test_missing_password_stops_before_network(self):
        self.assertEqual(self.call(publish.main,['--file',str(self.file),'--url',self.url,'--reviewed'])[0],1)
        self.assertEqual(self.requests,[])
    def test_migrate_default_dry_run_keeps_source(self):
        before=self.source.read_bytes()
        self.assertEqual(self.call(progress.main,self.migration_args())[0],0)
        self.assertEqual(self.requests,[]);self.assertEqual(self.source.read_bytes(),before)
    def test_migrate_upload_filters_and_readback(self):
        before=self.source.read_bytes()
        self.assertEqual(self.call(progress.main,self.migration_args()+['--apply'])[0],0)
        payload=next(r[2] for r in self.requests if r[1]=='/api/migrate')
        self.assertEqual(payload['revision'],12)
        self.assertEqual(payload['expected_profile_id'],'p')
        body=json.dumps(payload)
        self.assertNotIn('PHOTO_BYTES_SECRET',body);self.assertNotIn('APIKEY_SECRET',body)
        self.assertEqual(payload['store']['profiles']['p']['attempts'][0]['correct'],True)
        self.assertEqual(set(self.user_agents),{'Go-Coach-CLI/1.0'})
        self.assertEqual(self.source.read_bytes(),before)
    def test_migrate_keeps_licensed_attribution_but_not_book_links(self):
        value=json.loads(json.dumps(self.store))
        value['profiles']['p']['state']['lesson']={'id':'licensed-test','source':{'kind':'licensed','license':'CC BY-NC-SA-4.0','url':'https://example.com/public','author':'Author'}}
        clean=progress.sanitize_store(value)
        self.assertEqual(clean['profiles']['p']['state']['lesson']['source']['license'],'CC BY-NC-SA-4.0')
        value['profiles']['p']['state']['lesson']['source']['kind']='book'
        clean=progress.sanitize_store(value)
        self.assertNotIn('url',clean['profiles']['p']['state']['lesson']['source'])

    def test_migrate_cloud_conflict_no_force_retry(self):
        self.fail_path='/api/migrate'
        code,text=self.call(progress.main,self.migration_args()+['--apply'])
        self.assertEqual(code,1);self.assertIn('409',text)
        self.assertEqual(sum(r[1]=='/api/migrate' for r in self.requests),1)
    def test_migrate_schema_and_board_checks(self):
        for alter in ('schema','board'):
            value=json.loads(json.dumps(self.store))
            if alter=='schema':value['schema']=1
            else:value['profiles']['p']['state']['board']=[[0]]
            self.source.write_text(json.dumps(value))
            self.assertEqual(self.call(progress.main,self.migration_args()+['--apply'])[0],1)
        self.assertEqual(self.requests,[])
    def test_http_remote_and_url_credentials_rejected(self):
        for url in ('http://example.com','https://user:password@example.com','https://example.com/path','https://example.com?key=secret'):
            with self.assertRaises(publish.TransferError):publish.Client(url,self.password)
    def test_optional_lessons_filter_photos(self):
        lessons=self.root/'lessons.json';lessons.write_text(json.dumps([self.lesson]))
        code,_=self.call(progress.main,self.migration_args()+['--apply','--lessons-file',str(lessons)])
        self.assertEqual(code,0)
        payload=next(r[2] for r in self.requests if r[1]=='/api/migrate')
        self.assertEqual(payload['lessons'][0]['id'],self.lesson['id'])
        self.assertNotIn('raw_image',payload['lessons'][0])


if __name__=='__main__':unittest.main()
