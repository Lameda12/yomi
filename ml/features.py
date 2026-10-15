"""Puzzle and cell features for the Yomi models (see "Model contract" in CLAUDE.md).

A puzzle is a dict shaped like an entry of web/data/puzzles.json:
    {"id": str, "n": int, "dots": [[row, col, label], ...], "solution": [[row, col], ...]}

Puzzle features describe the whole board and feed the solve-time model.
Cell features describe one cell of the solution path and feed the stuck-point model.
Feature names and order must match `puzzle_features` / `cell_features` in model.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from prep_datasets import zip_solutions  # noqa: E402  (same solver as the puzzle generator)

PUZZLES_JSON = ROOT / "web" / "data" / "puzzles.json"

PUZZLE_FEATURES = ["grid_size", "n_dots", "max_gap", "mean_gap", "turns", "solver_steps"]
CELL_FEATURES = ["dist_to_next_dot", "is_edge", "is_corner", "is_turn", "segment_len", "path_frac"]

Puzzle = dict[str, Any]
Cell = tuple[int, int]


def load_puzzles(path: Path = PUZZLES_JSON) -> list[Puzzle]:
    return json.loads(path.read_text())


def _solution(puzzle: Puzzle) -> list[Cell]:
    return [(r, c) for r, c in puzzle["solution"]]


def _dot_indices(puzzle: Puzzle) -> list[int]:
    """Index in the solution path of each dot, ordered by dot label (1, 2, 3, ...)."""
    where = {cell: i for i, cell in enumerate(_solution(puzzle))}
    return [where[(r, c)] for r, c, _ in sorted(puzzle["dots"], key=lambda d: d[2])]


def _is_turn(path: list[Cell], i: int) -> bool:
    if i == 0 or i == len(path) - 1:
        return False
    (r0, c0), (r1, c1), (r2, c2) = path[i - 1], path[i], path[i + 1]
    return (r1 - r0, c1 - c0) != (r2 - r1, c2 - c1)


def solver_steps(puzzle: Puzzle) -> int:
    """Search steps of the uniqueness solver (cap=2, default budget).

    If the budget runs out the solver reports budget + 1, so this is capped, never missing.
    """
    dots = {(r, c): label for r, c, label in puzzle["dots"]}
    steps: list[int] = []
    zip_solutions(puzzle["n"], dots, steps_out=steps)
    return steps[0]


def puzzle_features(puzzle: Puzzle) -> dict[str, float]:
    """Board-level features, keyed by the names in PUZZLE_FEATURES.

    gap = path distance between consecutive dots. mean_gap is not rounded
    (puzzles.json stores it rounded to 2 decimals; the model uses the exact value).
    """
    path = _solution(puzzle)
    idx = _dot_indices(puzzle)
    gaps = [b - a for a, b in zip(idx, idx[1:])]
    return {
        "grid_size": float(puzzle["n"]),
        "n_dots": float(len(puzzle["dots"])),
        "max_gap": float(max(gaps)),
        "mean_gap": sum(gaps) / len(gaps),
        "turns": float(sum(_is_turn(path, i) for i in range(len(path)))),
        "solver_steps": float(solver_steps(puzzle)),
    }


def cell_features(puzzle: Puzzle) -> dict[Cell, dict[str, float]]:
    """Features for every cell on the solution path, keyed by (row, col).

    - dist_to_next_dot: path steps from this cell to the next dot after it (0 past the last dot).
    - segment_len: path steps between the dots on either side of the cell (the cell's "leg").
      Cells after the last dot count as their own leg back to it, and are 0 if there are none.
    - path_frac: position along the solution, 0 at the start and 1 at the end.
    """
    path = _solution(puzzle)
    n = puzzle["n"]
    last = len(path) - 1
    idx = _dot_indices(puzzle)
    out: dict[Cell, dict[str, float]] = {}
    for i, (r, c) in enumerate(path):
        nxt = next((d for d in idx if d > i), None)
        prev = max((d for d in idx if d <= i), default=0)
        on_edge_r = r in (0, n - 1)
        on_edge_c = c in (0, n - 1)
        out[(r, c)] = {
            "dist_to_next_dot": float(nxt - i) if nxt is not None else 0.0,
            "is_edge": float(on_edge_r or on_edge_c),
            "is_corner": float(on_edge_r and on_edge_c),
            "is_turn": float(_is_turn(path, i)),
            "segment_len": float(nxt - prev) if nxt is not None else 0.0,
            "path_frac": i / last,
        }
    return out


def puzzle_vector(puzzle: Puzzle) -> list[float]:
    f = puzzle_features(puzzle)
    return [f[k] for k in PUZZLE_FEATURES]


def cell_vector(feats: dict[str, float]) -> list[float]:
    return [feats[k] for k in CELL_FEATURES]


if __name__ == "__main__":
    for p in load_puzzles()[:3]:
        print(p["id"], puzzle_features(p))
