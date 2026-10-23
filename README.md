<p align="center">
  <img src="web/public/logo.png" width="160" alt="Yomi logo">
</p>

# Yomi 🧩

**Yomi is a daily path puzzle that guesses how you'll do before you play.**

Connect the numbered dots with one line. Before you start, Yomi predicts your time. Then you try to beat the prediction. When you finish, the result card shows predicted vs actual, plus the 3 cells it expected you to get stuck on (revealed only after the solve, never before). The model learns from every solve.

Built for the ShiftKey Build It! ML project (Dalhousie). Showcase: **Oct 29, 2026**.

**Play it live: https://yomi-pi-topaz.vercel.app**

## The pitch (Hook → Fix → Proof)

**Hook:** Everyone's played a puzzle and thought "I'll get this in 30 seconds" and then lost 10 minutes. Yomi knows that about you before you start. 👀

**Fix:** Yomi is a Zip-style path puzzle with an ML model under the hood. It reads the puzzle (grid size, gaps, turns, solver effort) and your past solves, then predicts your time before you play and your stuck spots for the result card. You play, you see the receipts, and you get a rematch.

**Proof:**
- Sprint 1: on public data, puzzle size and shape predict difficulty. Queens grid size hits ρ = +0.84 against solver effort. Lichess solution length hits ρ = +0.55 against real human ratings. ([findings](reports/sprint1_findings.md))
- Sprint 2: the solve pipeline is idempotent. Duplicate submits are dropped, results are derived on the server, and 429s get queued instead of lost. 26 ml tests pass.
- Honest status: the model is still on its solver-effort fallback. It has 5 solves from 1 player. That's not enough for a human-time model yet, so the predictions are labeled as solver steps, not milliseconds. We're not hiding it.

## Current sprint: Sprint 2 (Oct 15 to 22)

**Goal:** Yomi is live with 100+ real solves, no duplicates, and a model that predicts time before each solve, with its stuck-point predictions revealed on the result card.

### Done ✅
- **Data quality:** dedupe by client `solve_id` (unique constraint + `ON CONFLICT DO NOTHING`). `solve_ms`, `backtracks`, `stuck_cell`, and `completed` are computed on the server, and the client's values are ignored. Tests included.
- **Deploy:** live on Vercel with Neon Postgres, migrations applied. One real solve on the live URL landed in Neon with the server-derived fields, then was deleted. Next.js upgraded to 16.4.2 for a critical advisory.
- **Prediction UI:** before each solve the game shows Yomi's read of the puzzle (solver steps and an easier/harder cue while the label is `solver_effort`, a time once there is a human-time model). The result card shows predicted vs actual. The prediction is saved with the solve (migration 003). If `model.json` is missing or invalid, the game just runs without predictions. `lib/predict.ts` matches the Python test vectors within 1e-6.
- **Start screen, leaderboard, demo, Extreme:** a new visitor lands on a puzzle with a skippable 3x3 tutorial (practice only: it sends nothing and creates no solve). The nickname is optional and asked once after the first solve, with Skip as the main button. `/board` has the live "Most Unpredictable" board, ranked against the crowd's typical time per puzzle while the model predicts solver steps, and against Yomi's time guess automatically once `model.json` is `human_time`. It opens at 3 players x 3 solves. There is also an Extreme board. `/demo` is a projector screen with live counters and a stuck heatmap. Extreme mode adds a countdown (80% of the model's time, or of the puzzle's crowd median, or 60 s with no data; 5 points tighter per win, floor 50%).
- **Features:** `ml/features.py` builds puzzle and cell features. 11 tests pass.
- **Solve-time model:** ridge model fitted on solver effort as a stand-in. Human-time path is written but not yet run on real data, so this task is unticked.
- **Test rows:** the 8 early test solves are excluded from training by row id (kept in the data, not deleted).
- **Logo:** added to `web/public/logo.png`.

### Parked / blocked ⏸️
- **Stuck-point model:** code and tests are done (`ml/train_stuck.py`). The fit is skipped below 30 usable solves, so no stuck cells are predicted yet.
- **Evaluation + `reports/sprint2_model.md`:** pipeline and report exist (`python -m ml.pipeline`). Both evals say "not run" until there are 2+ players and 30+ solves.

### Features to work on next 🛠️
1. **Get 100+ real solves** (the real blocker). Share the live link with friends.
2. **Result card:** add a "beat the bot" rematch button (predicted vs actual is already there).
3. **Stuck-point highlights:** show the 3 predicted cells on the result card only, after the solve ends. Never before.
4. **Stuck cells on the result card:** wired (`/api/stuck`, after the solve only) but empty until the stuck model is fitted on 30+ real solves.
5. **Stats page:** totals that match the database (extra test).
6. **Sprint 3 (Oct 22 to 29):** personalization, "Most Unpredictable at Dal" leaderboard, model-tuned daily difficulty, retrain on the full data, showcase rehearsal.

## Run it locally

```bash
# web app
cd web
npm install
npm run dev            # http://localhost:3000
npm test               # game + store tests

# ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m ml.train_time --source jsonl   # retrain the time model from data/solves.jsonl
python -m unittest discover -s ml -p "test_*.py" -t .
```

Without `DATABASE_URL`, solves go to `data/solves.jsonl`. With it, they go to Neon.

## Repo map

- `web/`: Next.js 16 + React 19 + Tailwind 4. The game lives in `components/ZipGame.tsx`, puzzle logic in `lib/zip.ts`, and the API in `app/api/`.
- `ml/`: features, training, export, and tests. Writes `web/public/model.json`.
- `analysis.py`, `prep_datasets.py`: public-dataset analysis and data prep.
- `reports/`: Sprint 1 findings and plots.
- `DEMO.md`: showcase talk track.
- `CLAUDE.md`: project brief and sprint plan for the AI coding assistant.

## Privacy

Anonymous only. Players get a random ID stored in their browser. No names, emails, or IP addresses are stored.

---

Owner: Alamedin Sabit ([@Lameda12](https://github.com/Lameda12))
