"""Registration atomicity and evidence-based progression into tactical sequences."""
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import curriculum
import tactics


class ExtendedCurriculumTests(unittest.TestCase):
    def setUp(self):
        self.catalog_before = list(curriculum._CATALOG)
        self.lookup_before = dict(curriculum._BY_ID)

    def tearDown(self):
        curriculum._CATALOG[:] = self.catalog_before
        curriculum._BY_ID.clear()
        curriculum._BY_ID.update(self.lookup_before)

    def authored(self):
        return next(l for l in curriculum.catalog() if l.get('sequence'))

    def copied_lesson(self, identity):
        lesson = self.authored()
        lesson['id'] = identity
        return lesson

    @staticmethod
    def evidence(lesson, correct=True, **extra):
        return dict(lesson_id=lesson['id'], correct=correct, assisted=False,
                    attempt_no=1, **extra)

    @staticmethod
    def capture_stat(attempts):
        return next(s for s in curriculum.learning(attempts)['skills']
                    if s['id'] == 'capture')

    def completed_through(self, highest):
        return [self.evidence(l)
                for level in range(1, highest + 1)
                for l in [x for x in curriculum.catalog()
                          if x['skill'] == 'capture' and x['difficulty'] == level][:3]]

    def test_authored_tactics_are_registered_and_reads_do_not_revalidate(self):
        sequences = [l for l in curriculum.catalog() if l.get('sequence')]
        self.assertTrue(sequences)
        self.assertEqual({3, 4, 5}, {l['difficulty'] for l in sequences})
        self.assertTrue(all(l['skill'] == ('tsumego' if l['id'].startswith('ggg-') else 'capture') for l in sequences))
        self.assertEqual(sum(l['id'].startswith('ggg-') for l in sequences),417)
        identities = [l['id'] for l in curriculum.catalog()]
        self.assertEqual(len(identities), len(set(identities)))
        with patch.object(tactics, 'validate_lesson', side_effect=AssertionError('read revalidated')):
            returned = curriculum.get_lesson(sequences[0]['id'])
            returned['title'] = 'caller-local edit'
            self.assertNotEqual(curriculum.get_lesson(returned['id'])['title'], returned['title'])
            self.assertTrue(curriculum.catalog())

    def test_register_validates_and_returns_a_copy(self):
        lesson = self.copied_lesson('import-v3-valid')
        with patch.object(tactics, 'validate_lesson', wraps=tactics.validate_lesson) as validate:
            result = curriculum.register_lesson(lesson)
            self.assertEqual(validate.call_count, 1)
        result['title'] = 'changed result'
        lesson['title'] = 'changed input'
        self.assertNotIn(curriculum.get_lesson(lesson['id'])['title'], ['changed result', 'changed input'])

    def test_no_builtin_legacy_or_import_can_be_overwritten(self):
        for identity in ['escape', 'capture-1-1', self.authored()['id']]:
            with self.assertRaises(ValueError):
                curriculum.register_lesson(self.copied_lesson(identity))
        lesson = self.copied_lesson('import-v3-duplicate')
        curriculum.register_lesson(lesson)
        with self.assertRaises(ValueError):
            curriculum.register_lesson(lesson)

    def test_import_batch_is_atomic_on_invalid_or_duplicate_entries(self):
        good = self.copied_lesson('import-v3-batch')
        for payload in [[good, {'id': 'import-v3-invalid'}], [good, deepcopy(good)], [good, self.copied_lesson('escape')]]:
            with tempfile.TemporaryDirectory() as folder:
                file = Path(folder) / 'book.json'
                file.write_text(json.dumps(payload), encoding='utf-8')
                before = curriculum.catalog()
                with self.assertRaises(ValueError):
                    curriculum.load_imports(file)
                self.assertEqual(before, curriculum.catalog())
                self.assertEqual(json.loads(file.read_text()), payload)

    def test_import_file_errors_remain_visible_and_success_registers_once(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'book.json'
            self.assertEqual(curriculum.load_imports(file), 0)
            for content in ['{broken', '{}']:
                file.write_text(content, encoding='utf-8')
                with self.assertRaises(ValueError):
                    curriculum.load_imports(file)
                self.assertEqual(file.read_text(), content)
            file.write_text(json.dumps([self.copied_lesson('import-v3-file')]), encoding='utf-8')
            self.assertEqual(curriculum.load_imports(file), 1)
            self.assertEqual(curriculum.get_lesson('import-v3-file')['id'], 'import-v3-file')
            with self.assertRaises(ValueError):
                curriculum.load_imports(file)

    def test_capture_progresses_all_five_levels_without_skipping_prerequisites(self):
        self.assertEqual(self.capture_stat([])['next_difficulty'], 1)
        for highest in range(1, 5):
            with self.subTest(completed_through=highest):
                self.assertEqual(self.capture_stat(self.completed_through(highest))['next_difficulty'], highest + 1)
        hard_only = [self.evidence(l) for l in curriculum.catalog()
                     if l['skill'] == 'capture' and l['difficulty'] >= 3]
        self.assertEqual(self.capture_stat(hard_only)['next_difficulty'], 1)

    def test_three_of_four_correct_is_enough_but_two_of_three_is_not(self):
        basics = [l for l in curriculum.catalog() if l['skill'] == 'capture' and l['difficulty'] == 1][:4]
        attempts = [self.evidence(l, correct=i != 2) for i, l in enumerate(basics)]
        self.assertEqual(self.capture_stat(attempts[:3])['next_difficulty'], 1)
        self.assertEqual(self.capture_stat(attempts)['next_difficulty'], 2)

    def test_hinted_first_attempt_and_retries_do_not_unlock_next_level(self):
        basics = [l for l in curriculum.catalog() if l['skill'] == 'capture' and l['difficulty'] == 1][:3]
        attempts = [dict(lesson_id=l['id'], correct=True, assisted=True, attempt_no=1) for l in basics]
        attempts += [dict(lesson_id=l['id'], correct=True, assisted=False, attempt_no=2) for l in basics]
        self.assertEqual(self.capture_stat(attempts)['next_difficulty'], 1)
        self.assertEqual(self.capture_stat(attempts)['independent_attempts'], 0)

    def test_small_authored_level_uses_available_question_threshold(self):
        level_three = [l for l in curriculum._CATALOG if l['skill'] == 'capture' and l['difficulty'] == 3]
        curriculum._CATALOG[:] = [l for l in curriculum._CATALOG if l not in level_three[1:]]
        attempts = self.completed_through(2) + [self.evidence(level_three[0])]
        self.assertEqual(self.capture_stat(attempts)['next_difficulty'], 4)

    def test_recommendation_reaches_tactics_after_lower_levels_are_ready(self):
        other_skills = [self.evidence(l) for l in curriculum.catalog() if l['skill'] != 'capture']
        for highest in (2, 3, 4):
            attempts = other_skills + self.completed_through(highest)
            recommended = curriculum.recommend(attempts)
            self.assertEqual(recommended['skill'], 'capture')
            self.assertEqual(recommended['difficulty'], highest + 1)
            self.assertTrue(recommended['sequence'])

    def test_old_escape_variants_still_count_as_distinct_evidence(self):
        attempts = [self.evidence(curriculum.get_lesson(f'escape-1-{i}')) for i in (1, 2, 3)]
        escape = next(s for s in curriculum.learning(attempts)['skills'] if s['id'] == 'escape')
        self.assertEqual(escape['independent_attempts'], 3)
        self.assertEqual(escape['next_difficulty'], 2)


if __name__ == '__main__':
    unittest.main()
