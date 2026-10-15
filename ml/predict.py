"""Predictions from a model.json dict. Python mirror of web/lib/predict.ts (same formula, same tie rule).

Used to write the expected predictions in ml/test_vectors.json, which the TS side must match within 1e-6.
"""
from __future__ import annotations

import math
from typing import Any

from ml.features import CELL_FEATURES, PUZZLE_FEATURES, Cell, cell_features, puzzle_features

TOP_K = 3


def log_time(model: dict[str, Any], puzzle: dict[str, Any], player_id: str | None = None) -> float:
    """intercept + sum(coef * x) + players[player_id] (0 for unknown players). Units follow trained_on.label."""
    t = model["time"]
    f = puzzle_features(puzzle)
    z = t["intercept"] + sum(t["coef"][k] * f[k] for k in PUZZLE_FEATURES)
    return z + (model["players"].get(player_id, 0.0) if player_id is not None else 0.0)


def predict_time(model: dict[str, Any], puzzle: dict[str, Any], player_id: str | None = None) -> float:
    """ms when trained_on.label is human_time, solver steps when it is solver_effort."""
    return math.exp(log_time(model, puzzle, player_id))


def stuck_scores(model: dict[str, Any], puzzle: dict[str, Any]) -> list[tuple[Cell, float]]:
    """Log-odds per cell in solution order; empty when the stuck block has no coefficients."""
    s = model["stuck"]
    if not s["coef"]:
        return []
    feats = cell_features(puzzle)
    cells = [(r, c) for r, c in puzzle["solution"]]
    return [(cell, s["intercept"] + sum(s["coef"][k] * feats[cell][k] for k in CELL_FEATURES)) for cell in cells]


def stuck_top(model: dict[str, Any], puzzle: dict[str, Any], k: int = TOP_K) -> list[Cell]:
    return [cell for cell, _ in sorted(stuck_scores(model, puzzle), key=lambda cs: -cs[1])[:k]]
