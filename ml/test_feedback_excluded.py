"""Run from the repo root: python3 -m unittest ml.test_feedback_excluded

The optional "how difficult did that feel?" answer (solves.perceived_difficulty) is for analysis only. These tests pin
that the training inputs cannot see it: no ml module mentions the column, and the training rows are identical with
or without it. Synthetic data only.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import pandas as pd

from ml.train_stuck import stuck_solves_from_frame
from ml.train_time import human_records, solves_from_frame

PUZZLES = {"zip-5x5-01", "zip-6x6-01"}


def frame(with_rating: bool) -> pd.DataFrame:
    rows = []
    for i in range(12):
        row = {
            "id": 100 + i, "player_id": f"p{i % 3}", "puzzle_id": "zip-5x5-01" if i % 2 else "zip-6x6-01",
            "solve_ms": 20_000 + 1_000 * i, "completed": True, "mode": "regular", "stuck_cell": [0, 1],
        }
        if with_rating:
            row["perceived_difficulty"] = ["easy", "medium", "hard", None][i % 4]
        rows.append(row)
    return pd.DataFrame(rows)


class FeedbackExcludedTest(unittest.TestCase):
    def test_no_training_module_mentions_the_column(self) -> None:
        for path in Path(__file__).parent.glob("*.py"):
            if path.name.startswith("test_"):
                continue
            self.assertNotIn("perceived_difficulty", path.read_text(), path.name)

    def test_training_rows_are_the_same_with_and_without_the_column(self) -> None:
        self.assertEqual(solves_from_frame(frame(True), PUZZLES), solves_from_frame(frame(False), PUZZLES))
        self.assertEqual(stuck_solves_from_frame(frame(True), PUZZLES), stuck_solves_from_frame(frame(False), PUZZLES))

    def test_training_solves_carry_only_player_puzzle_and_time(self) -> None:
        for s in solves_from_frame(frame(True), PUZZLES):
            self.assertEqual(len(s), 3)
        self.assertEqual(len(human_records(frame(True), PUZZLES)), 12, "an answer, or its absence, never drops a solve")


if __name__ == "__main__":
    unittest.main()
