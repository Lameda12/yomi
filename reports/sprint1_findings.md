# Yomi Sprint 1: what makes a puzzle hard?

All correlations are Spearman rho (rank correlation, -1 to +1). Regenerate with `python analysis.py --source neon|csv`.

## Where each difficulty label comes from

| Data | Rows | Difficulty label | Source of label |
|---|---|---|---|
| Lichess chess puzzles | 200,000 | Glicko-2 rating | **Humans** (real attempts) |
| Sudoku (OpenML) | 200,000 | search depth | **Solver** |
| Queens community levels | 711 | backtrack count | **Solver** (ours, row by row) |
| Yomi Zip solves | 0 completed | solve time, backtracks | **Humans** (our prototype) |

Solver labels measure how hard a puzzle is for one algorithm, not for a person. Only Lichess and our own solves are human difficulty.

## Public datasets

- **Lichess (human):** solution_len +0.55, popularity -0.16, n_themes -0.09, human_plays +0.09, pieces -0.02.
  Mean rating by solution length: 1 moves 937, 3 moves 1389, 5 moves 1736, 7 moves 1995, 9 moves 2173, 11 moves 2278, 13 moves 2370.
- **Sudoku (solver):** n_givens +0.04. 43% of puzzles have difficulty 0 (no search needed), so the label is coarse.
- **Queens (solver):** grid_size +0.84, max_region +0.68, singleton_regions -0.02, min_region -0.00. Inside 7x7 grids only (n=212): singleton_regions -0.08, max_region -0.02, min_region -0.02.

## Yomi solves (human)

No completed solves loaded yet (source: none). Rerun once the prototype has data.

## Plots

- `dataset_correlations.png`: feature correlations for the three public datasets.
