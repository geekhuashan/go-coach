import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import llm_client as llm


class LLMClientTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'GO_COACH_DATA_DIR':self.tmp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)

    def settings(self,**kwargs):
        data=dict(base_url='http://localhost:1234/v1',model='test',api_key='TOP_SECRET',enabled=True)
        data.update(kwargs)
        return llm.save_settings(data)

    def response(self,content='这块黑棋有两口气。你能指出它们吗？'):
        return io.BytesIO(json.dumps({'choices':[{'message':{'content':content}}]},ensure_ascii=False).encode())

    def test_defaults_and_private_atomic_settings(self):
        self.assertFalse(llm.settings_public()['enabled'])
        result=self.settings()
        self.assertTrue(result['has_api_key'])
        self.assertNotIn('TOP_SECRET',json.dumps(result))
        file=Path(self.tmp.name)/'llm-settings.json'
        self.assertEqual(file.stat().st_mode & 0o777,0o600)
        llm.save_settings({'api_key':''})
        self.assertTrue(llm.settings_public()['has_api_key'])
        llm.save_settings({'clear_api_key':True})
        self.assertFalse(llm.settings_public()['has_api_key'])

    def test_url_normalization_and_key_destination_binding(self):
        result=self.settings(base_url='http://localhost:1234/v1/chat/completions/')
        self.assertEqual(result['base_url'],'http://localhost:1234/v1')
        llm.save_settings({'base_url':'https://another.example/v1'})
        self.assertFalse(llm.settings_public()['has_api_key'])
        self.assertEqual(llm._url('https://example.com'), 'https://example.com/v1')
        for url in ('ftp://example.com','https://user:pass@example.com/v1','https://example.com/v1?q=1','https://example.com/v1#part'):
            with self.assertRaises(llm.LLMError):llm.save_settings({'base_url':url})
        with self.assertRaises(llm.LLMError):llm.save_settings({'model':'a'*257})
        with self.assertRaises(llm.LLMError):llm.save_settings({'api_key':'a'*4097})

    def test_test_connection_minimal_payload_and_chinese_text_parts(self):
        self.settings()
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.return_value=self.response([{'type':'text','text':'可以。'}])
            self.assertTrue(llm.test_connection()['ok'])
            args,kwargs=factory.return_value.open.call_args
            self.assertEqual(kwargs['timeout'],20)
            request=args[0]
            self.assertEqual(request.full_url,'http://localhost:1234/v1/chat/completions')
            body=json.loads(request.data)
            self.assertEqual(body['max_tokens'],32)
            self.assertEqual(body['messages'],[{'role':'user','content':'请只回复 OK。'}])
            self.assertNotIn('board',body)

    def test_safe_error_does_not_echo_remote_body(self):
        self.settings()
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.side_effect=HTTPError('secret-url',401,'TOP_SECRET',{},io.BytesIO(b'TOP_SECRET'))
            result=llm.test_connection()
            self.assertFalse(result['ok'])
            self.assertIn('401',result['message'])
            self.assertNotIn('TOP_SECRET',json.dumps(result))
            self.assertNotIn('secret-url',json.dumps(result))

    def test_explain_privacy_revision_and_disabled_gate(self):
        state={'board':[[0]*9 for _ in range(9)],'revision':17,'to_play':1,'last_move':{'x':3,'y':5,'color':1,'profile_name':'PRIVATE'},'profile':{'name':'PRIVATE_CHILD'},'notes':['PRIVATE_NOTE'],'history':['PRIVATE_HISTORY'],'assessment':{'correct':True,'summary':'已解除打吃','notes':'PRIVATE_NOTE'}}
        state.update(moves=[{'x':i,'y':0,'color':1,'name':'PRIVATE_PLAYER'} for i in range(5)], match={'human_color':1,'human_name':'PRIVATE_PLAYER'},last_human_assessment={'summary':'人类上一手连接了黑棋','explanation':'上下左右相连','profile':'PRIVATE_PROFILE'},engine_analysis={'rootInfo':{'scoreLead':1.2,'name':'PRIVATE_ROOT'},'moveInfos':[{'move':'D3','scoreLead':1.5,'pv':['D3','E3','D4','E4','F4','G4','H4'],'player':'PRIVATE_PLAYER'}], 'private':'PRIVATE_ANALYSIS'})
        learning={'skills':[{'id':'escape','stage':'待评估','independent_attempts':1,'name':'PRIVATE_NAME'}],'name':'PRIVATE_NAME'}
        with self.assertRaises(llm.LLMError):llm.explain(state,learning)
        self.settings()
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.return_value=self.response()
            result=llm.explain(state,learning,'为什么这里能救棋？')
            self.assertEqual(result['revision'],17)
            self.assertEqual(result['source'],'llm')
            self.assertIn('两口气',result['text'])
            request=factory.return_value.open.call_args.args[0]
            self.assertNotIn('PRIVATE',request.data.decode())
            self.assertNotIn('TOP_SECRET',request.data.decode())
            body=json.loads(request.data)
            sent=json.loads(body['messages'][1]['content'])
            self.assertEqual(sent['board'],state['board'])
            self.assertEqual(sent['last_move'],{'x':3,'y':5,'color':1})
            self.assertEqual(sent['rule_facts']['summary'],'已解除打吃')
            self.assertEqual(len(sent['recent_moves']),4)
            self.assertEqual(sent['recent_moves'][0],{'x':1,'y':0,'color':1})
            self.assertEqual(sent['human_color'],1)
            self.assertEqual(sent['last_human_assessment']['summary'],'人类上一手连接了黑棋')
            self.assertEqual(sent['engine_estimates']['scoreLead'],1.2)
            self.assertEqual(len(sent['engine_estimates']['moves'][0]['pv']),6)
            self.assertTrue(sent['engine_estimates']['estimated'])

    def test_nineteen_board_coordinate_contract(self):
        self.settings()
        state={'board':[[0]*19 for _ in range(19)],'to_play':1,'revision':1}
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.return_value=self.response()
            llm.explain(state,{})
            body=json.loads(factory.return_value.open.call_args.args[0].data)
            sent=json.loads(body['messages'][1]['content'])
            self.assertEqual(sent['size'],19)
            self.assertIn('A19',sent['coordinates'])
            self.assertIn('ABCDEFGHJKLMNOPQRST',sent['coordinates'])

    def test_no_key_gateway_and_empty_config(self):
        result=llm.test_connection()
        self.assertFalse(result['ok'])
        self.assertIn('地址与模型',result['message'])
        self.settings(api_key='')
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.return_value=self.response()
            self.assertTrue(llm.test_connection()['ok'])
            request=factory.return_value.open.call_args.args[0]
            self.assertIsNone(request.get_header('Authorization'))

    def test_redirects_not_followed_and_key_echo_redacted(self):
        self.assertIsNone(llm._NoRedirect().redirect_request(None,None,302,'',{},'http://evil'))
        self.settings()
        with patch.object(llm,'build_opener') as factory:
            factory.return_value.open.return_value=self.response('TOP_SECRET')
            text=llm._request(llm._read(),[],32)
            self.assertNotIn('TOP_SECRET',text)


if __name__=='__main__':unittest.main()
