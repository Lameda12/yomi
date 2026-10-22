"""Run from the repo root: python3 -m unittest ml.test_evaluate

All data here is synthetic and lives only in memory. Nothing is written or exported.
"""
from __future__ import annotations

import math
import unittest

from ml.evaluate import eval_stuck, eval_time
from ml.features import load_puzzles, puzzle_features
from ml.test_train_stuck import longest_leg_cell

PUZZLES = load_puzzles()


def planted_ms(puzzle: dict) -> float:
    """A made-up human time that depends on the puzzle features, so a fit has something to find."""
    f = puzzle_features(puzzle)
    return 1000.0 * math.exp(1.2 + 0.25 * f["grid_size"] + 0.05 * f["turns"] + 0.1 * f["mean_gap"])


def time_solves(n_players: int, per_player: int) -> list[tuple[str, str, float]]:
    out = []
    for pl in range(n_players):
        for i in range(per_player):
            p = PUZZLES[(pl * 7 + i) % len(PUZZLES)]
            wobble = 1.0 + 0.04 * ((i + pl) % 3 - 1)  # +-4% so it is not an exact fit
            out.append((f"player-{pl}", p["id"], planted_ms(p) * wobble))
    return out


class TimeEvalTests(unittest.TestCase):
    def test_one_player_is_skipped_with_a_reason_not_scored(self) -> None:
        r = eval_time(time_solves(1, 40), PUZZLES)
        self.assertEqual(r.status, "skipped")
        self.assertIn("2+ players", r.reason)
        self.assertEqual(r.metrics, {})

    def test_small_folds_are_skipped(self) -> None:
        r = eval_time(time_solves(3, 8), PUZZLES)  # 16 training solves per fold, under the floor
        self.assertEqual(r.status, "skipped")
        self.assertIn("30", r.reason)

    def test_scored_run_beats_the_mean_baseline_on_a_planted_signal(self) -> None:
        r = eval_time(time_solves(3, 24), PUZZLES)
        self.assertEqual((r.status, r.n_players, r.n_solves), ("scored", 3, 72))
        m = r.metrics
        self.assertGreater(m["within20"], m["baseline_within20"])
        self.assertLess(m["median_abs_pct_err"], m["baseline_median_abs_pct_err"])
        self.assertGreater(m["within20"], 0.8)


def stuck_solves(n_players: int, per_player: int) -> list[tuple[str, str, tuple[int, int] | None]]:
    out = []
    for pl in range(n_players):
        for i in range(per_player):
            p = PUZZLES[(pl * 5 + i) % len(PUZZLES)]
            out.append((f"player-{pl}", p["id"], longest_leg_cell(p)))
    return out


class StuckEvalTests(unittest.TestCase):
    def test_one_player_is_skipped(self) -> None:
        r = eval_stuck(stuck_solves(1, 40), PUZZLES)
        self.assertEqual(r.status, "skipped")

    def test_small_folds_are_skipped(self) -> None:
        r = eval_stuck(stuck_solves(3, 8), PUZZLES)
        self.assertEqual(r.status, "skipped")

    def test_scored_run_beats_random_three_on_a_planted_rule(self) -> None:
        r = eval_stuck(stuck_solves(3, 25), PUZZLES)
        self.assertEqual((r.status, r.n_players, r.n_solves), ("scored", 3, 75))
        self.assertGreater(r.metrics["top3_hit_rate"], r.metrics["baseline_top3_hit_rate"])
        self.assertLess(r.metrics["baseline_top3_hit_rate"], 0.2)  # 3 of ~25 cells


if __name__ == "__main__":
    unittest.main()
