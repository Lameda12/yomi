# Yomi

ShiftKey Build It! ML project (Dalhousie). The showcase (Oct 29, 2026) is done; the project continues in Sprint 3.

Yomi is a daily Zip-style path puzzle. Everyone gets the same puzzle each local day ("Yomi #N"), then can practice on the original 30. Before each solve it shows a target to beat, and the result card shows it against the actual time. The goal is for an ML model to predict the player's solve time and the 3 cells where they'll get stuck; that model is not trained on human times yet.

Owner: Andi. Works 1 to 2 hours a day. Ship small and working before polished.

## Pitch (use this for any copy, demo, or README text)

Formula: **Hook → Fix → Proof.** Gen Z voice: casual, punchy, a bit of slang, never cringe, never fake.

- **Hook:** You thought "I'll get this in 30 seconds" and then lost 10 minutes. Yomi knows that before you start. 👀
- **Fix:** A new Zip-style path puzzle every day, and a target to beat before you play. Result card shows the target vs your time. The ML model is meant to predict your time and your 3 stuck spots; every solve is stored, and the model is retrained by hand in batches (it does not update while you play).
- **Proof:** Sprint 1: puzzle grid size predicts difficulty (Queens ρ = +0.84 vs solver effort; Lichess solution length ρ = +0.55 vs real human ratings). Sprint 2: idempotent solve pipeline, server-derived results, 429 queueing, ml tests passing. Sprint 3: a daily puzzle with a streak (built, not deployed yet).

Honesty rules for copy (these override hype):
- The time model is still on the solver-effort fallback. Its output is solver steps, not ms. Say "predicts how hard it'll be" until the human-time path runs on 30+ real solves.
- The last retrain (2026-10-22) used 7 usable solves from 1 player. Don't claim accuracy, sample size, or user numbers beyond a fresh count of what is stored.
- The pre-solve target is one of three things, and the copy must say which. A **crowd median** ("Crowd median: 0:38 (5 solves). Beat it.") is a plain median of earlier solves of that puzzle, shown once 3+ exist; it is not a model prediction, and the count is solves, not players. **Solver effort** ("Solver effort: on the easier side") is difficulty for a computer, not a human solve time. A **human-time prediction** ("Predicted by Yomi's solve-time model") appears only when a model with label `human_time` is actually deployed, and then it wins over the crowd median. The target is locked at the first move. Do not describe Yomi as learning while you play.
- Framing: Yomi asks "What makes a puzzle hard for a person?" Peer feedback from the ML presentation (clear problem statement wanted, stronger predictions wanted, game design for collecting data praised) is qualitative classroom feedback, not a user study. Answer it with clearer copy and more real solves, never by lowering `MIN_HUMAN_SOLVES` or other thresholds.
- Never invent metrics, users, or testimonials.

Full pitch and sprint status: `README.md`.

## Current sprint: Sprint 3 (started Oct 22; the Oct 29 showcase is done)

Sprint status, what's done, and what's next: see `README.md` (kept in sync with the checklists below).

Sprint 3, done:

- [x] Daily puzzle: `daily-001`..`daily-120` in `web/data/puzzles.json` (day 0 = 2026-11-03, local calendar days, cycling), "Yomi #N", a countdown to the next one, and **Practice** over the original 30. The streak counts only days the daily was solved. Extreme and `/demo` still play the original 30 only.
- [x] Early time estimate: the crowd median as the pre-solve target while the model predicts solver steps. Locked at the first move, saved as `model_version = crowd-median`.
- [x] Training hygiene: `web/migrations/007_test_rows.sql` marks rows 1 to 8 as `source = 'test'` (**written, not applied**); training drops them. The time-model floor is 15 solves (`MIN_HUMAN_SOLVES`), the stuck model's is still 30.
- [x] Cleanup: `npm run typecheck`, create-next-app boilerplate removed.

Sprint 3, open: apply migration 007 in Neon, deploy, get real solves (the blocker), personalization, model-tuned daily difficulty (not built: the dailies are a fixed pool in a fixed order), retrain on real data.

Sprint 2 tasks (items 4 to 6 are still open; update the checkboxes as you finish them):

