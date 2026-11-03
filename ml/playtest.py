"""Seven-day playtest numbers from the anonymous solve records Yomi already stores. See PLAYTEST.md.

Run from the repo root:
    python -m ml.playtest --source neon --start-date 2026-11-07 [--days 7]

Prints a report to stdout. It writes nothing, and it never prints a player id.

The days are the daily puzzles themselves: `daily-005` is the daily that was issued on day 5 (2026-11-07), so a "day" is
a daily puzzle id, with no server timestamp and no time zone involved. That only holds inside the first cycle of the
pool (daily-001 to daily-120, day 0 = 2026-11-03); the ids repeat after that, so a later window is refused.

What the stored rows can and cannot say is in `format_report` and PLAYTEST.md. In short: a player id is a browser, not a
person; a stored attempt is a first move, not a visit; an attempt abandoned by closing the tab is never stored.
"""
from __future__ import annotations

import argparse
import math
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml.train_time import EXCLUDED_ROW_IDS  # noqa: E402

DAILY_FIRST_DAY = date(2026, 11, 3)  # day 0, mirrors DAILY_FIRST_DAY in web/lib/daily.ts (a test checks they agree)
POOL_SIZE = 120  # daily-001 .. daily-120; after that the ids repeat
MIN_PARTICIPANTS_FOR_A_RATE = 10  # below this, counts only: a percentage of 4 people is not a finding
_DAILY = re.compile(r"^daily-(\d{3})$")


def daily_number(puzzle_id: str) -> int | None:
    """7 for "daily-007", None for any other id."""
    m = _DAILY.match(str(puzzle_id))
    return int(m.group(1)) if m else None


def number_for_date(d: date) -> int:
    """The daily number issued on a calendar date (2026-11-03 is #1)."""
    return (d - DAILY_FIRST_DAY).days + 1


@dataclass
class Playtest:
    first_number: int
    days: int
    participants: int  # distinct player ids with a completed daily in the window
    return_players: int  # participants who completed dailies on at least two distinct days
    attempts: int  # recorded daily attempts, finished or not
    completed: int
    players_with_attempts_only: int  # recorded an attempt but never finished a daily in the window
    test_rows_excluded: int
    demo_rows_excluded: int
    other_mode_rows_excluded: int
    first_started_utc: str | None  # earliest and latest client clock among the counted rows, as a sanity check on the dates
    last_started_utc: str | None

    @property
    def completion(self) -> float | None:
        return self.completed / self.attempts if self.attempts else None


def _clean(value: Any) -> str | None:
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else str(value)


def analyse(df: Any, first_number: int, days: int = 7, exclude_players: Iterable[str] = ()) -> Playtest:
    """The playtest numbers for daily numbers first_number .. first_number + days - 1. `df` is what analysis.load_solves returns.

    `exclude_players` are ids to leave out as test data (the owner's own browsers); they are counted with the test rows."""
    last = first_number + days - 1
    if first_number < 1 or last > POOL_SIZE:
        raise ValueError(f"daily numbers {first_number} to {last} are outside the first cycle (1 to {POOL_SIZE}); ids repeat after that")
    skip = {str(p) for p in exclude_players}
    test = demo = other = 0
    counted: list[dict[str, Any]] = []
    if df is not None and len(df):
        for r in df.to_dict("records"):
            n = daily_number(r.get("puzzle_id", ""))
            if n is None or not first_number <= n <= last:
                continue
            # The early test plays: marked source = 'test' (migration 007), or ids 1 to 8 until 007 is applied.
            if _clean(r.get("source")) == "test" or str(r.get("id")) in EXCLUDED_ROW_IDS or str(r.get("player_id")) in skip:
                test += 1
            elif _clean(r.get("source")) == "demo":
                demo += 1  # the projector screen's volunteers: kept apart, never mixed into the playtest
            elif (_clean(r.get("mode")) or "regular") != "regular":
                other += 1
            else:
                counted.append({**r, "_n": n})
    done: dict[str, set[int]] = {}
    for r in counted:
        if bool(r.get("completed")):
            done.setdefault(str(r["player_id"]), set()).add(r["_n"])
    seen = {str(r["player_id"]) for r in counted}
    starts = [float(r["started_at_ms"]) for r in counted if r.get("started_at_ms") is not None and not pd.isna(r.get("started_at_ms"))]
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")  # noqa: E731
    return Playtest(
        first_number=first_number, days=days,
        participants=len(done),
        return_players=sum(1 for nums in done.values() if len(nums) >= 2),
        attempts=len(counted),
        completed=sum(1 for r in counted if bool(r.get("completed"))),
        players_with_attempts_only=len(seen - set(done)),
        test_rows_excluded=test, demo_rows_excluded=demo, other_mode_rows_excluded=other,
        first_started_utc=iso(min(starts)) if starts else None,
        last_started_utc=iso(max(starts)) if starts else None,
    )


