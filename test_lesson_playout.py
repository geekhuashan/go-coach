import unittest

import curriculum
import server
from go_rules import key, play


def legal_point(state, excluded=()):
    blocked=set(excluded)
    seen=[key(state['board'])]+[key(h['board']) for h in state['history']]
    for y in range(state['size']):
        for x in range(state['size']):
            if (x,y) in blocked:
                continue
            try:
                play(state['board'],x,y,state['to_play'],seen)
                return {'x':x,'y':y}
            except ValueError:
                pass
    raise AssertionError('no legal point')


def store_for(lesson_id):
    state=server.lesson_state(lesson_id,0)
    profile=server.make_profile('parent','我',state)
    return {'schema':2,'revision':0,'active_profile_id':'parent','profiles':{'parent':profile},'matches':{}}


class LessonPlayoutTest(unittest.TestCase):
    def test_sequence_offbook_keeps_playing_with_ai_and_pair_undo(self):
        store=store_for('ggg-easy-01');state=server.active_state(store);lesson=state['lesson']
        point=legal_point(state,(tuple(n['move']) for n in lesson['tree']['children']))
        def unavailable(_):
            raise RuntimeError('test outage')
        server.apply_store(store,{'type':'play',**point},reviewer=unavailable)
        state=server.active_state(store);self.assertTrue(state['lesson_playout']);self.assertTrue(server.computer_turn(state));self.assertEqual(len(state['moves']),1);self.assertEqual(store['profiles']['parent']['attempts'],[])
        server.apply_store(store,{'type':'ai_move'},ai_choice=legal_point(state))
        state=server.active_state(store);self.assertFalse(server.computer_turn(state));self.assertEqual(len(state['moves']),2);self.assertEqual(state['lesson_progress']['status'],'exploring')
        server.apply_store(store,{'type':'play',**legal_point(state)})
        state=server.active_state(store);self.assertTrue(server.computer_turn(state));self.assertEqual(len(state['moves']),3);self.assertEqual(store['profiles']['parent']['attempts'],[])
        server.apply_store(store,{'type':'ai_move'},ai_choice=legal_point(state))
        server.apply_store(store,{'type':'undo'})
        state=server.active_state(store);self.assertEqual(len(state['moves']),2);self.assertEqual(state['to_play'],state['initial_player']);self.assertTrue(state['lesson_playout'])
        server.apply_store(store,{'type':'pass'})
        server.apply_store(store,{'type':'ai_move'},ai_choice={'pass':True})
        state=server.active_state(store);self.assertTrue(state['ended']);self.assertEqual(state['passes'],2)
        server.apply_store(store,{'type':'undo'})
        state=server.active_state(store);self.assertFalse(state['ended']);self.assertEqual(state['passes'],0);self.assertEqual(len(state['moves']),2)
        server.apply_store(store,{'type':'retry'})
        state=server.active_state(store);self.assertFalse(state['lesson_playout']);self.assertFalse(state['lesson_attempted']);self.assertEqual(state['moves'],[])

    def test_wrong_single_move_records_once_then_uses_same_playout(self):
        store=store_for('escape-1-1');state=server.active_state(store)
        server.apply_store(store,{'type':'play','x':0,'y':0})
        state=server.active_state(store);attempts=store['profiles']['parent']['attempts'];self.assertTrue(state['lesson_playout']);self.assertTrue(server.computer_turn(state));self.assertEqual(len(attempts),1);self.assertFalse(attempts[0]['correct'])
        server.apply_store(store,{'type':'ai_move'},ai_choice=legal_point(state))
        state=server.active_state(store);server.apply_store(store,{'type':'play',**legal_point(state)})
        self.assertEqual(len(store['profiles']['parent']['attempts']),1);self.assertTrue(server.computer_turn(server.active_state(store)))
        correct=store_for('escape-1-1');server.apply_store(correct,{'type':'play','x':2,'y':4});state=server.active_state(correct);self.assertFalse(state['lesson_playout']);self.assertTrue(state['lesson_attempted']);self.assertTrue(correct['profiles']['parent']['attempts'][0]['correct'])

    def test_custom_lesson_enters_unrated_playout(self):
        store=store_for('escape-1-1');server.apply_store(store,{'type':'setup','size':9,'stones':[],'to_play':2,'title':'自定义续弈'})
        state=server.active_state(store);server.apply_store(store,{'type':'play',**legal_point(state)});state=server.active_state(store)
        self.assertTrue(state['lesson_playout']);self.assertTrue(server.computer_turn(state));self.assertEqual(store['profiles']['parent']['attempts'],[])

    def test_legacy_answer_without_verdict_stays_stopped(self):
        store=store_for('escape-1-1');state=store['profiles']['parent']['state'];state['lesson_attempted']=True;state['assessment']=None;state.pop('lesson_playout')
        state=server.active_state(store)
        self.assertFalse(state['lesson_playout']);self.assertFalse(server.computer_turn(state));self.assertTrue(state['lesson_attempted'])

    def test_invalid_or_legacy_snapshot_cannot_restore_playout(self):
        store=store_for('escape-1-1');state=store['profiles']['parent']['state']
        state['lesson_playout']=True
        self.assertFalse(server.active_state(store)['lesson_playout'])
        server.apply_store(store,{'type':'play','x':0,'y':0})
        state=server.active_state(store);state['history'][0].pop('lesson_playout',None)
        server.apply_store(store,{'type':'undo'})
        state=server.active_state(store);self.assertFalse(state['lesson_playout']);self.assertFalse(state['lesson_attempted']);self.assertEqual(state['moves'],[])


if __name__=='__main__':
    unittest.main()
