"""Stuck-point model: logistic regression per cell, top 3 cells are the prediction.

Run from the repo root:  .venv/bin/python -m ml.train_stuck [--source auto|neon|jsonl]

Model contract (CLAUDE.md "Model contract"):
    score(cell) = intercept + sum(coef[f] * x[f])   over cell_features
    prediction  = the 3 cells with the highest score (ties: earlier in solution order first)
with raw (unstandardized) coefficients, so the TypeScript side needs no scaler.

Label: one row per cell of the puzzle for every completed human solve; the cell where the
path head sat during the longest pause is 1, every other cell is 0. Same rule as
web/lib/stuck.ts findStuck (ties keep the earliest pause).

Below MIN_LABELED_SOLVES labeled solves there is nothing worth fitting: train() returns an
unfitted model, model.json gets an empty stuck block, and predict.ts shows no stuck cells.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.features import CELL_FEATURES, Cell, cell_features, load_puzzles  # noqa: E402
from ml.train_time import EXCLUDED_ROW_IDS, log  # noqa: E402

MIN_LABELED_SOLVES = 30  # below this, skip the fit and write no stuck coefficients
DEFAULT_ALPHA = 1.0  # L2 penalty on standardized features; not tuned
TOP_K = 3

# One labeled solve: (player_id, puzzle_id, stuck cell).
StuckSolve = tuple[str, str, Cell]


@dataclass
class StuckModel:
    intercept: float = 0.0
    coef: dict[str, float] = field(default_factory=dict)  # raw coefficients; empty = not fitted
    labeled_solves: int = 0
    n_train_rows: int = 0

    @property
    def fitted(self) -> bool:
        return bool(self.coef)


# ---------- label -------------------------------------------------------------

def longest_pause_cell(events: Sequence[Sequence[float]]) -> Cell | None:
    """Head cell before the longest gap between events. Port of findStuck in web/lib/stuck.ts."""
    best: Cell | None = None
    best_gap: float | None = None
    for a, b in zip(events, events[1:]):
        gap = b[0] - a[0]
        if best_gap is None or gap > best_gap:
            best_gap, best = gap, (int(a[1]), int(a[2]))
    return best


# ---------- math --------------------------------------------------------------

def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35.0, 35.0)))


def fit_logistic(x: np.ndarray, y: np.ndarray, alpha: float = DEFAULT_ALPHA,
                 max_iter: int = 100, tol: float = 1e-10) -> tuple[float, np.ndarray]:
    """L2 logistic regression with an unpenalized intercept, fitted by Newton's method.

    Features are standardized for the fit and the scaler is folded back, so scores are
    `intercept + x @ coef` on raw inputs. A constant column gets coefficient 0.
    """
    if x.ndim != 2 or len(x) != len(y) or len(y) == 0:
        raise ValueError(f"need x of shape (n, p) and y of length n > 0, got {x.shape} and {y.shape}")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    const = scale == 0
    scale[const] = 1.0
    xs = np.column_stack([np.ones(len(x)), (x - mean) / scale])
    penalty = np.full(xs.shape[1], alpha)
    penalty[0] = 0.0
    beta = np.zeros(xs.shape[1])
    for _ in range(max_iter):
        p = _sigmoid(xs @ beta)
        grad = xs.T @ (p - y) + penalty * beta
        hess = (xs.T * (p * (1 - p))) @ xs + np.diag(penalty) + 1e-12 * np.eye(len(beta))
        step = np.linalg.solve(hess, grad)
        beta -= step
        if float(np.max(np.abs(step))) < tol:
            break
    coef = beta[1:] / scale
    coef[const] = 0.0
    return float(beta[0] - mean @ coef), coef


# ---------- data --------------------------------------------------------------

def _events(value: Any) -> list[list[float]] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return [list(e) for e in value]
    except TypeError:
        return None


def labeled_solves_from_frame(df: Any, puzzles: dict[str, dict[str, Any]], exclude_players: Iterable[str] = (),
                              exclude_ids: Iterable[str] = EXCLUDED_ROW_IDS) -> list[StuckSolve]:
    """Completed human solves with a usable longest-pause cell. Same filters as the time model.

    The label is recomputed from `events` (not the stored stuck_cell) so every row uses one rule.
    """
    if df is None or len(df) == 0:
        return []
    excluded = set(exclude_players)
    excluded_ids = set(map(str, exclude_ids))
    out: list[StuckSolve] = []
    for row in df.to_dict("records"):
        if not row.get("completed"):
            continue
        pid, puzzle_id = str(row["player_id"]), str(row["puzzle_id"])
        if pid in excluded or str(row.get("id")) in excluded_ids or puzzle_id not in puzzles:
            continue
        events = _events(row.get("events"))
        cell = longest_pause_cell(events) if events else None
        n = puzzles[puzzle_id]["n"]
        if cell is None or not (0 <= cell[0] < n and 0 <= cell[1] < n):
            continue
        out.append((pid, puzzle_id, cell))
    return out


# ---------- training and prediction -------------------------------------------

def _design(puzzle: dict[str, Any]) -> tuple[list[Cell], np.ndarray]:
    feats = cell_features(puzzle)
    cells = [(r, c) for r, c in puzzle["solution"]]
    return cells, np.array([[feats[cell][f] for f in CELL_FEATURES] for cell in cells])


def train(solves: Sequence[StuckSolve], puzzles: Sequence[dict[str, Any]],
          alpha: float = DEFAULT_ALPHA) -> StuckModel:
    """Fit the stuck model, or return an unfitted one below MIN_LABELED_SOLVES."""
    if len(solves) < MIN_LABELED_SOLVES:
        return StuckModel(labeled_solves=len(solves))
    by_id = {p["id"]: p for p in puzzles}
    design = {pid: _design(by_id[pid]) for pid in {s[1] for s in solves}}
    xs, ys = [], []
    for _, puzzle_id, stuck in solves:
        cells, x = design[puzzle_id]
        xs.append(x)
        ys.append(np.array([1.0 if cell == stuck else 0.0 for cell in cells]))
    x, y = np.vstack(xs), np.concatenate(ys)
    intercept, beta = fit_logistic(x, y, alpha)
    return StuckModel(intercept, {f: float(b) for f, b in zip(CELL_FEATURES, beta)}, len(solves), len(y))


def cell_scores(model: StuckModel, puzzle: dict[str, Any]) -> list[tuple[Cell, float]]:
    """Logistic score (log-odds) of every cell, in solution order. Empty if the model is not fitted."""
    if not model.fitted:
        return []
    cells, x = _design(puzzle)
    w = np.array([model.coef[f] for f in CELL_FEATURES])
    return [(cell, float(model.intercept + row @ w)) for cell, row in zip(cells, x)]


def top_cells(model: StuckModel, puzzle: dict[str, Any], k: int = TOP_K) -> list[Cell]:
    """The k highest-scoring cells. Ties keep solution order (sorted() is stable)."""
    scored = cell_scores(model, puzzle)
    return [cell for cell, _ in sorted(scored, key=lambda cs: -cs[1])[:k]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", choices=("auto", "neon", "jsonl"), default="auto")
    ap.add_argument("--exclude-player", action="append", default=[], metavar="UUID",
                    help="drop this player's rows (test/fake data); repeatable")
    ap.add_argument("--alpha", type=float, default=DEFAULT_ALPHA)
    ap.add_argument("--out", type=Path, default=None, help="model.json path (default web/public/model.json)")
    args = ap.parse_args()

    from ml.export import MODEL_JSON, set_stuck_block
    from ml.train_time import load_frame

    puzzles = load_puzzles()
    df = load_frame(args.source)
    solves = labeled_solves_from_frame(df, {p["id"]: p for p in puzzles}, args.exclude_player)
    model = train(solves, puzzles, args.alpha)

    print(f"labeled solves (completed, with a longest pause): {model.labeled_solves} "
          f"from {len({s[0] for s in solves})} player(s)")
    if not model.fitted:
        print(f"skipped the fit: fewer than {MIN_LABELED_SOLVES} labeled solves. "
              "No stuck coefficients written; the game shows no stuck prediction.")
    else:
        print(f"intercept: {model.intercept:.4f}  (rows: {model.n_train_rows})")
        for name in CELL_FEATURES:
            print(f"  {name:16s} {model.coef[name]:+.5f}")

    path = set_stuck_block(model, args.out or MODEL_JSON)
    print(f"updated stuck block in {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