def _ratio(x: int, n: int, quotable: bool) -> str:
    if n == 0:
        return f"{x} of {n}"
    return f"{x} of {n} ({round(100 * x / n)}%)" if quotable else f"{x} of {n} (too few to quote a rate)"


def format_report(p: Playtest, start: date) -> str:
    end = start + timedelta(days=p.days - 1)
    quotable = p.participants >= MIN_PARTICIPANTS_FOR_A_RATE
    lines = [
        f"# Yomi playtest: daily #{p.first_number} to #{p.first_number + p.days - 1} ({start} to {end})",
        "",
        "Counts come from stored anonymous solve records. Test rows are excluded and the demo screen is kept apart.",
        "",
        f"- Participants: **{p.participants}** distinct player ids that completed a daily in the window.",
        f"- Return players: **{_ratio(p.return_players, p.participants, quotable)}** completed dailies on at least two distinct days.",
        f"- Daily completion among recorded attempts: **{_ratio(p.completed, p.attempts, quotable)}** (an upper bound, see below).",
        f"- Player ids that recorded a daily attempt but never finished one: {p.players_with_attempts_only}.",
        "",
        f"Left out: {p.test_rows_excluded} test rows, {p.demo_rows_excluded} demo rows (kept apart), {p.other_mode_rows_excluded} non-regular rows.",
    ]
    if p.first_started_utc:
        lines.append(f"Counted attempts started between {p.first_started_utc} and {p.last_started_utc} (the player's own clock, shown only to sanity-check the dates).")
    if not quotable:
        lines += ["", f"With fewer than {MIN_PARTICIPANTS_FOR_A_RATE} participants these are counts, not rates. Do not quote a percentage."]
    lines += [
        "",
        "## What these numbers are not",
        "",
        "- A player id is a browser, not a person. One person on two devices, or after clearing site data, is two ids; two people sharing a device are one.",
        "- A recorded attempt is a first move, not a visit. Someone who opened Yomi and never moved leaves no record, so **Visits and visitors who did not play are not measured.**",
        "- An attempt abandoned by closing the tab is never stored (only a skip or a Next press records an unfinished attempt), so the completion figure is an upper bound on the true rate.",
        "- A \"day\" is the daily puzzle id, not a server date, because the server stores UTC and the daily changes at each player's local midnight. A daily finished after midnight counts for the day it was issued.",
        "- Return players are only people who finished a daily on two days. Someone who came back and did not finish is not counted as returning.",
        "- Nothing here shows the model works, or that the daily causes anyone to return. It is a small playtest.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", choices=("neon", "jsonl", "csv"), default="neon")
    ap.add_argument("--csv", type=Path, default=ROOT / "data" / "solves.csv", help="CSV export path for --source csv")
    ap.add_argument("--start-date", required=True, help="first day of the playtest, YYYY-MM-DD (the date that daily was issued)")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--exclude-player", action="append", default=[], metavar="PLAYER_ID",
                    help="a player id to leave out as test data (your own browser's yomi_player); repeatable")
    args = ap.parse_args()
    start = date.fromisoformat(args.start_date)
    first = number_for_date(start)
    import analysis  # lazy: it pulls in matplotlib, and the pure functions above do not need it

    df = analysis.load_solves(args.source, args.csv)
    print(format_report(analyse(df, first, args.days, args.exclude_player), start), end="")


if __name__ == "__main__":
    main()
