"""Train both models, evaluate them, export web/public/model.json, write reports/sprint2_model.md.

Run from the repo root:  .venv/bin/python -m ml.pipeline [--source auto|neon|jsonl]

Training data is completed solves from real humans only (see ml/train_time.py for the filter).
The report states the real numbers, including "not run" when there is not enough data.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.evaluate import STUCK_TARGET, WITHIN, Result, eval_stuck, eval_time  # noqa: E402
from ml.export import MODEL_JSON, write_model_json  # noqa: E402
from ml.features import PUZZLE_FEATURES, cell_features, load_puzzles  # noqa: E402
from ml.train_stuck import MIN_STUCK_SOLVES, StuckModel, stuck_solves_from_frame, train_stuck  # noqa: E402
from ml.train_time import LABEL_SOLVER, MIN_HUMAN_SOLVES, TimeModel, log, solves_from_frame, train  # noqa: E402

REPORT = ROOT / "reports" / "sprint2_model.md"


def pct(x: float) -> str:
    return f"{100 * x:.0f}%"


def time_section(model: TimeModel, res: Result, n_players: int) -> str:
    unit = "solver steps, **not milliseconds**" if model.label == LABEL_SOLVER else "milliseconds"
    lines = [
        "## Time model",
        "",
        f"- Label: `{model.label}`. Predictions are in {unit}.",
        f"- Fitted on {model.n_train_rows} rows. Human solves counted: {model.human_solves} from {n_players} player(s).",
    ]
    if model.label == LABEL_SOLVER:
        lines.append(
            f"- Why not human time: the rule is {MIN_HUMAN_SOLVES}+ completed human solves; this run has "
            f"{model.human_solves}. So the model learns \"how hard will the solver find it\" from the puzzle "
            "features, one row per puzzle. It has no player offsets (`players` is empty)."
        )
    lines += ["- Coefficients (raw scale, on `log` of the label):", ""]
    lines += [f"  - `{f}`: {model.coef[f]:+.4f}" for f in PUZZLE_FEATURES]
    lines += [f"  - intercept: {model.intercept:+.4f}, residual std: {model.residual_std:.3f} (log units)", "", "### Evaluation (leave-one-player-out)", ""]
    if res.status == "skipped":
        lines += [
            f"**Not run.** {res.reason}.",
            "",
            "No accuracy number is claimed. There is no \"within 20%\" or percent-error result for this model, "
            "and no comparison against the mean-time baseline.",
        ]
    else:
        m = res.metrics
        lines += [
            f"Scored {res.n_solves} held-out solves from {res.n_players} players.",
            "",
            "| Metric | Model | Mean-time baseline |",
            "|---|---|---|",
            f"| Within {pct(WITHIN)} of real time | {pct(m['within20'])} | {pct(m['baseline_within20'])} |",
            f"| Median absolute % error | {pct(m['median_abs_pct_err'])} | {pct(m['baseline_median_abs_pct_err'])} |",
        ]
    return "\n".join(lines)


def stuck_section(model: StuckModel, res: Result) -> str:
    lines = ["## Stuck-point model", ""]
    if model.trained:
        lines += [f"- Trained: logistic per cell on {model.n_solves} solves ({model.n_dropped} dropped: stuck cell off the solution path or missing).", ""]
        lines += [f"  - `{f}`: {c:+.4f}" for f, c in model.coef.items()]
        lines += [f"  - intercept: {model.intercept:+.4f}"]
    else:
        lines += [
            f"- **Not trained.** The rule is {MIN_STUCK_SOLVES}+ usable solves; this run has {model.n_solves} "
            f"({model.n_dropped} more were dropped because the stuck cell was missing or off the solution path).",
            "- `model.json` keeps `stuck: {intercept: 0, coef: {}}`, which the app reads as \"no stuck prediction\". "
            "It shows no stuck cells until a model exists.",
        ]
    lines += ["", "### Evaluation (leave-one-player-out, top 3 cells)", ""]
    if res.status == "skipped":
        lines += [
            f"**Not run.** {res.reason}.",
            "",
            f"No hit rate is claimed. The form target is {pct(STUCK_TARGET)}; we have no measurement against it and no "
            "comparison against the random-3-cells baseline.",
        ]
    else:
        m = res.metrics
        lines += [
            f"Scored {res.n_solves} held-out solves from {res.n_players} players.",
            "",
            "| Metric | Model | Random 3 cells |",
            "|---|---|---|",
            f"| Top-3 hit rate | {pct(m['top3_hit_rate'])} | {pct(m['baseline_top3_hit_rate'])} |",
            "",
            f"Form target: {pct(STUCK_TARGET)}. The random baseline is the exact expected rate of picking 3 distinct cells.",
        ]
    return "\n".join(lines)


def build_report(source: str, n_rows: int, time_m: TimeModel, stuck_m: StuckModel, t_res: Result, s_res: Result,
                 n_players: int, n_cells: float) -> str:
    today = f"{datetime.now(timezone.utc):%Y-%m-%d}"
    head = f"""# Sprint 2 model report

