import unittest
from unittest.mock import patch

import curriculum
import server
import tactics


def selection_lesson():
    return tactics.validate_lesson({
        'id': 'selection-local-test',
        'title': '选择白子',
        'prompt': '找出需要逃跑的白子。',
        'hint': '先数每块白棋的气。',
        'size': 9,
        'skill': 'escape',
        'sequence': False,
        'difficulty': 1,
        'to_play': 1,
        'stones': [
            {'x': 1, 'y': 1, 'color': 1},
            {'x': 2, 'y': 1, 'color': 2},
            {'x': 3, 'y': 1, 'color': 2},
        ],
        'marks': [{'x': 1, 'y': 1, 'label': '▲'}],
        'objective': {'kind': 'select_stones', 'targets': [[2, 1]]},
        'source': {
            'kind': 'book',
            'usage': 'household_private',
            'answer_verified': True,
            'title': '手筋书',
            'page': '71',
            'problem': '385',
        },
    })


class SelectionLessonTests(unittest.TestCase):
    def state(self):
        lesson = selection_lesson()
        with patch.object(curriculum, 'get_lesson', return_value=lesson):
            return server.lesson_state(lesson['id'], 0), lesson

    def test_public_lesson_hides_targets_but_exposes_interaction(self):
        _, lesson = self.state()
        public = server.lesson_public(lesson)
        self.assertNotIn('objective', public)
        self.assertEqual(public['interaction'], 'select_stones')
        self.assertEqual(public['selection_color'], 2)
        self.assertEqual(public['marks'], [{'x': 1, 'y': 1, 'label': '▲'}])

    def test_wrong_and_correct_selection_do_not_place_stones(self):
        state, _ = self.state()
        before = [row[:] for row in state['board']]
        with self.assertRaisesRegex(ValueError, '点选白子'):
            server.apply(state, {'type': 'play', 'x': 0, 'y': 0})
        server.apply(state, {'type': 'submit_selection', 'points': [[3, 1]]})
        self.assertFalse(state['assessment']['correct'])
        self.assertFalse(server.lesson_playout_active(state))
        self.assertEqual(state['board'], before)
        self.assertEqual(state['marks'], [{'x': 1, 'y': 1, 'label': '▲'}, {'x': 3, 'y': 1, 'label': '已选'}])
        state, _ = self.state()
        server.apply(state, {'type': 'submit_selection', 'points': [[2, 1]]})
        self.assertTrue(state['assessment']['correct'])
        self.assertEqual(state['lesson_progress']['status'], 'solved')
        self.assertEqual(state['marks'], [{'x': 1, 'y': 1, 'label': '▲'}, {'x': 2, 'y': 1, 'label': '△'}])
        self.assertEqual(state['board'], before)

    def test_prompt_marks_must_not_reveal_selection_targets(self):
        value = selection_lesson()
        self.assertEqual(tactics.validate_lesson(value)['marks'], [{'x': 1, 'y': 1, 'label': '▲'}])
        for bad_mark in (
            {'x': 2, 'y': 1, 'label': '△'},
            {'x': 1, 'y': 1, 'label': '目标'},
            {'x': 3, 'y': 1, 'label': '▲'},
        ):
            bad = selection_lesson()
            bad['marks'] = [bad_mark]
            with self.subTest(mark=bad_mark), self.assertRaisesRegex(ValueError, '题干▲'):
                tactics.validate_lesson(bad)


if __name__ == '__main__':
    unittest.main()
