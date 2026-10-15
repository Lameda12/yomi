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
)

PUZZLES = load_puzzles()
TEST_VECTORS = Path(__file__).resolve().parent / "test_vectors.json"
TOL = 1e-6


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

    def test_solver_steps_is_deterministic(self) -> None:
        p = PUZZLES[0]
        self.assertEqual(puzzle_features(p)["solver_steps"], puzzle_features(p)["solver_steps"])


class CellFeatureTests(unittest.TestCase):
    def test_every_path_cell_has_all_features(self) -> None:
        for p in PUZZLES:
            cells = cell_features(p)
            self.assertEqual(len(cells), p["n"] ** 2, p["id"])
            for feats in cells.values():
                self.assertEqual(list(feats), CELL_FEATURES)

    def test_known_puzzle(self) -> None:
        p = next(q for q in PUZZLES if q["id"] == "zip-5x5-01")
        cells = cell_features(p)
        # Path starts on dot 1 at (1,3); dot 2 at (1,4) is one step away.
        self.assertEqual(cells[(1, 3)]["dist_to_next_dot"], 1.0)
        self.assertEqual(cells[(1, 3)]["path_frac"], 0.0)
        # (0,4) sits between dot 2 (index 1) and dot 3 at (0,0) (index 6): 5-step leg, 4 steps to go.
        self.assertEqual(cells[(0, 4)]["segment_len"], 5.0)
        self.assertEqual(cells[(0, 4)]["dist_to_next_dot"], 5.0 - 1.0)
        self.assertEqual(cells[(0, 4)]["is_corner"], 1.0)
        self.assertEqual(cells[(0, 4)]["is_turn"], 1.0)
        # Interior cell.
        self.assertEqual(cells[(1, 1)]["is_edge"], 0.0)
        self.assertEqual(cells[(3, 1)]["path_frac"], 1.0)

    def test_ranges(self) -> None:
        for p in PUZZLES:
            for feats in cell_features(p).values():
                self.assertTrue(0.0 <= feats["path_frac"] <= 1.0)
                self.assertTrue(feats["dist_to_next_dot"] <= feats["segment_len"])
                for k in ("is_edge", "is_corner", "is_turn"):
                    self.assertIn(feats[k], (0.0, 1.0))


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


if __name__ == "__main__":
    unittest.main()
