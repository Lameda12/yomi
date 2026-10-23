"""Append-only record of every model the pipeline has trained: web/public/model_history.json.

The web app reads this file for the "How Yomi learns" page, so it lives next to model.json. Each entry says what the
model was trained on (label, solves, players), its coefficients, and whether it was evaluated on held-out data, with
the numbers when it was and "not_run" plus the reason when it was not. Nothing is rounded up and nothing is filled in:
an evaluation that did not run stays "not_run".

Rules:
- Entries are only ever appended. A re-run that produces the same version, data counts and evaluation as the last
  entry adds nothing (so running the pipeline twice on the same data does not pad the history).
- The latest report is still reports/sprint2_model.md; every run also keeps its own copy in reports/history/.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.evaluate import Result
from ml.train_stuck import StuckModel
from ml.train_time import TimeModel

ROOT = Path(__file__).resolve().parent.parent
HISTORY_JSON = ROOT / "web" / "public" / "model_history.json"
REPORT_ARCHIVE = ROOT / "reports" / "history"


def eval_entry(res: Result) -> dict[str, Any]:
    """One evaluation, as stored. Skipped runs keep their reason and carry no metrics."""
    if res.status != "scored":
        return {"status": "not_run", "reason": res.reason}
    return {
        "status": "scored",
        "n_solves": res.n_solves,
        "n_players": res.n_players,
        "metrics": {k: round(float(v), 4) for k, v in res.metrics.items()},
    }


def build_entry(version: str, source: str, rows_read: int, n_players: int, time: TimeModel, stuck: StuckModel,
                t_res: Result, s_res: Result, trained_at: str | None = None, note: str = "") -> dict[str, Any]:
    return {
        "version": version,
        "trained_at": trained_at or f"{datetime.now(timezone.utc):%Y-%m-%d}",
        "source": source,
        "rows_read": rows_read,
        "label": time.label,
        "human_solves": time.human_solves,
        "players": n_players,
        "time": {
            "intercept": time.intercept,
            "coef": dict(time.coef),
            "residual_std": time.residual_std,
            "eval": eval_entry(t_res),
        },
        "stuck": {"trained": stuck.trained, "solves": stuck.n_solves, "eval": eval_entry(s_res)},
        "note": note,
    }


def load_history(path: Path = HISTORY_JSON) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    if not isinstance(data, list):
        raise ValueError(f"{path} must hold a JSON list of entries")
    return data


def _same_run(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Same model and same evidence; the date and the free-text note do not make a run new."""
    skip = {"trained_at", "note"}
    return {k: v for k, v in a.items() if k not in skip} == {k: v for k, v in b.items() if k not in skip}


def append_entry(entry: dict[str, Any], path: Path = HISTORY_JSON) -> bool:
    """Add `entry` at the end. Returns False (and writes nothing) when it repeats the last entry."""
    history = load_history(path)
    if history and _same_run(history[-1], entry):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([*history, entry], indent=2) + "\n")
    return True


def archive_report(report: Path, version: str, directory: Path = REPORT_ARCHIVE) -> Path:
    """Keep a copy of this run's report under its model version, so the next run cannot overwrite the only record."""
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / f"{version}.md"
    shutil.copyfile(report, dest)
    return dest