- [x] 1. Data quality: dedupe by client `solve_id` (unique constraint + `ON CONFLICT DO NOTHING`; dedupe on read in JSONL mode). Compute `solve_ms`, `backtracks`, `stuck_cell` and `completed` on the server from `events`, ignoring the client's values. Tests for both. (2 h)
- [x] 2. Deploy on Vercel + Neon. Run the migrations. Live URL in README. (1.5 h) Live: https://yomi-pi-topaz.vercel.app. `ADMIN_TOKEN` is not set yet, so `/api/export` is closed in production.
- [x] 3. `ml/features.py`: puzzle features and cell features (see the model contract). (2 h)
- [ ] 4. Difficulty + solve-time model: ridge regression on `log(solve_ms)`, plus a per-player offset. (2.5 h) Unticked: only the solver-effort fallback has run (`trained_on.label = solver_effort`, 13 solves, 1 player, `players: {}`). Re-tick when the human-time path runs on 15+ real solves from 2+ players.
- [ ] 5. Stuck-point model: logistic regression per cell, top 3. (1.5 h) Unticked: `ml/train_stuck.py` and tests are done, but the fit is skipped below 30 usable solves (7 solves, 1 player), so `model.json` has `stuck.coef = {}`. Re-tick when it is fitted on 30+ real solves.
- [ ] 6. Evaluate vs baselines, export `web/public/model.json`, write `reports/sprint2_model.md`. (1 h) Unticked: `python -m ml.pipeline` exports and writes the report, but both leave-one-player-out evals say "not run" (needs 2+ players, 15+ solves per fold for time, 30+ for stuck). Re-tick when real baseline numbers exist.
- [x] 7. UI: prediction before the solve, predicted vs actual on the result card, prediction saved with the solve. (2 h) `lib/predict.ts` matches `ml/test_vectors.json` within 1e-6. While `trained_on.label` is `solver_effort` the UI shows solver steps and a relative read, never ms. Stuck cells come from `/api/stuck` after the solve only (empty until the stuck model is trained).

Extras, only if everything above is done: a test that /stats totals match DB counts; a test that a 429 never drops a solve.

## Repo map

- `prep_datasets.py`: builds `data/puzzles.parquet` from Lichess (human-rated), OpenML Sudoku (solver-rated), Queens community levels (solver backtracks), and generated Zip puzzles.
- `analysis.py`: Spearman correlations of features vs difficulty, writes `reports/`. Reads solves from Neon if `DATABASE_URL` is set, otherwise from `data/solves.jsonl`.
- `reports/sprint1_findings.md`: Sprint 1 results. Lichess solution length vs rating ρ=+0.55 (human label). Queens grid size ρ=+0.84 (solver label). Sudoku label too coarse.
- `web/`: Next 16, React 19, Tailwind 4, zod, Neon.
  - `components/ZipGame.tsx`: the game. Logs path events, backtracks and pauses.
  - `data/puzzles.json`: the 30 original puzzles (frozen, byte for byte: stored solves reference their ids; `tests/puzzles-frozen.test.ts` hashes them) followed by the 120 dailies. **Never run `npm run gen:puzzles`**: it rewrites the whole file. `npm run gen:daily` only appends.
  - `lib/zip.ts`: puzzle logic. `scripts/generate-puzzles.ts` made the original 30; `scripts/generate-daily.ts` made the dailies.
  - `lib/daily.ts`: the day index from local calendar parts (DST safe), "Yomi #N" / "Practice #N" titles, the countdown, and the device-only record of today's result (`yomi_daily`). `lib/estimate.ts`: crowd median vs model for the pre-solve target.
  - `app/api/medians/route.ts`: per-puzzle median and count of solves (3+), read once by the game.
  - `lib/store.ts`: storage switch (Neon if `DATABASE_URL` is set, else `data/solves.jsonl`).
  - `lib/stuck.ts`: server-side stuck-cell calculation.
  - `app/api/solves/route.ts`: POST, zod validation, body cap, rate limit (TODO: keyed on a client-sent id, not real abuse protection).
  - `app/api/export/route.ts`: CSV export.
  - `app/stats/` (What the data shows), `app/learn/` (How Yomi learns), `app/you/` (Your attempts): the learning pages. No leaderboard; `/board` redirects to `/learn`. Charts appear only above the display thresholds in `lib/insights.ts`.
  - `migrations/`, `scripts/migrate.mjs`: Neon schema.
