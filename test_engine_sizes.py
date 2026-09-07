"""Board-size transport and defensive KataGo coordinate parsing."""
import unittest
from unittest.mock import patch
import engine


def state_for(size):
    board = [[0] * size for _ in range(size)]
    return dict(size=size, board=board, initial_board=[r[:] for r in board],
                moves=[], to_play=1, initial_player=1, revision=42)


class EngineSizesTests(unittest.TestCase):
    def test_all_intersections_round_trip_for_nine_and_nineteen(self):
        for size in (9, 19):
            for y in range(size):
                for x in range(size):
                    self.assertEqual(engine.parse_move(engine.coordinate(x, y, size), size), {'x': x, 'y': y})
        self.assertEqual(engine.coordinate(8, 0, 19), 'J19')
        self.assertEqual(engine.coordinate(18, 18, 19), 'T1')
        self.assertEqual(engine.coordinate(8, 8, 9), 'J1')

    def test_payload_respects_size_initial_stones_and_history(self):
        for size, far_column in ((9, 'J'), (19, 'T')):
            s = state_for(size)
            s['initial_board'][0][0] = 1
            s['initial_board'][size-1][size-1] = 2
            s['moves'] = [{'color':1, 'x':size-1, 'y':0}, {'color':2, 'pass':True}]
            query = engine.analysis_query(s, 'size-test')
            self.assertEqual((query['boardXSize'], query['boardYSize']), (size, size))
            self.assertEqual(query['initialStones'], [['B', f'A{size}'], ['W', f'{far_column}1']])
            self.assertEqual(query['moves'], [['B', f'{far_column}{size}'], ['W', 'pass']])
            self.assertEqual(query['maxVisits'], 64)
            self.assertEqual(query['rules']['ko'], 'POSITIONAL')
            self.assertFalse(query['rules']['suicide'])

    def test_current_board_fallback_does_not_replay_moves(self):
        s = state_for(19)
        del s['initial_board']
        s['board'][18][18] = 1
        s['moves'] = [{'color':1, 'x':18, 'y':18}]
        self.assertEqual(engine.analysis_query(s, 'fallback')['moves'], [])
        self.assertEqual(engine.analysis_query(s, 'fallback')['initialStones'], [['B', 'T1']])

    def test_invalid_coordinates_and_dimension_mismatch_fail_locally(self):
        for value in ('I3', 'T20', 'A0', 'U1', 'D-1', 'D三', '', None):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                engine.parse_move(value, 19)
        with self.assertRaises(RuntimeError):
            engine.parse_move('T1', 9)
        for x, y in ((19, 0), (-1, 0), (0, 19), (True, 0)):
            with self.assertRaises(ValueError):
                engine.coordinate(x, y, 19)
        s = state_for(19)
        s['initial_board'] = [[0]*9 for _ in range(9)]
        with patch.object(engine, '_start') as start:
            with self.assertRaises(ValueError):
                engine.analyze(s)
            start.assert_not_called()

    def test_choose_move_uses_order_and_parses_far_corner_or_pass(self):
        with patch.object(engine, 'analyze', return_value={'moves':[{'order':1, 'move':'A19'}, {'order':0, 'move':'T1'}]}):
            self.assertEqual(engine.choose_move(state_for(19)), {'x':18,'y':18})
        with patch.object(engine, 'analyze', return_value={'moves':[{'order':0, 'move':'pass'}]}):
            self.assertEqual(engine.choose_move(state_for(19)), {'pass':True})
        with patch.object(engine, 'analyze', return_value={'moves':[{'order':0, 'move':'T1'}]}):
            with self.assertRaises(RuntimeError):
                engine.choose_move(state_for(9))


if __name__ == '__main__':
    unittest.main()
