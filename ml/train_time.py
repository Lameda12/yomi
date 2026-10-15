"""Solve-time model: ridge regression on log(solve_ms) plus a shrunk per-player offset.

Run from the repo root:  .venv/bin/python -m ml.train_time [--source auto|neon|jsonl]

Model contract (CLAUDE.md "Model contract"):
    predicted ms = exp(intercept + sum(coef[f] * x[f]) + players.get(player_id, 0))
with raw (unstandardized) coefficients, so the TypeScript side needs no scaler.

Label rule: with fewer than MIN_HUMAN_SOLVES completed human solves there is not enough
data to learn from people, so the model is fitted on the solver's search effort
(log of solver_steps, one row per puzzle) instead and labelled "solver_effort".
In that mode the output is in solver steps, NOT milliseconds, and there are no
player offsets. Say so wherever the prediction is shown.
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.features import PUZZLE_FEATURES, load_puzzles, puzzle_features  # noqa: E402

MIN_HUMAN_SOLVES = 30  # below this, fit on solver_steps as a stand-in label
SHRINK_K = 3  # player offset is shrunk by n / (n + SHRINK_K)
DEFAULT_ALPHA = 1.0  # ridge penalty on standardized features; not tuned (evaluation is task 6)
LABEL_HUMAN = "human_time"
LABEL_SOLVER = "solver_effort"

# One completed human solve: (player_id, puzzle_id, solve_ms).
Solve = tuple[str, str, float]


@dataclass
class TimeModel:
    intercept: float
    coef: dict[str, float]  # raw coefficients, keyed by PUZZLE_FEATURES
    residual_std: float
    players: dict[str, float] = field(default_factory=dict)
    label: str = LABEL_SOLVER
    human_solves: int = 0
    n_train_rows: int = 0


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------- math --------------------------------------------------------------

def fit_ridge(x: np.ndarray, y: np.ndarray, alpha: float = DEFAULT_ALPHA) -> tuple[float, np.ndarray]:
    """Ridge regression with an unpenalized intercept. Returns (intercept, raw coefficients).

    Features are standardized for the fit (so alpha treats them equally) and the scaler is folded
    back into raw coefficients, so predictions are `intercept + x @ coef` on unscaled inputs.
    A constant column gets coefficient 0.
    """
    if x.ndim != 2 or len(x) != len(y) or len(y) == 0:
        raise ValueError(f"need x of shape (n, p) and y of length n > 0, got {x.shape} and {y.shape}")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1.0
    xs = (x - mean) / scale
    y_mean = float(y.mean())
    p = x.shape[1]
    beta = np.linalg.solve(xs.T @ xs + alpha * np.eye(p), xs.T @ (y - y_mean))
    coef = beta / scale
    return y_mean - float(mean @ coef), coef


def player_offsets(player_ids: Sequence[str], residuals: np.ndarray, k: float = SHRINK_K) -> dict[str, float]:
    """Per-player mean residual, shrunk toward 0 by n / (n + k)."""
    by_player: dict[str, list[float]] = {}
    for pid, r in zip(player_ids, residuals):
        by_player.setdefault(pid, []).append(float(r))
    return {pid: (sum(rs) / len(rs)) * len(rs) / (len(rs) + k) for pid, rs in by_player.items()}


def _std(values: np.ndarray) -> float:
    return float(values.std(ddof=1)) if len(values) > 1 else 0.0


# ---------- data --------------------------------------------------------------

def solves_from_frame(df: Any, puzzle_ids: set[str], exclude_players: Iterable[str] = ()) -> list[Solve]:
    """Keep completed solves from real humans. `df` is what analysis.load_solves returns.

    The schema has no "test row" marker, so test and fake rows are dropped by player id
    (`exclude_players`); delete fake rows from the database after a test, as CLAUDE.md says.
    Rows that cannot be a real timed solve (no time, unknown puzzle) are dropped too.
    """
    if df is None or len(df) == 0:
        return []
    excluded = set(exclude_players)
    out: list[Solve] = []
    for row in df.to_dict("records"):
        ms = row.get("solve_ms")
        if not row.get("completed") or ms is None or not math.isfinite(float(ms)) or float(ms) <= 0:
            continue
        pid, puzzle = str(row["player_id"]), str(row["puzzle_id"])
        if pid in excluded or puzzle not in puzzle_ids:
            continue
        out.append((pid, puzzle, float(ms)))
    return out


def load_training_solves(source: str, puzzle_ids: set[str], exclude_players: Iterable[str] = ()) -> list[Solve]:
    """Same switch as analysis.py: Neon if DATABASE_URL is set, else data/solves.jsonl."""
    import analysis  # reuse its loader and its solve_id dedupe

    if source == "auto":
        source = "neon" if analysis.database_url() else "jsonl"
    log(f"[train_time] reading solves from {source}")
    df = analysis.load_solves(source, ROOT / "data" / "solves.csv")
    return solves_from_frame(df, puzzle_ids, exclude_players)


# ---------- training ----------------------------------------------------------

def train(solves: Sequence[Solve], puzzles: Sequence[dict[str, Any]], alpha: float = DEFAULT_ALPHA) -> TimeModel:
    """Fit the time model. `solves` must already be completed human solves only."""
    feats = {p["id"]: puzzle_features(p) for p in puzzles}
    n_human = len(solves)

    if n_human < MIN_HUMAN_SOLVES:
        # Stand-in label: log(solver_steps), one row per puzzle. solver_steps is the label here, so it
        # is left out of the features (its coefficient is 0), otherwise the model would just read the answer.
        names = [f for f in PUZZLE_FEATURES if f != "solver_steps"]
        x = np.array([[feats[p["id"]][f] for f in names] for p in puzzles])
        y = np.log(np.array([feats[p["id"]]["solver_steps"] for p in puzzles]))
        intercept, beta = fit_ridge(x, y, alpha)
        coef = {f: 0.0 for f in PUZZLE_FEATURES}
        coef.update(zip(names, (float(b) for b in beta)))
        resid = y - (intercept + x @ beta)
        return TimeModel(float(intercept), coef, _std(resid), {}, LABEL_SOLVER, n_human, len(y))

    x = np.array([[feats[pid][f] for f in PUZZLE_FEATURES] for _, pid, _ in solves])
    y = np.log(np.array([ms for _, _, ms in solves]))
    intercept, beta = fit_ridge(x, y, alpha)
    resid = y - (intercept + x @ beta)
    players = player_offsets([p for p, _, _ in solves], resid)
    after = resid - np.array([players[p] for p, _, _ in solves])
    coef = {f: float(b) for f, b in zip(PUZZLE_FEATURES, beta)}
    return TimeModel(float(intercept), coef, _std(after), players, LABEL_HUMAN, n_human, len(y))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", choices=("auto", "neon", "jsonl"), default="auto")
    ap.add_argument("--exclude-player", action="append", default=[], metavar="UUID",
                    help="drop this player's rows (test/fake data); repeatable")
    ap.add_argument("--alpha", type=float, default=DEFAULT_ALPHA)
    ap.add_argument("--out", type=Path, default=None, help="model.json path (default web/public/model.json)")
    args = ap.parse_args()

    from ml.export import MODEL_JSON, write_model_json

    puzzles = load_puzzles()
    solves = load_training_solves(args.source, {p["id"] for p in puzzles}, args.exclude_player)
    model = train(solves, puzzles, args.alpha)

    n_players = len({p for p, _, _ in solves})
    print(f"human solves (completed): {model.human_solves} from {n_players} player(s)")
    print(f"label used: {model.label}"
          + (f"  (fewer than {MIN_HUMAN_SOLVES} human solves; fitted on solver_steps, output is in steps, not ms)"
             if model.label == LABEL_SOLVER else ""))
    print(f"intercept: {model.intercept:.4f}")
    for name in PUZZLE_FEATURES:
        print(f"  {name:12s} {model.coef[name]:+.5f}")
    print(f"residual_std (log units): {model.residual_std:.4f}")
    if model.players:
        print(f"player offsets: {len(model.players)}")

    path = write_model_json(model, args.out or MODEL_JSON)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