- `ml/` (Sprint 2, new): features, training, evaluation, export.
- `DEMO.md`: showcase talk track. Keep it in sync with behavior.
- `PLAYTEST.md` and `ml/playtest.py`: the seven-day playtest (participants, return players, daily completion from the anonymous records) and what those records cannot say.

Check `package.json` and the scripts for the exact commands before running anything.

## Model contract

`web/public/model.json` is written by `ml/` and read by `web/lib/predict.ts`. Both sides must follow it exactly.

```json
{
  "version": "string",
  "trained_on": {"human_solves": 0, "label": "solver_effort | human_time"},
  "puzzle_features": ["grid_size","n_dots","max_gap","mean_gap","turns","solver_steps"],
  "time": {"intercept": 0.0, "coef": {"grid_size": 0.0}, "residual_std": 0.0},
  "players": {"<player_id>": 0.0},
  "cell_features": ["dist_to_next_dot","is_edge","is_corner","is_turn","segment_len","path_frac"],
  "stuck": {"intercept": 0.0, "coef": {"dist_to_next_dot": 0.0}}
}
```

- Time model predicts `log(solve_ms)`. Predicted ms = `exp(intercept + Σ coef·x + (players[id] ?? 0))`.
- Player offset = the player's mean residual, shrunk toward 0 by `n/(n+3)`.
- Stuck model: logistic score per cell. The top 3 cells are the prediction. Label: 1 for the cell with the longest pause in a solve.
- `solver_steps` = search steps of the Zip uniqueness solver (the same solver as `prep_datasets.py`).
- With fewer than 15 completed human solves (`MIN_HUMAN_SOLVES`, time model only; the stuck model needs 30), fit on `solver_steps` as a stand-in label and set `trained_on.label = "solver_effort"`. Say so in the report and the UI. The crowd median is not part of this contract: it is computed from stored solves by `/api/medians`, not by the model.
- `ml/test_vectors.json`: 5 puzzles with expected features and predictions. The TS implementation must match Python within 1e-6.

Evaluation (leave-one-player-out):
- Time: share of solves within 20% (form target), median absolute % error vs a "mean time" baseline.
- Stuck: top-3 hit rate (form target 60%) vs a random-3-cells baseline.
- Report the real numbers, even when they're bad. Never inflate.

## Data rules

- Training data = completed solves from real humans only. Never train on test or fake solves. Delete fake rows after a test.
- Anonymous only: a `player_id` UUID in localStorage. No names, emails or IP addresses.
- Never commit `data/`, `.env*`, `node_modules`, `.next`, `reports/*.png`.
- Label honesty: always say whether a difficulty label comes from humans or from a solver.
- Train on `mode = 'regular'` solves only (Extreme is played against a clock). Rows tagged `source = 'local_import'` or `'demo'` are real people but can be filtered out by that column. Rows tagged `source = 'test'` (the early test plays, ids 1 to 8, once migration 007 is applied) are never trained on; `EXCLUDED_ROW_IDS` in `ml/train_time.py` covers them until then.

## Conventions

- TypeScript strict. Python 3 with type hints, pathlib and f-strings.
- Error handling on anything production-facing (API routes, storage, model loading). If model.json is missing or invalid, the game still works without predictions.
- Run `npm run typecheck`, `npm run lint` and `npm test` (and `npm run build`; for `ml/`, `python -m unittest discover -s ml -p "test_*.py" -t .`) before every commit. Small commits with clear messages.
- Keep models small: linear and logistic only, training under 1 minute on a laptop, no GPU.
- Mobile and touch must keep working.

## Do not

- Run git commands outside this repo. The parent folder (`/Users/amadi`) is a separate repo. Never touch it.
- Add paid services or anything off a free tier.
- Scrape LinkedIn, or copy LinkedIn's Zip name, look or branding.
- Show predicted stuck cells before the solve ends. Reveal them on the result card only.
- Rewrite working Sprint 1 code without a reason.
- Change, reorder or regenerate the 30 original puzzles in `web/data/puzzles.json`, or add database columns, without being asked.

## How to start a session

1. Read this file, then run `git status` and `git log --oneline -10`.
2. Tell Andi in 5 lines or less where Sprint 3 stands (and the open Sprint 2 items), based on the checkboxes above.
3. Take the next unchecked task. When it's done, tick it here and commit.
