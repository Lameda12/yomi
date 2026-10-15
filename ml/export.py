"""Write web/public/model.json following the model contract in CLAUDE.md.

web/lib/predict.ts reads this file; keys and feature order must match the contract exactly.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.features import CELL_FEATURES, PUZZLE_FEATURES
from ml.train_time import TimeModel

ROOT = Path(__file__).resolve().parent.parent
MODEL_JSON = ROOT / "web" / "public" / "model.json"


def build_model_json(time: TimeModel, version: str | None = None) -> dict[str, Any]:
    """The contract object. `time` is the fitted solve-time model."""
    if list(time.coef) != PUZZLE_FEATURES:
        raise ValueError(f"coef keys {list(time.coef)} must match puzzle_features {PUZZLE_FEATURES}, in order")
    if version is None:
        version = f"{datetime.now(timezone.utc):%Y%m%d}-{time.label}-n{time.human_solves}"
    return {
        "version": version,
        "trained_on": {"human_solves": time.human_solves, "label": time.label},
        "puzzle_features": PUZZLE_FEATURES,
        "time": {"intercept": time.intercept, "coef": time.coef, "residual_std": time.residual_std},
        "players": time.players,
        "cell_features": CELL_FEATURES,
        # Sprint 2 task 5 fills this in. Until then the stuck model is untrained: intercept 0 and an
        # empty coef, which predict.ts must read as "no stuck prediction" (not as all-zero scores).
        "stuck": {"intercept": 0.0, "coef": {}},
    }


def write_model_json(time: TimeModel, path: Path = MODEL_JSON, version: str | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(build_model_json(time, version), indent=2) + "\n")
    return path
