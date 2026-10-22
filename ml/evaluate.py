"""Leave-one-player-out evaluation for the time and stuck models.

Each real player is held out in turn: the models are fitted on everyone else and scored on the
held-out player's solves. Held-out players have no offset (the model has never seen them), which is
exactly what a new visitor looks like.

Time:  share of solves predicted within 20% of the real time (form target), and median absolute %
       error, against a "mean time" baseline (predict the training mean in ms).
Stuck: top-3 hit rate (form target 60%) against a random-3-cells baseline. The baseline is the exact
       expected hit rate of picking 3 distinct cells uniformly, min(3, n_cells) / n_cells per solve.

A fold is only scored when its training part is large enough for the model to fit on human data
(the same 30-solve floor the models use). If that never holds the result is "skipped" with the
reason, never a made-up number.
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.features import PUZZLE_FEATURES, puzzle_features  # noqa: E402
from ml.train_stuck import MIN_STUCK_SOLVES, TOP_K, StuckSolve, cell_table, top_cells, train_stuck  # noqa: E402
from ml.train_time import LABEL_HUMAN, MIN_HUMAN_SOLVES, Solve, train  # noqa: E402

WITHIN = 0.20  # a time prediction counts as a hit when it is within 20% of the real time
STUCK_TARGET = 0.60


@dataclass
class Result:
    status: str  # "scored" | "skipped"
    reason: str = ""
    n_solves: int = 0  # held-out solves actually scored
    n_players: int = 0  # players scored
    metrics: dict[str, float] = field(default_factory=dict)


def _skip(reason: str) -> Result:
    return Result("skipped", reason)


def eval_time(solves: Sequence[Solve], puzzles: Sequence[dict[str, Any]]) -> Result:
    players = sorted({p for p, _, _ in solves})
    if len(players) < 2:
        return _skip(f"leave-one-player-out needs 2+ players, have {len(players)}")
    feats = {p["id"]: puzzle_features(p) for p in puzzles}
    actual: list[float] = []
    model_pred: list[float] = []
    base_pred: list[float] = []
    scored_players = 0
    for held in players:
        train_s = [s for s in solves if s[0] != held]
        test_s = [s for s in solves if s[0] == held]
        if len(train_s) < MIN_HUMAN_SOLVES:
            continue  # train() would fall back to the solver label; that cannot predict milliseconds
        model = train(train_s, puzzles)
        if model.label != LABEL_HUMAN:
            continue
        mean_ms = float(np.mean([ms for _, _, ms in train_s]))
        for _, pid, ms in test_s:
            z = model.intercept + sum(model.coef[f] * feats[pid][f] for f in PUZZLE_FEATURES)
            actual.append(ms)
            model_pred.append(math.exp(z))
            base_pred.append(mean_ms)
        scored_players += 1
    if not actual:
        return _skip(f"no fold had {MIN_HUMAN_SOLVES}+ training solves from other players ({len(solves)} solves total)")
    a = np.array(actual)

    def stats(pred: list[float]) -> tuple[float, float]:
        err = np.abs(np.array(pred) - a) / a
        return float((err <= WITHIN).mean()), float(np.median(err))

    m_within, m_mdape = stats(model_pred)
    b_within, b_mdape = stats(base_pred)
    return Result("scored", "", len(a), scored_players, {
        "within20": m_within, "median_abs_pct_err": m_mdape,
        "baseline_within20": b_within, "baseline_median_abs_pct_err": b_mdape,
    })


def eval_stuck(solves: Sequence[StuckSolve], puzzles: Sequence[dict[str, Any]]) -> Result:
    players = sorted({p for p, _, _ in solves})
    if len(players) < 2:
        return _skip(f"leave-one-player-out needs 2+ players, have {len(players)}")
    by_id = {p["id"]: p for p in puzzles}
    hits: list[float] = []
    base: list[float] = []
    scored_players = 0
    for held in players:
        train_s = [s for s in solves if s[0] != held]
        model = train_stuck(train_s, puzzles)
        if not model.trained:
            continue  # fewer than MIN_STUCK_SOLVES usable training solves
        counted = False
        for _, pid, cell in (s for s in solves if s[0] == held):
            cells, _ = cell_table(by_id[pid])
            if cell is None or cell not in cells:
                continue  # stuck cell off the solution path: no feature row to rank
            hits.append(float(cell in top_cells(model, by_id[pid])))
            base.append(min(TOP_K, len(cells)) / len(cells))
            counted = True
        scored_players += counted
    if not hits:
        return _skip(f"no fold had {MIN_STUCK_SOLVES}+ usable training solves from other players ({len(solves)} solves total)")
    return Result("scored", "", len(hits), scored_players, {
        "top3_hit_rate": float(np.mean(hits)), "baseline_top3_hit_rate": float(np.mean(base)),
    })
