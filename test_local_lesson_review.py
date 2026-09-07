"""Local parity and stale-review safety; temporary files and ephemeral HTTP only."""
import copy
import threading
import unittest
from unittest.mock import Mock, patch
import curriculum
import engine
import lesson_review
import server
import tactics
from go_rules import play
import test_profiles


def sample(player=1):
    s=server.blank(7);s['board'][0][8]=1;s['board'][8][8]=2;s['to_play']=player
    s['review']={'candidate':{'x':0,'y':0},'reference':{'x':1,'y':0}}
    return s


def result(before):
    def item(point):
        name=lesson_review.coord(**point,size=before['size'])
        return dict(move=name,rootInfo=dict(scoreLead=10,visits=64),moves=[dict(move=name,pv=[name])],ownership=[0]*(before['size']**2))
    return dict(revision=before['revision'],perspective='black',candidate=item(before['review']['candidate']),reference=item(before['review']['reference']))


def unknown_move(lesson):
    state=server.lesson_state(lesson['id'],0);known={tuple(n['move']) for n in lesson['tree']['children']}
    for y in range(state['size']):
        for x in range(state['size']):
            if (x,y) in known:continue
            try:play(state['board'],x,y,state['to_play'])
            except ValueError:continue
            return dict(x=x,y=y)
    raise AssertionError('No legal unlisted move')


