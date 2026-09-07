import unittest
from feedback import free_feedback
from go_rules import play


class FeedbackTest(unittest.TestCase):
    def board(self, pieces):
        b = [[0] * 9 for _ in range(9)]
        for x, y, c in pieces:
            b[y][x] = c
        return b

    def evaluate(self, pieces, x=3, y=6):
        before = self.board(pieces)
        after, captured = play(before, x, y, 1)
        return free_feedback(before, after, {"x":x,"y":y}, 1, captured)

    def test_rescue(self):
        result = self.evaluate([(3,5,1),(2,5,2),(3,4,2),(4,5,2)])
        self.assertIn("解除了打吃", result["summary"])
        self.assertEqual(len(result["marks"]), 3)
        self.assertIsNone(result["correct"])

    def test_capture(self):
        result = self.evaluate([(3,5,2),(2,5,1),(3,4,1),(4,5,1)])
        self.assertIn("提走了 1", result["summary"])

    def test_connection_and_shared_liberties(self):
        result = self.evaluate([(2,5,1),(4,5,1)],3,5)
        self.assertIn("连成", result["summary"])
        self.assertIn("原来的 2 块", result["explanation"])

    def test_self_atari_is_warning(self):
        result = self.evaluate([(2,6,2),(4,6,2),(3,7,2)])
        self.assertIn("只剩一口气", result["summary"])
        self.assertEqual(len(result["marks"]), 1)
        self.assertFalse(result["counted_for_learning"])


if __name__ == "__main__":
    unittest.main()
