# Yomi

ShiftKey Build It! ML project (Dalhousie). Showcase **Oct 29, 2026**.

Yomi is a daily Zip-style path puzzle. Before each solve, an ML model predicts the player's solve time and the 3 cells where they'll get stuck. The player tries to beat it, and the result card shows predicted vs actual.

Owner: Andi. Works 1 to 2 hours a day. Ship small and working before polished.

## Current sprint: Sprint 2 (Oct 15 to 22)

Definition of Ready: Yomi is live with 100+ real solves and no duplicates. Before each solve, the model predicts the player's time and stuck point. The result card shows predicted vs actual. First evaluation numbers against baselines exist, even if they're not at target yet.

Tasks (update the checkboxes as you finish them):

- [x] 1. Data quality: dedupe by client `solve_id` (unique constraint + `ON CONFLICT DO NOTHING`; dedupe on read in JSONL mode). Compute `solve_ms`, `backtracks`, `stuck_cell` and `completed` on the server from `events`, ignoring the client's values. Tests for both. (2 h)
- [ ] 2. Deploy on Vercel + Neon. Run the migrations. Live URL in README. (1.5 h)
- [ ] 3. `ml/features.py`: puzzle features and cell features (see the model contract). (2 h)
- [ ] 4. Difficulty + solve-time model: ridge regression on `log(solve_ms)`, plus a per-player offset. (2.5 h)
- [ ] 5. Stuck-point model: logistic regression per cell, top 3. (1.5 h)
- [ ] 6. Evaluate vs baselines, export `web/public/model.json`, write `reports/sprint2_model.md`. (1 h)
- [ ] 7. UI: prediction before the solve, predicted vs actual on the result card, prediction saved with the solve. (2 h)

Extras, only if everything above is done: a test that /stats totals match DB counts; a test that a 429 never drops a solve.

Sprint 3 (Oct 22 to 29): personalization, the "Most Unpredictable at Dal" leaderboard, model-tuned daily difficulty, retraining on the full data, showcase demo rehearsal.

## Repo map

- `prep_datasets.py`: builds `data/puzzles.parquet` from Lichess (human-rated), OpenML Sudoku (solver-rated), Queens community levels (solver backtracks), and generated Zip puzzles.
- `analysis.py`: Spearman correlations of features vs difficulty, writes `reports/`. Reads solves from Neon if `DATABASE_URL` is set, otherwise from `data/solves.jsonl`.
- `reports/sprint1_findings.md`: Sprint 1 results. Lichess solution length vs rating ρ=+0.55 (human label). Queens grid size ρ=+0.84 (solver label). Sudoku label too coarse.
- `web/`: Next 16, React 19, Tailwind 4, zod, Neon.
  - `components/ZipGame.tsx`: the game. Logs path events, backtracks and pauses.
  - `lib/zip.ts`: puzzle logic. `scripts/generate-puzzles.ts` writes `web/data/puzzles.json`.
  - `lib/store.ts`: storage switch (Neon if `DATABASE_URL` is set, else `data/solves.jsonl`).
  - `lib/stuck.ts`: server-side stuck-cell calculation.
  - `app/api/solves/route.ts`: POST, zod validation, body cap, rate limit (TODO: keyed on a client-sent id, not real abuse protection).
  - `app/api/export/route.ts`: CSV export.
  - `app/stats/`: stats page (counts, median times, stuck heatmaps, backtracks vs time).
  - `migrations/`, `scripts/migrate.mjs`: Neon schema.
- `ml/` (Sprint 2, new): features, training, evaluation, export.
- `DEMO.md`: showcase talk track. Keep it in sync with behavior.

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
- With fewer than 30 completed human solves, fit on `solver_steps` as a stand-in label and set `trained_on.label = "solver_effort"`. Say so in the report and the UI.
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

## Conventions

- TypeScript strict. Python 3 with type hints, pathlib and f-strings.
- Error handling on anything production-facing (API routes, storage, model loading). If model.json is missing or invalid, the game still works without predictions.
- Run type check + lint (and tests when they exist) before every commit. Small commits with clear messages.
- Keep models small: linear and logistic only, training under 1 minute on a laptop, no GPU.
- Mobile and touch must keep working.

## Do not

- Run git commands outside this repo. The parent folder (`/Users/amadi`) is a separate repo. Never touch it.
- Add paid services or anything off a free tier.
- Scrape LinkedIn, or copy LinkedIn's Zip name, look or branding.
- Show predicted stuck cells before the solve ends. Reveal them on the result card only.
- Rewrite working Sprint 1 code without a reason.

## How to start a session

1. Read this file, then run `git status` and `git log --oneline -10`.
2. Tell Andi in 5 lines or less where Sprint 2 stands, based on the checkboxes above.
3. Take the next unchecked task. When it's done, tick it here and commit.
