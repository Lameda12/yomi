"""Run from the repo root: python3 -m unittest ml.test_train_stuck"""
from __future__ import annotations

import unittest

import numpy as np

from ml.features import CELL_FEATURES, cell_features, load_puzzles
from ml.train_stuck import (
    MIN_STUCK_SOLVES,
    StuckModel,
    build_rows,
    fit_logistic,
    score_cells,
    stuck_solves_from_frame,
    top_cells,
    train_stuck,
)

PUZZLES = load_puzzles()
BY_ID = {p["id"]: p for p in PUZZLES}


def longest_leg_cell(puzzle: dict) -> tuple[int, int]:
    """Synthetic rule for tests only: pretend people always stall on the cell furthest from its next dot."""
    feats = cell_features(puzzle)
    return max(feats, key=lambda c: (feats[c]["dist_to_next_dot"], -feats[c]["path_frac"]))


def rule_solves(n: int) -> list[tuple[str, str, tuple[int, int] | None]]:
    out = []
    for i in range(n):
        p = PUZZLES[i % len(PUZZLES)]
        out.append((f"player-{i % 3}", p["id"], longest_leg_cell(p)))
    return out


class LogisticTests(unittest.TestCase):
    def test_recovers_direction_and_scale_of_a_known_model(self) -> None:
        rng = np.random.default_rng(1)
        x = np.column_stack([rng.uniform(0, 1, 4000), rng.uniform(0, 100, 4000)])
        true = np.array([2.0, -0.05])
        y = (rng.uniform(size=4000) < 1 / (1 + np.exp(-(-0.5 + x @ true)))).astype(float)
        intercept, coef = fit_logistic(x, y, l2=1e-6)
        self.assertAlmostEqual(intercept, -0.5, delta=0.3)
        np.testing.assert_allclose(coef, true, atol=0.15)

    def test_constant_column_gets_zero_coefficient(self) -> None:
        rng = np.random.default_rng(2)
        x = np.column_stack([rng.uniform(0, 1, 200), np.full(200, 3.0)])
        y = (x[:, 0] > 0.5).astype(float)
        _, coef = fit_logistic(x, y)
        self.assertEqual(coef[1], 0.0)

    def test_rejects_bad_shapes(self) -> None:
        with self.assertRaises(ValueError):
            fit_logistic(np.zeros((0, 2)), np.zeros(0))


class DataTests(unittest.TestCase):
    def test_rows_cover_every_solution_cell_with_one_positive_per_solve(self) -> None:
        p = PUZZLES[0]
        x, y, used, dropped = build_rows([("a", p["id"], longest_leg_cell(p))], BY_ID)
        self.assertEqual((used, dropped), (1, 0))
        self.assertEqual(len(y), len(cell_features(p)))
        self.assertEqual(y.sum(), 1.0)
        self.assertEqual(x.shape[1], len(CELL_FEATURES))

    def test_off_path_and_missing_stuck_cells_are_dropped_not_guessed(self) -> None:
        p = PUZZLES[0]
        off = (p["n"] + 3, 0)  # outside the board, so certainly not a solution cell
        x, y, used, dropped = build_rows([("a", p["id"], off), ("a", p["id"], None)], BY_ID)
        self.assertEqual((used, dropped, len(y)), (0, 2, 0))

    def test_frame_loader_drops_test_rows_and_incomplete_solves(self) -> None:
        import pandas as pd

        p = PUZZLES[0]["id"]
        df = pd.DataFrame([
            {"id": 1, "player_id": "a", "puzzle_id": p, "completed": True, "solve_ms": 9000, "stuck_cell": [0, 0]},  # test row id
            {"id": 20, "player_id": "a", "puzzle_id": p, "completed": True, "solve_ms": 9000, "stuck_cell": [1, 1]},
            {"id": 21, "player_id": "a", "puzzle_id": p, "completed": False, "solve_ms": 9000, "stuck_cell": [1, 1]},
            {"id": 22, "player_id": "a", "puzzle_id": p, "completed": True, "solve_ms": 9000, "stuck_cell": None},
        ])
        got = stuck_solves_from_frame(df, {p})
        self.assertEqual(got, [("a", p, (1, 1)), ("a", p, None)])


class TrainingTests(unittest.TestCase):
    def test_below_the_floor_the_model_stays_untrained_and_predicts_nothing(self) -> None:
        model = train_stuck(rule_solves(MIN_STUCK_SOLVES - 1), PUZZLES)
        self.assertFalse(model.trained)
        self.assertEqual((model.intercept, model.coef), (0.0, {}))
        self.assertEqual(model.n_solves, MIN_STUCK_SOLVES - 1)
        self.assertEqual(top_cells(model, PUZZLES[0]), [])
        self.assertEqual(score_cells(model, PUZZLES[0]), {})

    def test_fits_a_planted_rule_and_ranks_the_planted_cell_in_the_top_three(self) -> None:
        model = train_stuck(rule_solves(60), PUZZLES)
        self.assertTrue(model.trained)
        self.assertEqual(list(model.coef), CELL_FEATURES)
        self.assertGreater(model.coef["dist_to_next_dot"], 0.0)
        hits = sum(longest_leg_cell(p) in top_cells(model, p) for p in PUZZLES)
        self.assertGreaterEqual(hits / len(PUZZLES), 0.8)

    def test_top_cells_are_k_distinct_solution_cells(self) -> None:
        model = StuckModel(0.0, {f: 0.0 for f in CELL_FEATURES}, 30, 0)
        model.coef["path_frac"] = 1.0
        top = top_cells(model, PUZZLES[0])
        self.assertEqual(len(set(top)), 3)
        self.assertTrue(set(top) <= set(cell_features(PUZZLES[0])))


if __name__ == "__main__":
    unittest.main()
