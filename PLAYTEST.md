# Seven-day playtest

A small, honest look at whether people play Yomi's daily more than once. It is not a user study and it cannot show that the
daily causes anyone to return, or that any model works. It uses the anonymous solve records Yomi already stores. Nothing new
is collected: no tracking SDK, no accounts, no new database columns.

## Setup

- Pick a start date (the date a daily was issued, for example 2026-11-07) and run for seven days. Dailies are numbered from
  2026-11-03 (#1), so that start date is #5 and the window is #5 to #11. The window must stay inside daily-001 to daily-120.
- Ask a small group (classmates, friends) to play today's Yomi at the live URL. Say whether you sent reminders. If you ask
  people to play every day, "return players" measures compliance with your ask, not interest, so prefer to ask once and not
  remind, and write down what you did.
- Keep your own plays out of the numbers. Find your anonymous id (your browser's `yomi_player` local-storage value) and pass it
  with `--exclude-player`. Your early test rows are already left out (`source = 'test'`, and row ids 1 to 8 until migration 007
  is applied).

## Definitions

- **Participant:** a distinct player id with at least one completed daily in the window.
- **Return player:** a participant who completed dailies on at least two distinct days (distinct daily puzzles).
- **Daily completion:** completed daily attempts divided by all recorded daily attempts in the window.

Counted: regular-mode attempts of `daily-NNN` puzzles. Left out: test data, Extreme runs, practice puzzles. The `/demo`
projector screen is a separate source (`source = 'demo'`, and it only plays practice puzzles); it is counted and reported apart,
never mixed in.

## Running it

```bash
python -m ml.playtest --source neon --start-date 2026-11-07 --exclude-player <your yomi_player id>
```

It prints a report and writes nothing. It never prints a player id. With fewer than 10 participants it prints counts, not
percentages. The tests are in `ml/test_playtest.py`.

## What the numbers cannot say

- **A player id is a browser, not a person.** One person on two devices (or after clearing site data) is two ids; two people on one device are one.
- **A recorded attempt is not a visit.** An attempt is stored only after a first move. Someone who opened Yomi and never moved leaves no record, so visits, and visitors who did not play, are **not measured**. There is no equivalent metric in the stored data, and none is invented here.
- **Abandoned attempts may be missing.** An attempt is stored as unfinished only when the player skips or presses Practice/Next after moving (and it lasted between 1 second and 30 minutes). Closing the tab stores nothing. Daily completion is therefore an upper bound on the true rate.
- **Server dates are not the daily's date.** The server stores UTC, and each player's daily changes at their own local midnight. So a "day" here is the daily puzzle id, which is exactly the day that puzzle was issued; a daily finished after midnight counts for the day it was issued.
- **Return means finished on two days.** Someone who came back and did not finish is not counted.
- **Small groups.** With a handful of people, one person moves a percentage by many points. Report counts and say how many people it is.

## Two questions to ask by hand

Ask each participant, after their second daily or at the end of the week, in person or by message:

1. "What did you think the target above the puzzle meant?"
2. "What would make you come back tomorrow?"

The first checks whether the three kinds of target (crowd median, solver effort, a human-time model's prediction) are understood.
Write answers down privately and summarise the pattern in your own words. Do not store names, and do not publish direct quotes as
testimonials.

## Reporting it

Say it was a small playtest of N player ids over seven days, give the counts, and repeat the limits above. Do not claim retention,
model accuracy or a user count beyond what the report shows.
