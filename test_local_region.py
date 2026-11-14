import unittest
from unittest.mock import patch
import engine


def state(region=None):
    board = [[0] * 19 for _ in range(19)]
    board[0][0] = 2; board[1][1] = 1
    s = {'size': 19, 'board': board, 'to_play': 2, 'revision': 1}
    if region is not None:
        s['region'] = region
    return s


class LocalRegionTest(unittest.TestCase):
    def test_region_restricts_reply_with_allow_moves(self):
        seen = {}
        def run(query, timeout=90):
            seen.update(query)
            return {'moveInfos': [{'move': 'B19', 'order': 0}]}
        with patch.object(engine, '_run_query', side_effect=run):
            move = engine.choose_move(state([{'x': 1, 'y': 0}, {'x': 0, 'y': 1}, {'x': 1, 'y': 1}]))
        self.assertEqual(move, {'x': 1, 'y': 0})
        # occupied B18 is dropped; only empty named points reach KataGo
        self.assertEqual(seen['allowMoves'], [{'player': 'W', 'moves': ['B19', 'A18'], 'untilDepth': 1}])

    def test_region_rejects_extra_fields(self):
        with self.assertRaises(ValueError):
            engine.local_region(state([{'x': 1, 'y': 0, 'player': 'B'}]))
        with self.assertRaises(ValueError):
            engine.local_region(state('A1'))

    def test_no_region_keeps_whole_board(self):
        self.assertIsNone(engine.local_region(state()))


if __name__ == '__main__':
    unittest.main()
