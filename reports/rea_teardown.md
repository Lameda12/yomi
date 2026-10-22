# REA teardown: Yomi status + one retention mechanic

Date: 2026-10-22. Method note: REA (Reverse Engineer Anything) is **not installed** on this machine (no `rea` binary, no REA MCP tools, no REA plugin). Everything below was gathered with Playwright MCP (own site) and Claude in Chrome (LinkedIn Zip, read-only) instead. Same questions, different tools. Screenshots are in `reports/rea_*.png` (gitignored).

## Part 1: Yomi, as it runs today

Run against `next dev` on :3100 and a production build. Test data: the one desktop solve I made wrote a row to `data/solves.jsonl`; I deleted it (file restored to its 15 pre-test rows). The mobile and streak tests stubbed `/api/solves`, so they wrote nothing.

| Question | Evidence |
|---|---|
| Network calls for a solve | Exactly one: `POST /api/solves`, 622 bytes, then `201`. No other API calls. Retry/queue path: `lib/submit.ts` retries once after 1.5 s, then parks the solve in `localStorage` (`yomi_queue`) and resends on the next page load. |
| What is logged, and when | Nothing leaves the browser until the solve finishes or the player hits Skip after moving. Payload is `solve_id`, `player_id`, `puzzle_id`, `device`, `started_at_ms`, `events[]` (one `[ms, row, col, len]` per path change), `played_zip_before`. Server recomputes `solve_ms`, `backtracks`, `completed` and `stuck_cell` from `events`. Undo mid-run: backtrack counter went 0 to 1 and the 1.3 s pause was recorded. |
| Page load and script size | Dev: DOMContentLoaded 110 ms, load 392 ms, 18 JS chunks (dev bundle, not representative). Production build: about 612 KB raw JS+CSS in `.next/static/chunks`, about 183 KB gzipped. |
| Predictions from model.json | **No.** `/model.json` was never requested (resource timing shows no fetch). `web/lib/predict.ts` does not exist. The file is served fine (`200`, 774 bytes) but nothing reads it. |
| Mobile and touch | Pass. 390 px and 360 px: no horizontal overflow, board is 358 px square with `touch-action: none`, a real CDP touch drag solved the puzzle and the event logged `device: "touch"`. Minor: Clear and Skip are 38 px tall (under the usual 44 px tap target). |
| Checks | `npm test` 18/18 (12 before this work), `eslint` clean, `tsc` clean, `ml` unittest 26/26. `next build` exits 1 the first time because of an upgrade banner (see below), passes on retry. |

Other findings:
- The Next.js build and dev server print a "known security vulnerability" notice for Next 16.4.0. Worth a deliberate upgrade decision before the Oct 29 demo; I did not run any upgrade.
- `README.md` lists "show the 3 predicted cells before the solve" as a feature. `CLAUDE.md` says never show predicted stuck cells before the solve ends. They conflict; CLAUDE.md wins.
- `/api/solves` rate limit is keyed on the client-sent `player_id` (known TODO in the route).

### Status against the Sprint 2 checklist (10 lines)

1. Task 1 data quality: **done and working** (dedupe, server-derived fields, tests).
2. Task 2 deploy (Vercel + Neon): **missing**. No live URL, so the "100+ real solves" goal cannot start.
3. Task 3 `ml/features.py`: **done** (26 ml tests pass).
4. Task 4 time model: **partial**. Solver-effort fallback only, correctly unticked.
5. Task 5 stuck-point model: **missing**. `model.json` has `stuck.coef = {}`.
6. Task 6 evaluation, `reports/sprint2_model.md`: **missing**.
7. Task 7 UI (prediction before the solve, predicted vs actual): **missing**. No `predict.ts`.
8. Game, mobile, API, tests: **working**. Nothing broken found.
9. Real risk: data volume. 15 rows total and no deploy means no path to 100+ solves.
10. New this session: daily streak (below). It is the first piece aimed at getting more solves.

