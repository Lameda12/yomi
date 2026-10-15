# Yomi: 60-second demo

**Run it:** `cd web && npm run dev`, then open http://localhost:3000 (play) and http://localhost:3000/stats.
Without a `DATABASE_URL` it saves solves to `data/solves.jsonl`, so no Neon is needed.

## Talk track (~150 words)

**Problem (10s).** Puzzle sites label difficulty with "easy / medium / hard", usually from a solver or a guess. But what's hard for an algorithm isn't always what's hard for a person. Yomi wants to *predict* how long a human will take, and show that prediction before you start.

**What I built (20s).** Three parts:
1. **Datasets:** 200k Lichess puzzles, 200k Sudoku, 711 Queens levels, combined into one table of puzzle features vs difficulty.
2. **Prototype:** Yomi Zip, a daily path puzzle. *(Play one live.)*
3. **Logging:** every attempt records solve time, backtracks, and the cell where the player paused longest. *(Open /stats: the heatmap shows where people get stuck.)*

**Findings so far (20s).** In Lichess, solution length vs rating gives Spearman ρ = **+0.55**. That's our strongest signal, and its labels come from **real humans**. Queens (ρ = +0.84 for grid size) and Sudoku look strong too, but their labels come from **solvers**, so they measure algorithm effort, not human difficulty. That's exactly why Yomi needs its own human solve data.

**Sprint 2 (10s).** Collect 50+ real Zip solves from playtesters, fit a first solve-time model on puzzle features, and show "predicted: 42s, can you beat it?" before each puzzle.

## If asked

- *Why not just use the solver labels?* Queens backtracks track grid size almost perfectly (ρ = +0.84); within one grid size, region features drop to about 0. The solver mostly counts board size, not what trips people up.
- *How many human solves so far?* Few. Collecting them is the Sprint 2 blocker; /stats updates live.
- *Privacy?* An anonymous random ID per browser, with no accounts or personal data.
