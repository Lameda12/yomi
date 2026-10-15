"""Run from the repo root: python3 -m unittest ml.test_train_stuck"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import numpy as np

from ml.export import build_model_json, set_stuck_block, write_model_json
from ml.features import CELL_FEATURES, cell_features, load_puzzles
from ml.train_stuck import (
    MIN_LABELED_SOLVES,
    StuckModel,
    cell_scores,
    fit_logistic,
    labeled_solves_from_frame,
    longest_pause_cell,
    top_cells,
    train,
)
from ml.train_time import train as train_time

PUZZLES = load_puzzles()
BY_ID = {p["id"]: p for p in PUZZLES}


def fake_labeled(n: int) -> list[tuple[str, str, tuple[int, int]]]:
    """n synthetic labeled solves (never written anywhere). The stuck cell is always the
    corner-most cell of the solution, so a fitted model should learn is_corner."""
    out = []
    for i in range(n):
        p = PUZZLES[i % len(PUZZLES)]
        feats = cell_features(p)
        corner = next(cell for cell, f in feats.items() if f["is_corner"] == 1.0)
        out.append((f"player-{i % 3}", p["id"], corner))
    return out


class LabelTests(unittest.TestCase):
    def test_longest_pause_matches_findstuck(self) -> None:
        # Same cases as web/tests/stuck.test.ts.
        self.assertEqual(longest_pause_cell([[0, 0, 0, 2], [500, 0, 1, 3], [4500, 0, 2, 4], [5000, 0, 3, 5]]), (0, 1))
        self.assertEqual(longest_pause_cell([[0, 1, 1, 2], [1000, 1, 2, 3], [2000, 1, 3, 4]]), (1, 1))  # tie: earliest
        self.assertIsNone(longest_pause_cell([[0, 0, 0, 2]]))
        self.assertIsNone(longest_pause_cell([]))

    def test_frame_keeps_completed_known_non_excluded_rows_with_events(self) -> None:
        import pandas as pd

        pid = PUZZLES[0]["id"]
        ev = [[0, 1, 4, 2], [3000, 0, 4, 3], [3100, 0, 3, 4]]
        df = pd.DataFrame([
            {"id": 20, "player_id": "a", "puzzle_id": pid, "completed": True, "events": ev},
            {"id": 21, "player_id": "a", "puzzle_id": pid, "completed": True, "events": json.dumps(ev)},  # CSV form
            {"id": 22, "player_id": "a", "puzzle_id": pid, "completed": False, "events": ev},  # skipped
            {"id": 23, "player_id": "a", "puzzle_id": pid, "completed": True, "events": [[0, 1, 4, 2]]},  # no pause
            {"id": 24, "player_id": "a", "puzzle_id": "nope", "completed": True, "events": ev},
            {"id": 25, "player_id": "fake", "puzzle_id": pid, "completed": True, "events": ev},
            {"id": 3, "player_id": "a", "puzzle_id": pid, "completed": True, "events": ev},  # test row
        ])
        got = labeled_solves_from_frame(df, BY_ID, ["fake"])
        self.assertEqual(got, [("a", pid, (1, 4)), ("a", pid, (1, 4))])
        self.assertEqual(labeled_solves_from_frame(pd.DataFrame(), BY_ID), [])


class LogisticTests(unittest.TestCase):
    def test_recovers_known_coefficients_on_raw_scale(self) -> None:
        rng = np.random.default_rng(1)
        x = np.column_stack([rng.normal(0, 1, 4000), rng.uniform(0, 50, 4000)])
        true = np.array([1.2, -0.05])
        p = 1 / (1 + np.exp(-(0.5 + x @ true)))
        y = (rng.uniform(size=len(p)) < p).astype(float)
        intercept, coef = fit_logistic(x, y, alpha=1e-6)
        self.assertAlmostEqual(intercept, 0.5, delta=0.2)
        np.testing.assert_allclose(coef, true, atol=0.1)

    def test_constant_column_gets_zero_coefficient(self) -> None:
        x = np.column_stack([np.arange(10.0), np.full(10, 3.0)])
        y = (np.arange(10) >= 5).astype(float)
        _, coef = fit_logistic(x, y)
        self.assertEqual(float(coef[1]), 0.0)
        self.assertGreater(float(coef[0]), 0.0)

    def test_penalty_shrinks_coefficients(self) -> None:
        x = np.arange(20.0).reshape(-1, 1)
        y = np.array([0, 1] * 10, dtype=float)
        y[15:] = 1.0
        _, small = fit_logistic(x, y, alpha=1e-6)
        _, big = fit_logistic(x, y, alpha=1000.0)
        self.assertLess(abs(big[0]), abs(small[0]))


class SkipPathTests(unittest.TestCase):
    def test_below_threshold_skips_the_fit(self) -> None:
        m = train(fake_labeled(MIN_LABELED_SOLVES - 1), PUZZLES)
        self.assertFalse(m.fitted)
        self.assertEqual((m.intercept, m.coef, m.labeled_solves), (0.0, {}, MIN_LABELED_SOLVES - 1))
        self.assertEqual(cell_scores(m, PUZZLES[0]), [])
        self.assertEqual(top_cells(m, PUZZLES[0]), [])

    def test_no_data_skips_the_fit(self) -> None:
        self.assertFalse(train([], PUZZLES).fitted)

    def test_skipped_model_writes_no_stuck_coefficients(self) -> None:
        data = build_model_json(train_time([], PUZZLES), "t", train([], PUZZLES))
        self.assertEqual(data["stuck"], {"intercept": 0.0, "coef": {}})

    def test_main_says_it_skipped(self) -> None:
        from ml import train_stuck

        with tempfile.TemporaryDirectory() as d:
            out = write_model_json(train_time([], PUZZLES), Path(d) / "model.json", "t")
            buf = io.StringIO()
            with mock.patch.object(sys, "argv", ["train_stuck", "--out", str(out)]), \
                    mock.patch("ml.train_time.load_frame", return_value=None), redirect_stdout(buf):
                self.assertEqual(train_stuck.main(), 0)
            self.assertIn("skipped the fit", buf.getvalue())
            self.assertEqual(json.loads(out.read_text())["stuck"], {"intercept": 0.0, "coef": {}})


class FitTests(unittest.TestCase):
    def test_at_threshold_fits_and_learns_the_signal(self) -> None:
        m = train(fake_labeled(MIN_LABELED_SOLVES), PUZZLES)
        self.assertTrue(m.fitted)
        self.assertEqual(list(m.coef), CELL_FEATURES)
        self.assertEqual(m.labeled_solves, MIN_LABELED_SOLVES)
        self.assertGreater(m.coef["is_corner"], 0.0)
        # The planted label is a corner, so the top cell should be a corner.
        p = PUZZLES[0]
        top = top_cells(m, p)
        self.assertEqual(len(top), 3)
        self.assertEqual(cell_features(p)[top[0]]["is_corner"], 1.0)

    def test_top_cells_is_highest_score_with_stable_ties(self) -> None:
        m = StuckModel(0.0, {f: 0.0 for f in CELL_FEATURES})  # every score ties at 0
        p = PUZZLES[0]
        self.assertEqual(top_cells(m, p), [tuple(c) for c in p["solution"][:3]])
        m.coef["path_frac"] = 1.0  # later cells score higher
        self.assertEqual(top_cells(m, p), [tuple(c) for c in reversed(p["solution"][-3:])])

    def test_fitted_block_round_trips_in_contract_order(self) -> None:
        stuck = train(fake_labeled(MIN_LABELED_SOLVES), PUZZLES)
        with tempfile.TemporaryDirectory() as d:
            path = write_model_json(train_time([], PUZZLES), Path(d) / "model.json", "t")
            before = json.loads(path.read_text())
            set_stuck_block(stuck, path)
            after = json.loads(path.read_text())
        self.assertEqual(list(after["stuck"]), ["intercept", "coef"])
        self.assertEqual(list(after["stuck"]["coef"]), CELL_FEATURES)
        self.assertEqual(after["time"], before["time"])  # only the stuck block changes


if __name__ == "__main__":
    unittest.main()
