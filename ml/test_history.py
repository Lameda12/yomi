"""Run from the repo root: python3 -m unittest ml.test_history

Synthetic data only, written to a temp directory. The one test that reads the real files checks that the committed
history and model.json agree, so a retrain that forgot the history shows up here.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ml.evaluate import Result
from ml.export import MODEL_JSON
from ml.features import PUZZLE_FEATURES
from ml.history import HISTORY_JSON, append_entry, archive_report, build_entry, eval_entry, load_history
from ml.train_stuck import StuckModel
from ml.train_time import LABEL_SOLVER, TimeModel


def time_model(solves: int = 7) -> TimeModel:
    return TimeModel(intercept=-4.4, coef={f: 0.1 for f in PUZZLE_FEATURES}, residual_std=0.7, label=LABEL_SOLVER, human_solves=solves, n_train_rows=30)


def stuck_model(trained: bool = False) -> StuckModel:
    return StuckModel(intercept=0.1 if trained else 0.0, coef={"dist_to_next_dot": 0.3} if trained else {}, n_solves=7, n_dropped=0)


SKIP = Result("skipped", "leave-one-player-out needs 2+ players, have 1")
SCORED = Result("scored", "", n_solves=40, n_players=4, metrics={"within20": 0.31234567, "baseline_within20": 0.2})


class HistoryTest(unittest.TestCase):
    def test_a_skipped_evaluation_is_recorded_as_not_run_with_its_reason_and_no_numbers(self) -> None:
        e = eval_entry(SKIP)
        self.assertEqual(e, {"status": "not_run", "reason": "leave-one-player-out needs 2+ players, have 1"})

    def test_a_scored_evaluation_keeps_its_counts_and_metrics(self) -> None:
        e = eval_entry(SCORED)
        self.assertEqual((e["status"], e["n_solves"], e["n_players"]), ("scored", 40, 4))
        self.assertEqual(e["metrics"]["within20"], 0.3123)

    def test_entries_are_appended_and_an_identical_rerun_adds_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "h.json"
            first = build_entry("v1", "jsonl", 15, 1, time_model(7), stuck_model(), SKIP, SKIP, trained_at="2026-10-22")
            self.assertTrue(append_entry(first, path))
            again = build_entry("v1", "jsonl", 15, 1, time_model(7), stuck_model(), SKIP, SKIP, trained_at="2026-10-23", note="reran")
            self.assertFalse(append_entry(again, path), "same version, counts and evaluation: not a new entry")
            more = build_entry("v2", "neon", 80, 6, time_model(40), stuck_model(True), SCORED, SKIP, trained_at="2026-10-25")
            self.assertTrue(append_entry(more, path))
            self.assertEqual([h["version"] for h in load_history(path)], ["v1", "v2"])
            self.assertEqual(load_history(path)[0]["trained_at"], "2026-10-22", "the first entry is never rewritten")

    def test_a_changed_evaluation_with_the_same_version_is_a_new_entry(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "h.json"
            self.assertTrue(append_entry(build_entry("v1", "neon", 50, 4, time_model(31), stuck_model(), SKIP, SKIP), path))
            self.assertTrue(append_entry(build_entry("v1", "neon", 50, 4, time_model(31), stuck_model(), SCORED, SKIP), path))
            self.assertEqual(len(load_history(path)), 2)

    def test_reports_are_archived_under_their_version_and_not_overwritten_by_the_next_version(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            report = Path(d) / "latest.md"
            archive = Path(d) / "history"
            report.write_text("run one")
            archive_report(report, "v1", archive)
            report.write_text("run two")
            archive_report(report, "v2", archive)
            self.assertEqual((archive / "v1.md").read_text(), "run one")
            self.assertEqual((archive / "v2.md").read_text(), "run two")

    def test_a_missing_history_file_reads_as_empty(self) -> None:
        self.assertEqual(load_history(Path("/nonexistent/model_history.json")), [])

    def test_the_committed_history_ends_with_the_deployed_model(self) -> None:
        history = load_history(HISTORY_JSON)
        model = json.loads(MODEL_JSON.read_text())
        self.assertTrue(history, "model_history.json must not be empty")
        last = history[-1]
        self.assertEqual(last["version"], model["version"])
        self.assertEqual(last["label"], model["trained_on"]["label"])
        self.assertEqual(last["human_solves"], model["trained_on"]["human_solves"])
        self.assertEqual(last["time"]["coef"], model["time"]["coef"])

    def test_no_committed_entry_claims_a_score_it_did_not_measure(self) -> None:
        for e in load_history(HISTORY_JSON):
            for ev in (e["time"]["eval"], e["stuck"]["eval"]):
                if ev["status"] == "not_run":
                    self.assertNotIn("metrics", ev, e["version"])
                    self.assertTrue(ev["reason"], e["version"])
                else:
                    self.assertGreaterEqual(ev["n_players"], 2, e["version"])


if __name__ == "__main__":
    unittest.main()