class LocalReviewTest(unittest.TestCase):
    def test_review_changes_explanation_context_but_ordinary_assessment_does_not(self):
        state=server.blank(1);base=server.context_key(state)
        state['assessment']={'summary':'普通规则说明'};self.assertEqual(server.context_key(state),base)
        state['assessment']['review']={'source':'unavailable','verdict':'uncertain'};old=server.context_key(state);self.assertNotEqual(old,base)
        profile=server.make_profile('parent','家长',state)
        profile['llm_explanations']=[{'context_key':old,'text':'旧复核讲解'}]
        store=dict(schema=2,revision=1,active_profile_id='parent',profiles={'parent':profile},matches={})
        with patch.object(server,'engine_info',return_value={}):
            self.assertIsNotNone(server.public_store(store)['llm_explanation'])
            state['assessment']['review']={'source':'katago','verdict':'reasonable'}
            self.assertIsNone(server.public_store(store)['llm_explanation'])

    def test_black_white_signs_and_group_losses_cannot_cancel(self):
        for player in (1,2):
            before=sample(player);raw=result(before);sign=1 if player==1 else -1
            raw['reference']['rootInfo']['scoreLead']=10+5*sign
            raw['reference']['ownership'][8]=sign;raw['candidate']['ownership'][8]=-sign
            review=lesson_review.engine_review(before,raw);self.assertEqual(review['verdict'],'mistake');self.assertEqual(review['evidence']['score_loss'],5)
            state=dict(assessment={},lesson_progress={'status':'unlisted'});lesson_review.set_review(state,review)
            self.assertIsNone(state['assessment']['correct']);self.assertEqual(state['lesson_progress']['status'],'unlisted')
            raw['reference']['rootInfo']['scoreLead']=10
            raw['reference']['ownership'][80]=-sign;raw['candidate']['ownership'][80]=sign
            review=lesson_review.engine_review(before,raw);self.assertEqual(review['verdict'],'uncertain');self.assertEqual(review['evidence']['local_ownership_loss'],2)
    def test_borderline_evidence_reports_direction_without_grading(self):
        before=sample();raw=result(before);raw['reference']['rootInfo']['scoreLead']=11.7;raw['reference']['ownership'][8]=.38
        review=lesson_review.engine_review(before,raw)
        self.assertEqual(review['verdict'],'uncertain');self.assertIn('更倾向 B9',review['summary']);self.assertIn('约好 1.7 目',review['explanation'])

    def test_bad_numbers_and_pv_are_uncertain(self):
        before=sample()
        changes=[lambda r:r['candidate']['rootInfo'].update(visits=True),lambda r:r['candidate']['rootInfo'].update(visits='64'),lambda r:r['candidate']['rootInfo'].update(visits=12),lambda r:r['candidate']['rootInfo'].update(scoreLead=float('inf')),lambda r:r['candidate']['rootInfo'].update(scoreLead=False),lambda r:r['candidate']['ownership'].pop(),lambda r:r['candidate']['ownership'].__setitem__(0,2),lambda r:r.update(revision=8),lambda r:r['candidate']['moves'][0].update(pv=['A9','A9'])]
        for change in changes:
            raw=result(before);change(raw)
            self.assertEqual(lesson_review.engine_review(before,raw)['verdict'],'uncertain')
        self.assertEqual(lesson_review.engine_review(before,result(before))['verdict'],'reasonable')
    def test_all_twelve_reachable_author_prefixes_and_exact_initial_history(self):
        matched=0
        for identity,records in lesson_review.AUTHOR_VARIATIONS.items():
            trusted=curriculum.get_lesson(identity)
            for record in records:
                node=trusted['tree'];reachable=True
                for i,point in enumerate(record['moves']):
                    child=next((n for n in node.get('children',[]) if n['move']==point),None)
                    if i==len(record['moves'])-1:reachable=child is None and i%2==0
                    elif child is None:reachable=False;break
                    else:node=child
                if not reachable:continue
                state=server.lesson_state(identity,3)
                for x,y in record['moves']:server.move(state,x,y)
                state['lesson_attempted']=True;state['lesson_progress']['status']='unlisted'
                before=lesson_review.review_position(state);self.assertEqual(len(before['moves']),len(record['moves'])-1)
                review=lesson_review.author_review(state,trusted);self.assertEqual(review['source'],'author',identity);matched+=1
                altered=copy.deepcopy(trusted);altered['stones'].pop();self.assertIsNone(lesson_review.author_review(state,altered))
                bad=copy.deepcopy(state);bad['moves'][0]['color']=3-bad['moves'][0]['color'];self.assertIsNone(lesson_review.author_review(bad,trusted))
                bad=copy.deepcopy(state);bad['lesson']['objective']={'kind':'capture','targets':[[0,0]]};self.assertIsNone(lesson_review.author_review(bad,trusted))
                bad=copy.deepcopy(state);bad['lesson']['source']['url']='https://example.test/another';self.assertIsNone(lesson_review.author_review(bad,trusted))
                bad=copy.deepcopy(state);bad['history'][-1]['move_number']+=1
                with self.assertRaises(ValueError):lesson_review.review_position(bad)
                bad=copy.deepcopy(state);bad['board'][0][0]=3-bad['board'][0][0] if bad['board'][0][0] else 1
                with self.assertRaises(ValueError):lesson_review.review_position(bad)
        self.assertEqual(matched,12)
    def test_captured_target_reoccupied_later_stays_captured_in_history(self):
        state=server.blank(0,'lesson');state['lesson']={'sequence':True,'objective':{'kind':'capture','targets':[[0,0]]}}
        for x,y in ((0,0),(1,1),(1,2),(0,3)):state['board'][y][x]=2
        for x,y in ((1,0),(0,2)):state['board'][y][x]=1
        state['initial_board']=copy.deepcopy(state['board'])
        self.assertFalse(lesson_review.capture_goal_complete(state))
        server.move(state,0,1);server.move(state,0,0)
        self.assertEqual(state['board'][0][0],2);self.assertTrue(lesson_review.capture_goal_complete(state));self.assertEqual(lesson_review.rule_review(state)['source'],'rules')

    def test_actual_capture_outside_tree_completes_without_engine(self):
        lesson=tactics.validate_lesson(dict(id='local-alternative-capture',title='任选目标',prompt='提掉任一目标',hint='数气',size=9,skill='capture',difficulty=3,to_play=1,sequence=True,stones=[dict(x=0,y=0,color=2),dict(x=1,y=0,color=1),dict(x=8,y=8,color=2),dict(x=7,y=8,color=1)],objective=dict(kind='capture_any',targets=[[0,0],[8,8]]),tree=dict(children=[dict(move=[0,1],explanation="提掉角上的白棋。",children=[])])))
        with patch.dict(curriculum._BY_ID,{lesson['id']:lesson}):
            profile=server.make_profile('parent','家长',server.lesson_state(lesson['id'],0));store=dict(schema=2,revision=0,active_profile_id='parent',profiles={'parent':profile},matches={})
            reviewer=Mock();server.apply_store(store,dict(type='play',x=8,y=7),reviewer=reviewer)
            reviewer.assert_not_called();self.assertTrue(profile['state']['assessment']['correct']);self.assertEqual(profile['state']['lesson_progress']['status'],'solved');self.assertTrue(profile['attempts'][0]['correct']);self.assertFalse(profile['attempts'][0]['assisted'])
            # Legacy unlisted state: explicit review can award the actual capture once.
            profile['attempts']=[];profile['state']['lesson_progress']['status']='unlisted';profile['state']['assessment']['correct']=None;profile['state']['assisted']=True
            server.apply_store(store,dict(type='review_move'),reviewer=reviewer)
            reviewer.assert_not_called();self.assertEqual(profile['state']['assessment']['review']['source'],'rules');self.assertTrue(profile['attempts'][0]['correct']);self.assertTrue(profile['attempts'][0]['assisted']);self.assertEqual(profile['state']['lesson_progress']['status'],'solved')
            with self.assertRaises(ValueError):server.apply_store(store,dict(type='review_move'),reviewer=reviewer)
            self.assertEqual(len(profile['attempts']),1)



