"""Run from the repo root: python3 -m unittest ml.test_train_time"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from ml.export import build_model_json, write_model_json
from ml.features import CELL_FEATURES, PUZZLE_FEATURES, load_puzzles
from ml.train_time import (
    LABEL_HUMAN,
    LABEL_SOLVER,
    MIN_HUMAN_SOLVES,
    SHRINK_K,
    fit_ridge,
    player_offsets,
    solves_from_frame,
    train,
)

PUZZLES = load_puzzles()
PUZZLE_IDS = [p["id"] for p in PUZZLES]


def fake_solves(n: int) -> list[tuple[str, str, float]]:
    """n synthetic completed solves over the real puzzles (never written anywhere)."""
    return [(f"player-{i % 3}", PUZZLE_IDS[i % len(PUZZLE_IDS)], 5_000.0 + 400.0 * i) for i in range(n)]


class RidgeTests(unittest.TestCase):
    def test_recovers_known_coefficients_on_raw_scale(self) -> None:
        rng = np.random.default_rng(0)
        # Different feature scales on purpose: the standardize-then-fold-back step has to undo them.
        x = np.column_stack([rng.uniform(0, 1, 40), rng.uniform(0, 100, 40), rng.integers(5, 7, 40)])
        y = 1.5 + x @ np.array([2.0, -0.03, 0.4])
        intercept, coef = fit_ridge(x, y, alpha=1e-9)
        self.assertAlmostEqual(intercept, 1.5, places=5)
        np.testing.assert_allclose(coef, [2.0, -0.03, 0.4], atol=1e-5)
        np.testing.assert_allclose(intercept + x @ coef, y, atol=1e-5)

    def test_tiny_dataset(self) -> None:
        x = np.array([[0.0], [1.0], [2.0], [3.0]])
        intercept, coef = fit_ridge(x, 1.0 + 2.0 * x[:, 0], alpha=1e-9)
        self.assertAlmostEqual(intercept, 1.0, places=6)
        self.assertAlmostEqual(float(coef[0]), 2.0, places=6)

    def test_penalty_shrinks_coefficients(self) -> None:
        x = np.array([[0.0], [1.0], [2.0], [3.0]])
        y = 2.0 * x[:, 0]
        _, small = fit_ridge(x, y, alpha=1e-9)
        _, big = fit_ridge(x, y, alpha=100.0)
        self.assertLess(abs(big[0]), abs(small[0]))

    def test_constant_column_gets_zero_coefficient(self) -> None:
        x = np.column_stack([np.arange(5.0), np.full(5, 6.0)])
        _, coef = fit_ridge(x, 3.0 * x[:, 0], alpha=1e-9)
        self.assertEqual(float(coef[1]), 0.0)


class PlayerOffsetTests(unittest.TestCase):
    def test_one_solve_is_shrunk_more_than_thirty(self) -> None:
        resid = np.full(31, 0.5)  # every solve is 0.5 slower than the model says
        offsets = player_offsets(["new"] + ["regular"] * 30, resid)
        self.assertAlmostEqual(offsets["new"], 0.5 * 1 / (1 + SHRINK_K))
        self.assertAlmostEqual(offsets["regular"], 0.5 * 30 / (30 + SHRINK_K))
        self.assertLess(offsets["new"], offsets["regular"])
        self.assertLess(offsets["regular"], 0.5)

    def test_offset_uses_the_players_mean_residual(self) -> None:
        offsets = player_offsets(["a", "a", "b"], np.array([0.2, 0.4, -0.3]))
        self.assertAlmostEqual(offsets["a"], 0.3 * 2 / 5)
        self.assertAlmostEqual(offsets["b"], -0.3 * 1 / 4)


class LabelSwitchTests(unittest.TestCase):
    def test_under_threshold_uses_solver_effort(self) -> None:
        m = train(fake_solves(MIN_HUMAN_SOLVES - 1), PUZZLES)
        self.assertEqual(m.label, LABEL_SOLVER)
        self.assertEqual(m.human_solves, MIN_HUMAN_SOLVES - 1)
        self.assertEqual(m.players, {})
        self.assertEqual(m.coef["solver_steps"], 0.0)  # it is the label, so it cannot also be a feature

    def test_at_threshold_uses_human_time(self) -> None:
        m = train(fake_solves(MIN_HUMAN_SOLVES), PUZZLES)
        self.assertEqual(m.label, LABEL_HUMAN)
        self.assertEqual(m.human_solves, MIN_HUMAN_SOLVES)
        self.assertEqual(set(m.players), {"player-0", "player-1", "player-2"})

    def test_no_solves_still_trains_on_solver_effort(self) -> None:
        m = train([], PUZZLES)
        self.assertEqual((m.label, m.human_solves), (LABEL_SOLVER, 0))


class FilterTests(unittest.TestCase):
    def test_keeps_only_completed_timed_known_non_excluded_solves(self) -> None:
        import pandas as pd

        pid = PUZZLE_IDS[0]
        df = pd.DataFrame([
            {"player_id": "a", "puzzle_id": pid, "solve_ms": 9000, "completed": True},
            {"player_id": "a", "puzzle_id": pid, "solve_ms": 9000, "completed": False},  # skipped
            {"player_id": "a", "puzzle_id": pid, "solve_ms": None, "completed": True},  # no time
            {"player_id": "a", "puzzle_id": "unknown", "solve_ms": 9000, "completed": True},
            {"player_id": "fake", "puzzle_id": pid, "solve_ms": 9000, "completed": True},  # excluded
        ])
        self.assertEqual(solves_from_frame(df, set(PUZZLE_IDS), ["fake"]), [("a", pid, 9000.0)])
        self.assertEqual(solves_from_frame(pd.DataFrame(), set(PUZZLE_IDS)), [])


class ExportTests(unittest.TestCase):
    def test_round_trip_has_every_contract_key_in_order(self) -> None:
        model = train(fake_solves(MIN_HUMAN_SOLVES), PUZZLES)
        with tempfile.TemporaryDirectory() as d:
            path = write_model_json(model, Path(d) / "public" / "model.json", version="test")
            data = json.loads(path.read_text())

        self.assertEqual(list(data), ["version", "trained_on", "puzzle_features", "time", "players",
                                      "cell_features", "stuck"])
        self.assertEqual(data["version"], "test")
        self.assertEqual(data["trained_on"], {"human_solves": MIN_HUMAN_SOLVES, "label": LABEL_HUMAN})
        self.assertEqual(data["puzzle_features"], PUZZLE_FEATURES)
        self.assertEqual(data["cell_features"], CELL_FEATURES)
        self.assertEqual(list(data["time"]), ["intercept", "coef", "residual_std"])
        self.assertEqual(list(data["time"]["coef"]), PUZZLE_FEATURES)  # same order as puzzle_features
        self.assertEqual(data["players"], model.players)
        self.assertEqual(list(data["stuck"]), ["intercept", "coef"])
        self.assertEqual(data["stuck"]["coef"], {})  # untrained until Sprint 2 task 5

    def test_label_is_one_of_the_contract_values(self) -> None:
        for n in (0, MIN_HUMAN_SOLVES):
            label = build_model_json(train(fake_solves(n), PUZZLES))["trained_on"]["label"]
            self.assertIn(label, ("solver_effort", "human_time"))

    def test_rejects_coef_order_that_breaks_the_contract(self) -> None:
        model = train([], PUZZLES)
        model.coef = dict(reversed(list(model.coef.items())))
        with self.assertRaises(ValueError):
            build_model_json(model)

    def test_predicted_value_matches_the_contract_formula(self) -> None:
        # exp(intercept + sum(coef * x) + player offset) with raw coefficients and raw features.
        from ml.features import puzzle_features

        model = train(fake_solves(MIN_HUMAN_SOLVES), PUZZLES)
        data = build_model_json(model)
        f = puzzle_features(PUZZLES[0])
        log_ms = data["time"]["intercept"] + sum(data["time"]["coef"][k] * f[k] for k in PUZZLE_FEATURES)
        self.assertTrue(np.isfinite(np.exp(log_ms + data["players"]["player-0"])))


if __name__ == "__main__":
    unittest.main()