## Part 2: what keeps people coming back in LinkedIn's Zip

Observed in the user's own logged-in Chrome, read-only: I did not play the puzzle (it was already solved today, and I did not want to touch their streak), made no bulk requests, and copied no code, text or assets. Not observed because the puzzle was already solved: the live timer start, hint flow and undo flow during play. Only their disabled end-state was visible.

What the page shows:
- **Play screen:** count-up timer, Reset, Undo, Hint, a help link, a short "how to play" with two icons. After solving, Undo/Hint/Reset are disabled and a "See results" button appears.
- **Result screen:** puzzle number, a celebration, a swipeable card carousel (streak card, your time vs today's average, a percentile card), then share actions (post, send, copy).
- **Social layer:** "N connections played today" with a ranked mini leaderboard of the player and nearby connections, per-player badges such as "no hints, no backtracks", a link to the full leaderboard.
- **Streak layer:** a weekly strip of 7 day-circles, a bonus puzzle that unlocks after 7 wins in a row, a badges row, a daily push reminder toggle.
- **Next-step layer:** "Play another game" cards and a side rail linking to sibling games.
- **Network:** the results page fetched one celebration video from the CDN and made one POST to an opaque tracking-style path. Nothing else of note. I did not dig further.

Mechanics ranked by fit for Yomi (goal: more solves = more training data):

| Mechanic | Brings people back? | Fit for Yomi |
|---|---|---|
| Daily streak + week strip | Yes, loss aversion | Works anonymously, localStorage only. **Picked.** |
| Friends leaderboard | Yes, social | Needs identity. Yomi is anonymous-only; Sprint 3 has its own leaderboard. |
| Share card | Acquisition | Already exists (copy line). |
| Bonus puzzle after 7 days | Yes | Needs the streak first. Natural follow-up. |
| Push reminders | Yes | Needs accounts or a service worker. Later. |
| Percentile / avg-time cards | Mixed | Needs real volume. Don't fake it with 15 solves. |

## Spec: Yomi daily streak (10 lines)

1. A "day" is a local calendar day with at least one **completed** solve.
2. Stored on-device only as a list of `YYYY-MM-DD` strings in `localStorage` key `yomi_streak_days` (capped at 400). No server call, nothing new collected.
3. Streak = consecutive days ending today, or ending yesterday while today is still open (so it stays alive until midnight).
4. A lapsed streak shows nothing; no shaming copy.
5. A small orange "N-day streak" chip appears above the board when N is at least 1.
6. If the streak is alive but today is unsolved, the idle hint says "Solve one today to keep your N-day streak".
7. On the result panel: a 7-circle strip (oldest to today, today ringed, day letters under each) plus one line: how many days in a row, "come back tomorrow".
8. Logic lives in `web/lib/streak.ts` as pure functions (`localDay`, `daysBefore`, `streakState`, `addDay`) built from calendar parts so DST cannot skip or repeat a day.
9. Tests: `web/tests/streak.test.ts`, 6 cases (empty, solved today, at-risk, missed-day reset, month and DST boundary, idempotent/bounded add).
10. Out of scope on purpose: friends, push, bonus puzzle, any server-side streak. No streak numbers are claimed anywhere in copy.

Why it should help: a streak gives a reason to open Yomi on a day with no other reason, and each return day is another solve for the training set. This is an expectation from how daily games behave, not something Yomi has measured. Check it later: share of players with 2+ distinct solve days (derivable from `solves.created_at` and `player_id`), before and after.

## Verification of the build

- Desktop 1280 and mobile 360 (real CDP touch drag): chip shows 2, idle nudge shows, solve moves streak to 3, strip fills, stored list is `[d-2, d-1, today]`, a reload keeps 3 and does not double count, one POST per solve, no horizontal overflow.
- First attempt put the streak in the stats row and it wrapped on 360 px; fixed by giving it its own line (stats row children now single-line).
