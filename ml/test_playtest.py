"""Run from the repo root: python3 -m unittest ml.test_playtest

All data is synthetic and in memory. Nothing is read from the database or written anywhere.
"""
from __future__ import annotations

import re
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

from ml.playtest import (
    DAILY_FIRST_DAY,
    MIN_PARTICIPANTS_FOR_A_RATE,
    analyse,
    daily_number,
    format_report,
    number_for_date,
)

_next_id = 100


def row(player: str, daily: int, completed: bool = True, **extra: object) -> dict[str, object]:
    global _next_id
    _next_id += 1
    return {"id": _next_id, "player_id": player, "puzzle_id": f"daily-{daily:03d}", "completed": completed, "mode": "regular",
            "source": None, "started_at_ms": 1_793_000_000_000, **extra}


class NumberingTests(unittest.TestCase):
    def test_daily_ids_and_dates(self) -> None:
        self.assertEqual(daily_number("daily-007"), 7)
        for bad in ("zip-5x5-01", "daily-7", "daily-0070", "xdaily-007", ""):
            self.assertIsNone(daily_number(bad), bad)
        self.assertEqual(number_for_date(date(2026, 11, 3)), 1)
        self.assertEqual(number_for_date(date(2026, 11, 9)), 7)

    def test_first_day_matches_the_web_app(self) -> None:
        ts = (Path(__file__).resolve().parent.parent / "web" / "lib" / "daily.ts").read_text()
        m = re.search(r'DAILY_FIRST_DAY = "(\d{4})-(\d{2})-(\d{2})"', ts)
        self.assertIsNotNone(m)
        self.assertEqual(DAILY_FIRST_DAY, date(*map(int, m.groups())))  # type: ignore[union-attr]


class MetricTests(unittest.TestCase):
    def test_participants_return_players_and_completion(self) -> None:
        df = pd.DataFrame([
            row("a", 5), row("a", 6), row("a", 7),            # three distinct days: a return player
            row("b", 5), row("b", 5),                          # the same day twice: a participant, not a return player
            row("c", 6, completed=False),                      # an attempt that was not finished: not a participant
            row("c", 7),                                       # then a finished one
            row("d", 9, completed=False),                      # attempts only
        ])
        r = analyse(df, first_number=5, days=7)
        self.assertEqual(r.participants, 3)  # a, b, c
        self.assertEqual(r.return_players, 1)  # a only
        self.assertEqual((r.attempts, r.completed), (8, 6))
        self.assertAlmostEqual(r.completion or 0, 6 / 8)
        self.assertEqual(r.players_with_attempts_only, 1)  # d

    def test_two_different_days_is_a_return(self) -> None:
        r = analyse(pd.DataFrame([row("a", 5), row("a", 6)]), 5)
        self.assertEqual((r.participants, r.return_players), (1, 1))

    def test_only_dailies_inside_the_window_count(self) -> None:
        df = pd.DataFrame([row("a", 4), row("a", 5), row("a", 11), row("a", 12)])  # the window is daily 5 to 11
        r = analyse(df, 5, 7)
        self.assertEqual((r.attempts, r.return_players), (2, 1))
        practice = row("a", 5)
        practice["puzzle_id"] = "zip-5x5-01"
        self.assertEqual(analyse(pd.DataFrame([practice]), 5).attempts, 0, "practice puzzles are not dailies")

    def test_test_rows_are_excluded_and_demo_is_kept_apart(self) -> None:
        df = pd.DataFrame([
            row("real", 5),
            row("owner", 5, source="test"),
            {**row("early", 5), "id": 3},                      # ids 1 to 8: the early test plays, until migration 007 is applied
            row("volunteer", 5, source="demo"),
            row("sprint", 5, mode="extreme"),
        ])
        r = analyse(df, 5)
        self.assertEqual((r.participants, r.attempts), (1, 1))
        self.assertEqual((r.test_rows_excluded, r.demo_rows_excluded, r.other_mode_rows_excluded), (2, 1, 1))

    def test_excluded_players_are_test_data(self) -> None:
        df = pd.DataFrame([row("me", 5), row("me", 6), row("friend", 5)])
        r = analyse(df, 5, exclude_players=["me"])
        self.assertEqual((r.participants, r.return_players, r.test_rows_excluded), (1, 0, 2))

    def test_a_missing_mode_or_source_is_a_normal_regular_row(self) -> None:
        r = analyse(pd.DataFrame([{**row("a", 5), "mode": None, "source": float("nan")}]), 5)
        self.assertEqual((r.participants, r.attempts), (1, 1))

    def test_no_data_gives_zeros_and_no_rate(self) -> None:
        for df in (pd.DataFrame(), pd.DataFrame([row("a", 1)])):
            r = analyse(df, 5)
            self.assertEqual((r.participants, r.return_players, r.attempts, r.completed), (0, 0, 0, 0))
            self.assertIsNone(r.completion)

    def test_a_window_past_the_end_of_the_first_pool_cycle_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            analyse(pd.DataFrame(), first_number=118, days=7)  # daily ids repeat after 120, so they stop meaning a day
        with self.assertRaises(ValueError):
            analyse(pd.DataFrame(), first_number=0, days=7)


class ReportTests(unittest.TestCase):
    def report(self, n_players: int) -> str:
        df = pd.DataFrame([row(f"p{i}", 5 + (i % 2)) for i in range(n_players)])
        return format_report(analyse(df, 5), DAILY_FIRST_DAY)

    def test_a_small_group_gets_counts_and_no_percentages(self) -> None:
        text = self.report(MIN_PARTICIPANTS_FOR_A_RATE - 1)
        self.assertIn("too few to quote a rate", text)
        self.assertNotRegex(text, r"\d+%")

    def test_a_larger_group_gets_rates(self) -> None:
        self.assertRegex(self.report(MIN_PARTICIPANTS_FOR_A_RATE), r"\d+%")

    def test_the_report_states_what_cannot_be_measured_and_never_prints_ids(self) -> None:
        text = self.report(12)
        for must in ("not a person", "Visits", "abandon", "upper bound"):
            self.assertIn(must, text)
        self.assertNotIn("p0", text.replace("playtest", ""))
        self.assertNotRegex(text, r"[—–]")


if __name__ == "__main__":
    unittest.main()
