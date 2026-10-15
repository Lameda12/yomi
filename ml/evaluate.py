"""Leave-one-player-out evaluation of the time and stuck models; writes reports/sprint2_model.md.

Run from the repo root:  .venv/bin/python -m ml.evaluate [--source auto|neon|jsonl]

For each player P: train on every other player's solves, predict P's solves.
- Time: share of solves within 20% of the actual ms, median absolute % error (APE), against a
  "mean time" baseline (mean solve_ms of the training players).
  A fold whose training set is under MIN_HUMAN_SOLVES falls back to solver_effort, which outputs
  solver steps, not ms. Those folds get no time score: steps cannot be compared to ms.
- Stuck: top-3 hit rate (actual longest-pause cell in the predicted 3), against random 3 cells.
  The random baseline is its exact expectation, 3 / cells, so it needs no seed.
  A fold whose training set is under MIN_LABELED_SOLVES has no stuck model and gets no score.

Numbers are reported as they come out, including when they are bad or missing.
"""
from __future__ import annotations

import argparse
import math
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml import train_stuck, train_time  # noqa: E402
from ml.features import PUZZLE_FEATURES, load_puzzles, puzzle_features  # noqa: E402

REPORT = ROOT / "reports" / "sprint2_model.md"
WITHIN = 0.20
FORM_TARGET_STUCK = 0.60


@dataclass
class TimeEval:
    n_solves: int = 0
    n_players: int = 0
    scored: int = 0  # solves in folds with a human_time model
    unscored_folds: list[str] = field(default_factory=list)  # held-out players with no ms prediction
    within_20: float | None = None
    median_ape: float | None = None
    baseline_scored: int = 0
    baseline_within_20: float | None = None
    baseline_median_ape: float | None = None
    effort_spearman: float | None = None  # solver-effort prediction vs actual ms, all solves


@dataclass
class StuckEval:
    n_solves: int = 0
    n_players: int = 0
    scored: int = 0
    unscored_folds: list[str] = field(default_factory=list)
    hit_rate: float | None = None
    random_hit_rate: float | None = None  # expected over all labeled solves
    random_hit_rate_scored: float | None = None  # expected over the scored solves only


def _ape(pred: float, actual: float) -> float:
    return abs(pred - actual) / actual


def predict_ms(model: train_time.TimeModel, feats: dict[str, float], player_id: str) -> float:
    z = model.intercept + sum(model.coef[f] * feats[f] for f in PUZZLE_FEATURES)
    return math.exp(z + model.players.get(player_id, 0.0))


def _spearman(a: Sequence[float], b: Sequence[float]) -> float | None:
    if len(a) < 3 or len(set(a)) < 2 or len(set(b)) < 2:
        return None
    ra = np.argsort(np.argsort(a)).astype(float)
    rb = np.argsort(np.argsort(b)).astype(float)
    return float(np.corrcoef(ra, rb)[0, 1])


def evaluate_time(solves: Sequence[train_time.Solve], puzzles: Sequence[dict[str, Any]]) -> TimeEval:
    out = TimeEval(n_solves=len(solves), n_players=len({s[0] for s in solves}))
    feats = {p["id"]: puzzle_features(p) for p in puzzles}

    # Solver-effort prediction uses no human data, so no fold is needed for this check.
    effort = train_time.train([], puzzles)
    if solves:
        out.effort_spearman = _spearman([predict_ms(effort, feats[pz], "") for _, pz, _ in solves],
                                        [ms for _, _, ms in solves])

    model_ape: list[float] = []
    base_ape: list[float] = []
    for held in sorted({s[0] for s in solves}):
        train_rows = [s for s in solves if s[0] != held]
        test_rows = [s for s in solves if s[0] == held]
        if train_rows:
            mean_ms = statistics.fmean(ms for _, _, ms in train_rows)
            base_ape += [_ape(mean_ms, ms) for _, _, ms in test_rows]
        model = train_time.train(train_rows, puzzles)
        if model.label != train_time.LABEL_HUMAN:
            out.unscored_folds.append(held)
            continue
        model_ape += [_ape(predict_ms(model, feats[pz], pid), ms) for pid, pz, ms in test_rows]

    if model_ape:
        out.scored = len(model_ape)
        out.within_20 = sum(e <= WITHIN for e in model_ape) / len(model_ape)
        out.median_ape = statistics.median(model_ape)
    if base_ape:
        out.baseline_scored = len(base_ape)
        out.baseline_within_20 = sum(e <= WITHIN for e in base_ape) / len(base_ape)
        out.baseline_median_ape = statistics.median(base_ape)
    return out


def evaluate_stuck(solves: Sequence[train_stuck.StuckSolve], puzzles: Sequence[dict[str, Any]]) -> StuckEval:
    out = StuckEval(n_solves=len(solves), n_players=len({s[0] for s in solves}))
    by_id = {p["id"]: p for p in puzzles}
    chance = {pid: train_stuck.TOP_K / len(p["solution"]) for pid, p in by_id.items()}
    if solves:
        out.random_hit_rate = statistics.fmean(chance[pz] for _, pz, _ in solves)

    hits: list[float] = []
    scored_chance: list[float] = []
    for held in sorted({s[0] for s in solves}):
        model = train_stuck.train([s for s in solves if s[0] != held], puzzles)
        if not model.fitted:
            out.unscored_folds.append(held)
            continue
        for _, pz, cell in (s for s in solves if s[0] == held):
            hits.append(float(cell in train_stuck.top_cells(model, by_id[pz])))
            scored_chance.append(chance[pz])
    if hits:
        out.scored = len(hits)
        out.hit_rate = statistics.fmean(hits)
        out.random_hit_rate_scored = statistics.fmean(scored_chance)
    return out


