"""Run from the repo root: python3 -m unittest ml.test_pipeline"""
from __future__ import annotations

import unittest

from ml.evaluate import eval_stuck, eval_time
from ml.features import load_puzzles
from ml.pipeline import build_report
from ml.train_stuck import MIN_STUCK_SOLVES, train_stuck
from ml.train_time import MIN_HUMAN_SOLVES, train

PUZZLES = load_puzzles()


class ReportTextTests(unittest.TestCase):
    def report(self) -> str:
        return build_report("jsonl", 0, train([], PUZZLES), train_stuck([], PUZZLES), eval_time([], PUZZLES), eval_stuck([], PUZZLES), 0, 25.0)

    def test_the_time_and_stuck_floors_in_the_report_come_from_their_own_constants(self) -> None:
        text = self.report()
        self.assertIn(f"{MIN_HUMAN_SOLVES}+ completed human solves in each training fold for the time model", text)
        self.assertIn(f"{MIN_STUCK_SOLVES}+ for the stuck-point model", text)

    def test_the_two_floors_are_separate_numbers(self) -> None:
        self.assertEqual(MIN_HUMAN_SOLVES, 15)
        self.assertEqual(MIN_STUCK_SOLVES, 30)

    def test_the_report_says_which_rows_were_left_out_as_test_rows(self) -> None:
        self.assertIn("source = 'test'", self.report())


if __name__ == "__main__":
    unittest.main()
