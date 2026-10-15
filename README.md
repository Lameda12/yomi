<p align="center">
  <img src="web/public/logo.png" width="160" alt="Yomi logo">
</p>

# Yomi 🧩

**Yomi is a daily path puzzle that guesses how you'll do before you play.**

Connect the numbered dots with one line. Before you start, Yomi predicts your time and the 3 cells you'll get stuck on. Then you try to beat the prediction. The result card shows predicted vs actual, and the model learns from every solve.

Built for the ShiftKey Build It! ML project (Dalhousie). Showcase: **Oct 29, 2026**.

## The pitch (Hook → Fix → Proof)

**Hook:** Everyone's played a puzzle and thought "I'll get this in 30 seconds" and then lost 10 minutes. Yomi knows that about you before you start. 👀

**Fix:** Yomi is a Zip-style path puzzle with an ML model under the hood. It reads the puzzle (grid size, gaps, turns, solver effort) and your past solves, then predicts your time and your stuck spots. You play, you see the receipts, and you get a rematch.

**Proof:**
- Sprint 1: on public data, puzzle size and shape predict difficulty. Queens grid size hits ρ = +0.84 against solver effort. Lichess solution length hits ρ = +0.55 against real human ratings. ([findings](reports/sprint1_findings.md))
- Sprint 2: the solve pipeline is idempotent. Duplicate submits are dropped, results are derived on the server, and 429s get queued instead of lost. 26 ml tests pass.
- Honest status: the model is still on its solver-effort fallback. It has 5 solves from 1 player. That's not enough for a human-time model yet, so the predictions are labeled as solver steps, not milliseconds. We're not hiding it.

## Current sprint: Sprint 2 (Oct 15 to 22)

**Goal:** Yomi is live with 100+ real solves, no duplicates, and a model that predicts time and stuck points before each solve.

### Done ✅
- **Data quality:** dedupe by client `solve_id` (unique constraint + `ON CONFLICT DO NOTHING`). `solve_ms`, `backtracks`, `stuck_cell`, and `completed` are computed on the server, and the client's values are ignored. Tests included.
- **Features:** `ml/features.py` builds puzzle and cell features. 11 tests pass.
- **Solve-time model:** ridge model fitted on solver effort as a stand-in. Human-time path is written but not yet run on real data, so this task is unticked.
- **Test rows:** the 8 early test solves are excluded from training by row id (kept in the data, not deleted).
- **Logo:** added to `web/public/logo.png`.

### Parked / blocked ⏸️
- **Deploy (Vercel + Neon, live URL):** waiting on Andi.
- **Stuck-point model:** needs real solves with pause data. Code can ship first; the fit skips below 30 labeled solves.
- **Evaluation + `reports/sprint2_model.md`:** needs data.
- **UI: prediction before the solve, predicted vs actual on the result card:** needs the model contract to be final and the label check (`solver_effort` shows steps, not ms).

### Features to work on next 🛠️
1. **Get 100+ real solves** (the real blocker). Share the link with friends once it's deployed.
2. **Result card:** predicted vs actual, with a "beat the bot" rematch button.
3. **Stuck-point highlights:** show the 3 predicted cells before the solve.
4. **Model label check in the UI:** if `trained_on.label` is `solver_effort`, show steps, never ms.
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