# ---------- report ------------------------------------------------------------

def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{100 * v:.1f}%"


def _num(v: float | None) -> str:
    return "n/a" if v is None else f"{v:+.2f}"


def render_report(t: TimeEval, s: StuckEval, source: str, model_label: str) -> str:
    small = t.n_solves < train_time.MIN_HUMAN_SOLVES or t.n_players < 2
    lines = [
        "# Sprint 2: model evaluation",
        "",
        f"Generated by `ml/evaluate.py` on {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from `{source}`. "
        "Rerun it after new solves come in; this file is overwritten.",
        "",
        "Method: leave-one-player-out. Each player's solves are predicted by models trained on everyone else. "
        "Only completed solves from real humans count; the test rows excluded in `ml/train_time.py` stay excluded.",
        "",
        f"Shipped model (`web/public/model.json`): label **{model_label}**.",
        "",
    ]
    if t.n_solves == 0 and s.n_solves == 0:
        lines += [
            "**No solves found at this source.** This run read zero rows, so every number below is empty. "
            "The real solves live in Neon or in a local `data/solves.jsonl` that is not in git; rerun "
            "`python -m ml.evaluate` where that data is.",
            "",
        ]
    if small:
        lines += [
            "## Sample size: too small to evaluate",
            "",
            f"{t.n_solves} completed solve(s) from {t.n_players} player(s). Leave-one-player-out needs at least "
            f"2 players, and a fold only gets a real time model once its training players have "
            f"{train_time.MIN_HUMAN_SOLVES}+ solves (the stuck model needs {train_stuck.MIN_LABELED_SOLVES}+ "
            "labeled solves). Below that the numbers below are mostly `n/a`, and any number that does appear "
            "comes from a handful of solves. None of this is an accuracy claim.",
            "",
        ]
    lines += [
        "## Time model",
        "",
        "| | Model | Mean-time baseline |",
        "|---|---|---|",
        f"| Solves scored | {t.scored} | {t.baseline_scored} |",
        f"| Within 20% of actual | {_pct(t.within_20)} | {_pct(t.baseline_within_20)} |",
        f"| Median absolute % error | {_pct(t.median_ape)} | {_pct(t.baseline_median_ape)} |",
        "",
        f"Folds with no ms prediction (training set under {train_time.MIN_HUMAN_SOLVES} solves, so the model "
        f"fell back to solver steps): {len(t.unscored_folds)} of {t.n_players}.",
        "",
        f"Solver-effort check: Spearman ρ between the solver-effort prediction (steps) and actual solve ms, "
        f"over all {t.n_solves} solve(s): {_num(t.effort_spearman)}. This is a rank check only; steps are not ms.",
        "",
        "## Stuck model",
        "",
        "| | Model | Random 3 cells |",
        "|---|---|---|",
        f"| Solves scored | {s.scored} | {s.n_solves} |",
        f"| Top-3 hit rate | {_pct(s.hit_rate)} | {_pct(s.random_hit_rate)} |",
        "",
        f"Random baseline on the same solves the model was scored on: {_pct(s.random_hit_rate_scored)}. "
        f"Form target: {_pct(FORM_TARGET_STUCK)}.",
        "",
        f"Folds with no stuck model (training set under {train_stuck.MIN_LABELED_SOLVES} labeled solves): "
        f"{len(s.unscored_folds)} of {s.n_players}.",
        "",
        "## Label honesty",
        "",
        "- `solver_effort` = the Zip uniqueness solver's search steps. It is a puzzle-side proxy, not a human time.",
        "- `human_time` = real players' completed solve times in ms. Only this label is scored against ms above.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", choices=("auto", "neon", "jsonl"), default="auto")
    ap.add_argument("--exclude-player", action="append", default=[], metavar="UUID")
    ap.add_argument("--out", type=Path, default=REPORT)
    args = ap.parse_args()

    import json

    import analysis

    source = args.source
    if source == "auto":
        source = "neon" if analysis.database_url() else "jsonl"
    puzzles = load_puzzles()
    df = train_time.load_frame(source)
    time_solves = train_time.solves_from_frame(df, {p["id"] for p in puzzles}, args.exclude_player)
    stuck_solves = train_stuck.labeled_solves_from_frame(df, {p["id"]: p for p in puzzles}, args.exclude_player)
    t = evaluate_time(time_solves, puzzles)
    s = evaluate_stuck(stuck_solves, puzzles)

    try:
        from ml.export import MODEL_JSON
        model_label = json.loads(MODEL_JSON.read_text())["trained_on"]["label"]
    except (OSError, ValueError, KeyError):
        model_label = "missing"

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_report(t, s, source, model_label))
    print(f"time: {t.n_solves} solves, {t.n_players} players, scored {t.scored}, within 20% {_pct(t.within_20)}, "
          f"median APE {_pct(t.median_ape)} (baseline {_pct(t.baseline_median_ape)})")
    print(f"stuck: {s.n_solves} labeled, scored {s.scored}, top-3 {_pct(s.hit_rate)} "
          f"(random {_pct(s.random_hit_rate)})")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
