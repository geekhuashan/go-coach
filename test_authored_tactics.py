import json
from pathlib import Path
import unittest
from copy import deepcopy
import tactics
from scripts.import_gogameguru import Parser, SGFError, SUCCESS, setup, analyze, positive_tree, verify_active


class AuthoredTacticsTests(unittest.TestCase):
    def lesson(self):
        return dict(id='licensed-test', title='作者变化',prompt='依作者变化计算',hint='计算应手',size=19,to_play=1,skill='tsumego',difficulty=4,sequence=True,
                    stones=[dict(x=18,y=18,color=2)],marks=[],objective=dict(kind='authored_solution'),
                    source=dict(kind='licensed',license='CC BY-NC-SA-4.0',url='https://example.com/problem',author='Example author'),
                    tree={'children':[{'move':[17,18],'explanation':'作者第一手','children':[{'move':[18,17],'explanation':"Correct. It is a ko.",'result':'success','author_verdict':'correct','children':[]}]}]})
    def test_authored_even_ply_leaf_is_not_fake_capture(self):
        clean=tactics.validate_lesson(self.lesson())
        self.assertEqual(clean['objective'],{'kind':'authored_solution'})
        self.assertEqual(clean['tree']['children'][0]['children'][0]['result'],'success')
    def test_explicit_worker_correct_flag_supported(self):
        value=self.lesson();leaf=value['tree']['children'][0]['children'][0]
        del leaf['result'];del leaf['author_verdict'];leaf['correct']=True
        self.assertEqual(tactics.validate_lesson(value)['tree']['children'][0]['children'][0]['author_verdict'],'correct')
    def test_unmarked_or_wrong_verdict_rejected(self):
        for bad in (False,None,'true'):
            value=self.lesson();leaf=value['tree']['children'][0]['children'][0]
            leaf.pop('result');leaf.pop('author_verdict');leaf['correct']=bad
            with self.assertRaises(ValueError):tactics.validate_lesson(value)
    def test_authored_source_requires_license_and_link(self):
        for field in ('license','url'):
            value=self.lesson();value['source'].pop(field)
            with self.assertRaisesRegex(ValueError,'授权来源'):tactics.validate_lesson(value)
    def test_authored_still_rejects_illegal_moves(self):
        value=self.lesson();value['tree']['children'][0]['move']=[18,18]
        with self.assertRaisesRegex(ValueError,'不合法'):tactics.validate_lesson(value)
    def test_capture_still_requires_actual_capture(self):
        value=self.lesson();value['skill']='capture';value['objective']={'kind':'capture','targets':[[18,18]]}
        with self.assertRaises(ValueError):tactics.validate_lesson(value)
    def test_all_417_data_lessons_validate_preserving_attribution(self):
        path=Path(__file__).parent/'data'/'gogameguru'/'lessons.json'
        lessons=json.loads(path.read_text())
        self.assertEqual(len(lessons),417)
        for value in lessons:
            with self.subTest(id=value['id']):
                self.assertEqual(tactics.validate_lesson(value),value)
                self.assertEqual(value['source']['license'],'CC BY-NC-SA-4.0')
                self.assertEqual(value['size'],19)
    def test_parser_escaped_text_and_marker_semantics(self):
        root=Parser('(;C[a\\]b\\\\c](;B[aa]C[Correct])(;B[bb]C[Almost correct]))').parse()
        self.assertEqual(root['props']['C'],['a]b\\c'])
        self.assertTrue(SUCCESS.match('This is also correct.'))
        self.assertFalse(SUCCESS.match('Almost correct'))
        self.assertFalse(SUCCESS.match('Not correct'))
        with self.assertRaises(SGFError):Parser('(;C[ok]))').parse()
    def test_parser_never_uses_mainline_as_proof(self):
        root=Parser('(;SZ[9]AB[aa]AW[bb](;B[cc]C[Unmarked])(;B[dd]C[Correct]))').parse()
        size,board,stones,player=setup(root)
        stats,errors=analyze(root,size,board,player)
        self.assertFalse(errors)
        tree=positive_tree(root,size,player)
        self.assertEqual(len(tree['children']),1)
        self.assertEqual(tree['children'][0]['move'],[3,3])
        self.assertEqual(verify_active(tree,board,player)['success_leaves'],1)


if __name__=='__main__':unittest.main()