class LocalReviewHTTPTest(unittest.TestCase):
    request=test_profiles.ProfilesHTTPTest.request
    state=test_profiles.ProfilesHTTPTest.state
    action=test_profiles.ProfilesHTTPTest.action
    def setUp(self):
        test_profiles.ProfilesHTTPTest.setUp(self)
        self.review_patch=patch.object(engine,'review',side_effect=RuntimeError('test unavailable'))
        self.review=self.review_patch.start()
    def tearDown(self):
        self.review_patch.stop();test_profiles.ProfilesHTTPTest.tearDown(self)
    def test_failed_engine_saves_move_then_retry_never_completes_or_scores(self):
        lesson=curriculum.get_lesson('ggg-easy-01');self.action('lesson',id=lesson['id']);point=unknown_move(lesson)
        state=self.action('play',**point);self.assertEqual(state['assessment']['review']['source'],'unavailable');self.assertEqual(len(state['moves']),1);self.assertEqual(state['recent_attempts'],[])
        def reviewed(before):
            with server.LOCK:server.STORE['profiles']['parent'].setdefault('llm_explanations',[]).append({'context_key':'older-context','text':'并发到达的讲解'})
            return result(before)
        self.review.side_effect=reviewed
        state=self.action('review_move');self.assertEqual(state['assessment']['review']['source'],'katago');self.assertEqual(state['assessment']['review']['verdict'],'reasonable');self.assertIsNone(state['assessment']['correct']);self.assertEqual(state['lesson_progress']['status'],'unlisted');self.assertEqual(state['recent_attempts'],[]);self.assertEqual(state['practice_progress']['completed'],0)
        restored=server.load_store();self.assertEqual(len(restored['profiles']['parent']['llm_explanations']),1);self.assertEqual(len(restored['profiles']['parent']['state']['moves']),1);self.assertEqual(self.review.call_count,2)
    def test_author_refutation_is_failed_without_engine_and_recorded_once(self):
        self.action('lesson',id='ggg-easy-68');state=self.action('play',x=15,y=18)
        self.review.assert_not_called();self.assertEqual(state['assessment']['review']['source'],'author');self.assertIs(state['assessment']['correct'],False);self.assertEqual(state['lesson_progress']['status'],'failed');self.assertEqual(len(state['recent_attempts']),1);self.assertTrue(state['recent_attempts'][0]['assisted'])
        self.assertEqual(self.request('POST','/api/action',dict(type='review_move',revision=state['revision']))[0],400)
        self.assertEqual(len(self.state()['recent_attempts']),1)
    def test_reference_moves_and_free_play_do_not_call_review(self):
        lesson=curriculum.get_lesson('tactic-short-ladder');self.action('lesson',id=lesson['id']);x,y=lesson['tree']['children'][0]['move'];self.action('play',x=x,y=y)
        self.action('new');state=self.action('play',x=0,y=0)
        self.assertEqual(self.request('POST','/api/action',dict(type='review_move',revision=state['revision']))[0],400);self.review.assert_not_called()
    def test_late_review_cannot_write_into_changed_profile_or_board(self):
        lesson=curriculum.get_lesson('ggg-easy-01');self.action('lesson',id=lesson['id']);revision=self.state()['revision'];entered=threading.Event();release=threading.Event();responses=[]
        def delayed(before):entered.set();release.wait(5);return result(before)
        self.review.side_effect=delayed
        pending=threading.Thread(target=lambda:responses.append(self.request('POST','/api/action',dict(type='play',revision=revision,expected_profile_id='parent',**unknown_move(lesson)))))
        pending.start()
        try:
            self.assertTrue(entered.wait(2));child=self.action('switch_profile',profile_id='child');self.assertEqual(child['profile']['id'],'child')
        finally:release.set();pending.join(3)
        self.assertFalse(pending.is_alive());self.assertEqual(responses[0][0],409);self.assertEqual(self.state()['profile']['id'],'child');self.assertEqual(server.STORE['profiles']['parent']['state']['moves'],[]);self.assertEqual(server.STORE['profiles']['parent']['attempts'],[])
        self.assertEqual(self.request('POST','/api/action',dict(type='new',revision=self.state()['revision'],expected_profile_id='parent'))[0],409)
