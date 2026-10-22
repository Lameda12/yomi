"""Stuck-point model: logistic regression per cell, top 3 cells are the prediction.

Run it through `python -m ml.pipeline` (trains, evaluates and exports both models).

Model contract (CLAUDE.md "Model contract"):
    score(cell) = intercept + sum(coef[f] * x[f])   with raw (unstandardized) coefficients
Label: for each completed human solve, 1 for the cell where the player's longest pause happened
(server-derived `stuck_cell`), 0 for every other cell on the puzzle's solution path.

A stuck cell can be off the solution path (the player paused after a wrong turn). Cell features only
exist for solution cells, so those solves are dropped from the stuck fit and counted in `n_dropped`.

With fewer than MIN_STUCK_SOLVES usable solves the model is NOT fitted: it stays untrained
(intercept 0, empty coef) and the app must not show a stuck prediction.
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.features import CELL_FEATURES, cell_features  # noqa: E402
from ml.train_time import EXCLUDED_ROW_IDS, human_records  # noqa: E402

MIN_STUCK_SOLVES = 30  # same floor as the time model's human-solve rule
DEFAULT_L2 = 1.0  # penalty on standardized coefficients; not tuned
TOP_K = 3

Cell = tuple[int, int]
# One completed human solve: (player_id, puzzle_id, stuck cell or None).
StuckSolve = tuple[str, str, Cell | None]


@dataclass
class StuckModel:
    intercept: float = 0.0
    coef: dict[str, float] = field(default_factory=dict)  # empty = untrained
    n_solves: int = 0  # solves used in the fit
    n_dropped: int = 0  # solves left out: no stuck cell, or stuck cell off the solution path

    @property
    def trained(self) -> bool:
        return bool(self.coef)


# ---------- data --------------------------------------------------------------

def _parse_cell(value: Any) -> Cell | None:
    """stuck_cell arrives as [row, col], None or NaN depending on the source."""
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return int(value[0]), int(value[1])
    return None


def stuck_solves_from_frame(df: Any, puzzle_ids: set[str], exclude_players: Iterable[str] = (),
                            exclude_ids: Iterable[str] = EXCLUDED_ROW_IDS) -> list[StuckSolve]:
    """Completed human solves (same filter as the time model) with their stuck cell."""
    return [(str(r["player_id"]), str(r["puzzle_id"]), _parse_cell(r.get("stuck_cell")))
            for r in human_records(df, puzzle_ids, exclude_players, exclude_ids)]


def cell_table(puzzle: dict[str, Any]) -> tuple[list[Cell], np.ndarray]:
    """Solution cells in path order and their feature matrix (columns = CELL_FEATURES)."""
    feats = cell_features(puzzle)
    cells = list(feats)
    return cells, np.array([[feats[c][f] for f in CELL_FEATURES] for c in cells], dtype=float)


def build_rows(solves: Sequence[StuckSolve], puzzles: dict[str, dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, int, int]:
    """One row per (solve, solution cell). Returns (x, y, solves_used, solves_dropped)."""
    tables: dict[str, tuple[list[Cell], np.ndarray]] = {}
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    used = dropped = 0
    for _, pid, stuck in solves:
        if pid not in tables:
            tables[pid] = cell_table(puzzles[pid])
        cells, x = tables[pid]
        if stuck is None or stuck not in cells:
            dropped += 1
            continue
        y = np.zeros(len(cells))
        y[cells.index(stuck)] = 1.0
        xs.append(x)
        ys.append(y)
        used += 1
    if not xs:
        return np.empty((0, len(CELL_FEATURES))), np.empty(0), 0, dropped
    return np.vstack(xs), np.concatenate(ys), used, dropped


# ---------- math --------------------------------------------------------------

def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35.0, 35.0)))


def fit_logistic(x: np.ndarray, y: np.ndarray, l2: float = DEFAULT_L2, iters: int = 50) -> tuple[float, np.ndarray]:
    """L2-penalized logistic regression by Newton steps. Returns (intercept, raw coefficients).

    Features are standardized for the fit and folded back into raw coefficients, like fit_ridge.
    The intercept is not penalized. A constant column gets coefficient 0.
    """
    if x.ndim != 2 or len(x) != len(y) or len(y) == 0:
        raise ValueError(f"need x of shape (n, p) and y of length n > 0, got {x.shape} and {y.shape}")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1.0
    xs = np.column_stack([np.ones(len(x)), (x - mean) / scale])
    penalty = l2 * np.eye(xs.shape[1])
    penalty[0, 0] = 0.0
    w = np.zeros(xs.shape[1])
    for _ in range(iters):
        p = _sigmoid(xs @ w)
        grad = xs.T @ (p - y) + penalty @ w
        hess = (xs.T * (p * (1 - p))) @ xs + penalty + 1e-9 * np.eye(len(w))
        step = np.linalg.solve(hess, grad)
        w -= step
        if float(np.abs(step).max()) < 1e-10:
            break
    coef = w[1:] / scale
    return float(w[0] - mean @ coef), coef


# ---------- training and prediction ------------------------------------------

def train_stuck(solves: Sequence[StuckSolve], puzzles: Sequence[dict[str, Any]], l2: float = DEFAULT_L2) -> StuckModel:
    """Fit the stuck model, or return an untrained one below MIN_STUCK_SOLVES usable solves."""
    by_id = {p["id"]: p for p in puzzles}
    x, y, used, dropped = build_rows(solves, by_id)
    if used < MIN_STUCK_SOLVES:
        return StuckModel(n_solves=used, n_dropped=dropped)
    intercept, beta = fit_logistic(x, y, l2)
    if not math.isfinite(intercept) or not np.all(np.isfinite(beta)):
        return StuckModel(n_solves=used, n_dropped=dropped)
    return StuckModel(intercept, {f: float(b) for f, b in zip(CELL_FEATURES, beta)}, used, dropped)


def score_cells(model: StuckModel, puzzle: dict[str, Any]) -> dict[Cell, float]:
    """Logistic score per solution cell. Empty for an untrained model."""
    if not model.trained:
        return {}
    cells, x = cell_table(puzzle)
    beta = np.array([model.coef[f] for f in CELL_FEATURES])
    return dict(zip(cells, (float(s) for s in model.intercept + x @ beta)))


def top_cells(model: StuckModel, puzzle: dict[str, Any], k: int = TOP_K) -> list[Cell]:
    """The k highest-scoring cells (ties broken by path order). Empty for an untrained model."""
    scores = score_cells(model, puzzle)
    order = {c: i for i, c in enumerate(scores)}
    return sorted(scores, key=lambda c: (-scores[c], order[c]))[:k]
