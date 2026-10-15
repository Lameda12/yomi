"""Run from the repo root: python3 -m unittest ml.test_evaluate"""
from __future__ import annotations

import unittest

from ml.evaluate import _ape, evaluate_stuck, evaluate_time, render_report
from ml.features import cell_features, load_puzzles
from ml.train_stuck import MIN_LABELED_SOLVES
from ml.train_time import MIN_HUMAN_SOLVES

PUZZLES = load_puzzles()
IDS = [p["id"] for p in PUZZLES]


def fake_time(n: int, players: int) -> list[tuple[str, str, float]]:
    """Synthetic solves (never written anywhere): time grows with grid size, so a model can learn it."""
    by_id = {p["id"]: p for p in PUZZLES}
    return [(f"p{i % players}", IDS[i % len(IDS)], 2_000.0 * by_id[IDS[i % len(IDS)]]["n"] + 50.0 * (i % 7))
            for i in range(n)]


def fake_stuck(n: int, players: int) -> list[tuple[str, str, tuple[int, int]]]:
    out = []
    for i in range(n):
        p = PUZZLES[i % len(PUZZLES)]
        corner = next(c for c, f in cell_features(p).items() if f["is_corner"] == 1.0)
        out.append((f"p{i % players}", p["id"], corner))
    return out


class TimeEvalTests(unittest.TestCase):
    def test_no_solves(self) -> None:
        t = evaluate_time([], PUZZLES)
        self.assertEqual((t.n_solves, t.scored, t.within_20, t.median_ape, t.baseline_median_ape),
                         (0, 0, None, None, None))

    def test_one_player_has_no_training_data(self) -> None:
        t = evaluate_time(fake_time(5, 1), PUZZLES)
        self.assertEqual(t.scored, 0)
        self.assertEqual(t.unscored_folds, ["p0"])
        self.assertIsNone(t.baseline_median_ape)  # nobody else to take a mean from

    def test_small_training_folds_are_not_scored_against_ms(self) -> None:
        t = evaluate_time(fake_time(10, 2), PUZZLES)  # each fold trains on 5 solves -> solver_effort
        self.assertEqual(t.scored, 0)
        self.assertEqual(len(t.unscored_folds), 2)
        self.assertEqual(t.baseline_scored, 10)

    def test_big_folds_are_scored_and_beat_the_mean(self) -> None:
        t = evaluate_time(fake_time(3 * MIN_HUMAN_SOLVES, 3), PUZZLES)
        self.assertEqual(t.scored, 3 * MIN_HUMAN_SOLVES)
        self.assertEqual(t.unscored_folds, [])
        self.assertLess(t.median_ape, t.baseline_median_ape)

    def test_ape(self) -> None:
        self.assertAlmostEqual(_ape(120.0, 100.0), 0.2)


class StuckEvalTests(unittest.TestCase):
    def test_random_baseline_is_three_over_cells(self) -> None:
        p = PUZZLES[0]
        s = evaluate_stuck([("a", p["id"], (0, 0))], PUZZLES)
        self.assertAlmostEqual(s.random_hit_rate, 3 / len(p["solution"]))
        self.assertIsNone(s.hit_rate)
        self.assertEqual(s.unscored_folds, ["a"])

    def test_big_folds_are_scored(self) -> None:
        s = evaluate_stuck(fake_stuck(3 * MIN_LABELED_SOLVES, 3), PUZZLES)
        self.assertEqual(s.scored, 3 * MIN_LABELED_SOLVES)
        self.assertGreater(s.hit_rate, s.random_hit_rate_scored)  # the planted corner signal is learnable


class ReportTests(unittest.TestCase):
    def test_small_sample_says_so_and_shows_na(self) -> None:
        md = render_report(evaluate_time([], PUZZLES), evaluate_stuck([], PUZZLES), "jsonl", "solver_effort")
        self.assertIn("too small to evaluate", md)
        self.assertIn("n/a", md)
        self.assertIn("solver_effort", md)


if __name__ == "__main__":
    unittest.main()