Generated {today} by `python -m ml.pipeline`. Numbers below are what the data gave; none are rounded up.

## Data

- Source: `{source}`. Rows read: {n_rows}.
- Used for training: completed solves from real humans only, minus the 8 early test rows (ids 1-8). That left **{time_m.human_solves} solves from {n_players} player(s)**.
- Time-model label: **`{time_m.label}`**. {"This is the stand-in: the output is solver search steps, not time." if time_m.label == LABEL_SOLVER else "Predictions are human solve time in ms."}
- Average solution-path length is about {n_cells:.0f} cells, so a random pick of 3 cells hits the stuck cell about {pct(3 / n_cells)} of the time.
"""
    tail = """

## What this means

- The deployed model is the solver-effort fallback. The honest way to describe it is "predicts how hard it'll be", not "predicts your time".
- Both evaluations need real data we do not have yet: 30+ completed human solves from 2+ players (and for the time model, 30+ in each training fold). The code for both is written and unit-tested on synthetic data, and those synthetic tests are not results.
- Next: run `python -m ml.pipeline --source neon` once the live site has collected solves. It overwrites `web/public/model.json` and this file.
"""
    return "\n\n".join([head, time_section(time_m, t_res, n_players), stuck_section(stuck_m, s_res)]) + tail


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", choices=("auto", "neon", "jsonl"), default="auto")
    ap.add_argument("--exclude-player", action="append", default=[], metavar="UUID", help="drop this player's rows; repeatable")
    ap.add_argument("--out", type=Path, default=MODEL_JSON, help="model.json path")
    ap.add_argument("--report", type=Path, default=REPORT, help="report path")
    args = ap.parse_args()

    import analysis  # same loader and solve_id dedupe as the other scripts

    source = args.source
    if source == "auto":
        source = "neon" if analysis.database_url() else "jsonl"
    log(f"[pipeline] reading solves from {source}")
    df = analysis.load_solves(source, ROOT / "data" / "solves.csv")

    puzzles = load_puzzles()
    ids = {p["id"] for p in puzzles}
    solves = solves_from_frame(df, ids, args.exclude_player)
    stuck_solves = stuck_solves_from_frame(df, ids, args.exclude_player)

    time_m = train(solves, puzzles)
    stuck_m = train_stuck(stuck_solves, puzzles)
    t_res = eval_time(solves, puzzles)
    s_res = eval_stuck(stuck_solves, puzzles)

    n_players = len({p for p, _, _ in solves})
    n_cells = sum(len(cell_features(p)) for p in puzzles) / len(puzzles)
    n_rows = 0 if df is None else len(df)

    path = write_model_json(time_m, args.out, stuck=stuck_m)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(build_report(source, n_rows, time_m, stuck_m, t_res, s_res, n_players, n_cells))
    print(f"label={time_m.label} human_solves={time_m.human_solves} players={n_players} stuck_trained={stuck_m.trained}")
    print(f"time eval: {t_res.status} {t_res.reason}".strip())
    print(f"stuck eval: {s_res.status} {s_res.reason}".strip())
    print(f"wrote {path} and {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
