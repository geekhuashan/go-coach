"""Bounded forced-root comparison; no engine process, filesystem or network."""
import copy
import io
import json
import queue
import unittest
from unittest.mock import patch, Mock
import engine
from test_engine_sizes import state_for


def review_state(size=9, player=1):
    state=state_for(size)
    state['to_play']=state['initial_player']=player
    state['review']={'candidate':{'x':0,'y':0},'reference':{'x':size-1,'y':size-1}}
    return state


def answer(query, **_):
    point=query['allowMoves'][0]['moves'][0]
    return {'rootInfo':{'visits':128,'scoreLead':2.5,'winrate':.6},
            'moveInfos':[{'move':point,'order':0,'visits':127,'scoreLead':2.4,'pv':[point,'pass']}],
            'ownership':[.25]*(query['boardXSize']*query['boardYSize'])}


class EngineReviewTest(unittest.TestCase):
    def test_two_queries_reuse_before_position_and_keep_black_evidence_for_either_player(self):
        for size in (9,19):
            for player in (1,2):
                state=review_state(size,player);before=copy.deepcopy(state);queries=[]
                def run(query,timeout):
                    self.assertTrue(engine._lock.locked());self.assertGreater(timeout,0);self.assertLessEqual(timeout,6)
                    queries.append(query);return answer(query)
                with patch.object(engine,'_run_query',side_effect=run):result=engine.review(state)
                self.assertEqual(state,before);self.assertEqual(len(queries),2);self.assertFalse(engine._lock.locked())
                self.assertNotEqual(queries[0]['id'],queries[1]['id'])
                for label,query in zip(('candidate','reference'),queries):
                    self.assertEqual(query['moves'],[])
                    self.assertEqual(query['maxVisits'],128);self.assertIs(query['includeOwnership'],True)
                    self.assertEqual(query['overrideSettings'],{'maxTime':3,'reportAnalysisWinratesAs':'BLACK'})
                    point=state['review'][label];coordinate=engine.coordinate(point['x'],point['y'],size)
                    self.assertEqual(query['allowMoves'],[{'player':'B' if player==1 else 'W','moves':[coordinate],'untilDepth':1}])
                    self.assertEqual(result[label]['move'],coordinate);self.assertEqual(result[label]['rootInfo']['visits'],128)
                    self.assertEqual(result[label]['rootInfo']['scoreLead'],2.5)
                    self.assertEqual(result[label]['moves'][0]['pv'],[coordinate,'pass'])
                    self.assertEqual(len(result[label]['ownership']),size*size)
                self.assertEqual(result['revision'],42);self.assertEqual(result['perspective'],'black');self.assertEqual(result['engine'],'KataGo')
                self.assertNotIn('correct',result);self.assertNotIn('verdict',result)
    def test_review_does_not_accept_user_query_overrides_or_change_history(self):
        state=review_state();state['initial_board'][4][4]=1;state['board'][4][4]=1
        state['moves']=[{'color':2,'x':3,'y':3}];state['board'][3][3]=2;state['to_play']=1
        state.update(maxVisits=999999,allowMoves=[{'player':'B','moves':['pass']}],overrideSettings={'maxTime':1000},includeOwnership=False)
        with patch.object(engine,'_run_query',side_effect=answer) as run:engine.review(state)
        for call in run.call_args_list:
            query=call.args[0];self.assertEqual(query['maxVisits'],128);self.assertEqual(query['moves'],[['W','D6']]);self.assertEqual(query['initialStones'],[['B','E5']]);self.assertEqual(query['overrideSettings']['maxTime'],3)
    def test_invalid_pair_fails_before_start_or_first_query(self):
        cases=[None,{},[],{'candidate':{'x':0,'y':0}},
               {'candidate':{'x':0,'y':0},'reference':{'x':1,'y':1},'third':{'x':2,'y':2}}]
        for point in ({'x':9,'y':0},{'x':True,'y':0},{'x':0,'y':None},{'x':0,'y':0,'maxVisits':999}):
            cases.append({'candidate':{'x':0,'y':0},'reference':point})
        with patch.object(engine,'_run_query') as run,patch.object(engine,'_start') as start:
            for value in cases:
                state=review_state();state['review']=value
                with self.subTest(value=value),self.assertRaises(ValueError):engine.review(state)
            state=review_state();state['board'][8][8]=2
            with self.assertRaises(ValueError):engine.review(state)
            start.assert_not_called();run.assert_not_called()
    def test_busy_and_partial_failure_never_return_half_comparison(self):
        busy=Mock();busy.acquire.return_value=False
        with patch.object(engine,'_lock',busy),patch.object(engine,'_run_query') as run:
            with self.assertRaises(RuntimeError):engine.review(review_state())
            run.assert_not_called();busy.acquire.assert_called_once_with(timeout=2);busy.release.assert_not_called()
        with patch.object(engine,'_run_query',side_effect=[answer({'allowMoves':[{'moves':['A9']}],'boardXSize':9,'boardYSize':9}),RuntimeError('timeout')]) as run:
            with self.assertRaises(RuntimeError):engine.review(review_state())
            self.assertEqual(run.call_count,2);self.assertFalse(engine._lock.locked())
    def test_missing_ownership_or_wrong_root_is_not_usable_comparison(self):
        for change in ({'ownership':[]},{'moveInfos':[{'move':'pass'}]},{'rootInfo':None}):
            def run(query,**kwargs):return answer(query)|change
            with patch.object(engine,'_run_query',side_effect=run) as mocked:
                with self.subTest(change=list(change)),self.assertRaises(RuntimeError):engine.review(review_state())
                self.assertEqual(mocked.call_count,1)
    def test_shared_runner_skips_stale_and_partial_responses_and_closes_on_timeout(self):
        output=queue.Queue()
        for result in ({'id':'old','moveInfos':[]},{'id':'current','isDuringSearch':True,'moveInfos':[]},{'id':'current','moveInfos':[{'move':'A9'}]}):output.put(result)
        process=Mock();process.stdin=io.StringIO()
        with patch.object(engine,'_start'),patch.object(engine,'_process',process),patch.object(engine,'_output',output):
            result=engine._run_query({'id':'current'},timeout=1)
            self.assertEqual(result['moveInfos'],[{'move':'A9'}]);self.assertEqual(json.loads(process.stdin.getvalue()),{'id':'current'})
        with patch.object(engine,'_start'),patch.object(engine,'_process',process),patch.object(engine,'_output') as output,patch.object(engine,'close') as close:
            output.get.side_effect=queue.Empty
            with self.assertRaises(RuntimeError):engine._run_query({'id':'current'},timeout=1)
            close.assert_called_once()
