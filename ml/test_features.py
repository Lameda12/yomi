"""Run from the repo root: .venv/bin/python -m unittest ml.test_features"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from ml.features import (
    CELL_FEATURES,
    PUZZLE_FEATURES,
    cell_features,
    load_puzzles,
    puzzle_features,
    solver_steps,
)

PUZZLES = load_puzzles()
TEST_VECTORS = Path(__file__).resolve().parent / "test_vectors.json"
TOL = 1e-6
SOLVER_BUDGET = 300_000  # default budget of zip_solutions


class PuzzleFeatureTests(unittest.TestCase):
    def test_matches_generator_stats_in_puzzles_json(self) -> None:
        for p in PUZZLES:
            f = puzzle_features(p)
            self.assertEqual(list(f), PUZZLE_FEATURES)
            self.assertEqual(f["grid_size"], p["n"], p["id"])
            self.assertEqual(f["n_dots"], p["features"]["n_dots"], p["id"])
            self.assertEqual(f["max_gap"], p["features"]["max_gap"], p["id"])
            self.assertEqual(f["turns"], p["features"]["turns"], p["id"])
            self.assertAlmostEqual(f["mean_gap"], p["features"]["mean_gap"], delta=0.005, msg=p["id"])
            self.assertGreater(f["solver_steps"], 0, p["id"])

    def test_solver_steps_known_small_board(self) -> None:
        # 2x2, dot 1 at (0,0) and dot 2 at (1,0): two solutions, so the cap-2 search runs both.
        # Trace: down, right, up = 4 calls (3 moves + root); right, down, left = 3 more -> 7.
        p = {"id": "tiny", "n": 2, "dots": [[0, 0, 1], [1, 0, 2]],
             "solution": [[0, 0], [1, 0], [1, 1], [0, 1]]}
        self.assertEqual(solver_steps(p), 7)

    def test_solver_steps_positive_and_within_budget_for_first_puzzle(self) -> None:
        steps = solver_steps(PUZZLES[0])
        self.assertGreater(steps, 0)
        self.assertLessEqual(steps, SOLVER_BUDGET)  # budget + 1 would mean the sentinel fired


class CellFeatureTests(unittest.TestCase):
    def test_every_path_cell_has_all_features(self) -> None:
        for p in PUZZLES:
            cells = cell_features(p)
            self.assertEqual(len(cells), p["n"] ** 2, p["id"])
            for feats in cells.values():
                self.assertEqual(list(feats), CELL_FEATURES)

    def test_first_puzzle_matches_independent_walk(self) -> None:
        p = PUZZLES[0]
        n, sol = p["n"], [tuple(c) for c in p["solution"]]
        label_at = {(r, c): v for r, c, v in p["dots"]}
        cells = cell_features(p)

        # Dot 1 is the first cell; the last dot is the last cell (the generator guarantees both).
        self.assertEqual(label_at[sol[0]], 1)
        self.assertEqual(label_at[sol[-1]], len(p["dots"]))
        self.assertEqual(cells[sol[0]]["path_frac"], 0.0)
        self.assertEqual(cells[sol[-1]]["path_frac"], 1.0)

        for i, cell in enumerate(sol):
            # Walk forward along the path until the next dot.
            j = i + 1
            while j < len(sol) and sol[j] not in label_at:
                j += 1
            feats = cells[cell]
            if j < len(sol):
                self.assertEqual(feats["dist_to_next_dot"], j - i, cell)
            else:
                self.assertEqual(feats["dist_to_next_dot"], 0.0, cell)
            r, c = cell
            self.assertEqual(feats["is_edge"], float(r in (0, n - 1) or c in (0, n - 1)), cell)
            self.assertEqual(feats["is_corner"], float(r in (0, n - 1) and c in (0, n - 1)), cell)
            self.assertAlmostEqual(feats["path_frac"], i / (len(sol) - 1), delta=TOL, msg=str(cell))

    def test_cells_at_or_after_last_dot_have_no_leg(self) -> None:
        # 2x2 board, path (0,0) (0,1) (1,1) (1,0); dots only on the first two cells,
        # so (0,1) is the last dot and (1,1), (1,0) trail after it.
        p = {"id": "trailing", "n": 2, "dots": [[0, 0, 1], [0, 1, 2]],
             "solution": [[0, 0], [0, 1], [1, 1], [1, 0]]}
        cells = cell_features(p)
        self.assertEqual((cells[(0, 0)]["dist_to_next_dot"], cells[(0, 0)]["segment_len"]), (1.0, 1.0))
        for cell in [(0, 1), (1, 1), (1, 0)]:
            self.assertEqual((cells[cell]["dist_to_next_dot"], cells[cell]["segment_len"]), (0.0, 0.0), cell)

    def test_ranges(self) -> None:
        for p in PUZZLES:
            for feats in cell_features(p).values():
                self.assertTrue(0.0 <= feats["path_frac"] <= 1.0)
                self.assertTrue(feats["dist_to_next_dot"] <= feats["segment_len"])
                for k in ("is_edge", "is_corner", "is_turn"):
                    self.assertIn(feats[k], (0.0, 1.0))


class DegenerateBoardTests(unittest.TestCase):
    FEW_DOTS = {"id": "one-dot", "n": 2, "dots": [[0, 0, 1]], "solution": [[0, 0], [0, 1], [1, 1], [1, 0]]}
    ONE_CELL = {"id": "one-cell", "n": 1, "dots": [[0, 0, 1]], "solution": [[0, 0]]}

    def test_fewer_than_two_dots_raises(self) -> None:
        for fn in (puzzle_features, cell_features):
            with self.assertRaisesRegex(ValueError, r"one-dot.*at least 2 dots"):
                fn(self.FEW_DOTS)

    def test_single_cell_board_raises(self) -> None:
        for fn in (puzzle_features, cell_features):
            with self.assertRaisesRegex(ValueError, r"one-cell.*single-cell"):
                fn(self.ONE_CELL)


class TestVectorTests(unittest.TestCase):
    """ml/test_vectors.json is the cross-language contract for the TypeScript port."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.data = json.loads(TEST_VECTORS.read_text())

    def test_header_matches_contract(self) -> None:
        self.assertEqual(self.data["puzzle_features"], PUZZLE_FEATURES)
        self.assertEqual(self.data["cell_features"], CELL_FEATURES)
        self.assertEqual(len(self.data["vectors"]), 5)

    def test_expected_features_match_recomputed(self) -> None:
        by_id = {p["id"]: p for p in PUZZLES}
        for v in self.data["vectors"]:
            p = by_id[v["id"]]
            self.assertEqual(v["dots"], p["dots"], v["id"])
            self.assertEqual(v["solution"], p["solution"], v["id"])

            got = puzzle_features(p)
            self.assertEqual(list(v["puzzle_features"]), PUZZLE_FEATURES, v["id"])
            for k in PUZZLE_FEATURES:
                self.assertAlmostEqual(v["puzzle_features"][k], got[k], delta=TOL, msg=f"{v['id']} {k}")

            cells = cell_features(p)
            self.assertEqual([tuple(c["cell"]) for c in v["cells"]], [tuple(c) for c in p["solution"]], v["id"])
            for entry in v["cells"]:
                cell = tuple(entry["cell"])
                self.assertEqual(list(entry["features"]), CELL_FEATURES, f"{v['id']} {cell}")
                for k in CELL_FEATURES:
                    self.assertAlmostEqual(entry["features"][k], cells[cell][k], delta=TOL, msg=f"{v['id']} {cell} {k}")

    def test_expected_predictions_match_recomputed(self) -> None:
        from ml.predict import log_time, predict_time, stuck_scores, stuck_top

        model, player = self.data["model"], self.data["player_id"]
        by_id = {p["id"]: p for p in PUZZLES}
        for v in self.data["vectors"]:
            p = by_id[v["id"]]
            self.assertAlmostEqual(v["time"]["log_value"], log_time(model, p), delta=TOL)
            self.assertAlmostEqual(v["time"]["value"], predict_time(model, p), delta=TOL)
            self.assertAlmostEqual(v["time"]["value_for_player"], predict_time(model, p, player), delta=TOL)
            scores = [s for _, s in stuck_scores(model, p)]
            self.assertEqual(len(v["stuck"]["scores"]), len(scores))
            for want, got in zip(v["stuck"]["scores"], scores):
                self.assertAlmostEqual(want, got, delta=TOL)
            self.assertEqual([tuple(c) for c in v["stuck"]["top3"]], stuck_top(model, p))

    def test_file_is_up_to_date(self) -> None:
        from ml.make_test_vectors import build

        self.assertEqual(json.loads(json.dumps(build())), self.data)


if __name__ == "__main__":
    unittest.main()
