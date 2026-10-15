#!/usr/bin/env python3
"""Yomi Sprint 1: gather puzzle datasets into one common table.

Sources
  lichess  6M+ chess puzzles, rating from real human attempts (Glicko-2), CC0
  sudoku   3M Sudoku puzzles, difficulty from a solver's search depth, CC0
  queens   ~780 community Queens levels from samimsu/queens-game, MIT
  zip      Zip-style path puzzles generated locally (unique solution checked)

Output: data/puzzles.parquet (+ .csv) with a shared schema:
  source, puzzle_id, game, grid_size, n_givens, difficulty, difficulty_kind,
  human_plays, solver_backtracks, features (JSON string)

Usage:
  python prep_datasets.py                     # everything, default sample sizes
  python prep_datasets.py --only queens zip   # just some sources
  python prep_datasets.py --lichess-rows 50000 --sudoku-rows 50000 --zip-count 300
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import random
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import pandas as pd

LICHESS_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
SUDOKU_URL = "https://www.openml.org/data/download/22102301/dataset"  # ARFF, CC0
QUEENS_REPO = "https://github.com/samimsu/queens-game.git"

OUT = Path("data")
RAW = OUT / "raw"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------- Lichess -----------------------------------------------------------

def lichess(rows: int) -> pd.DataFrame:
    import zstandard

    log(f"[lichess] streaming first {rows:,} puzzles")
    req = urllib.request.urlopen(LICHESS_URL, timeout=60)
    reader = zstandard.ZstdDecompressor().stream_reader(req)
    text = io.TextIOWrapper(reader, encoding="utf-8")
    out = []
    for i, r in enumerate(csv.DictReader(text)):
        if i >= rows:
            break
        moves = r["Moves"].split()
        themes = r["Themes"].split()
        out.append({
            "source": "lichess",
            "puzzle_id": r["PuzzleId"],
            "game": "chess",
            "grid_size": 8,
            "n_givens": sum(c.isalpha() for c in r["FEN"].split()[0]),  # pieces on board
            "difficulty": float(r["Rating"]),
            "difficulty_kind": "human_glicko2",
            "human_plays": int(r["NbPlays"]),
            "solver_backtracks": None,
            "features": json.dumps({
                "solution_len": len(moves) - 1,  # first move is the opponent's
                "rating_deviation": int(r["RatingDeviation"]),
                "popularity": int(r["Popularity"]),
                "themes": themes,
            }),
        })
    req.close()
    return pd.DataFrame(out)


# ---------- Sudoku ------------------------------------------------------------

def sudoku(rows: int) -> pd.DataFrame:
    path = RAW / "sudoku.arff"
    if not path.exists():
        log("[sudoku] downloading ARFF from OpenML (~500 MB, one time)")
        RAW.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(SUDOKU_URL, path)
    log(f"[sudoku] reading first {rows:,} puzzles")
    out = []
    with path.open(encoding="utf-8") as f:
        for line in f:  # skip ARFF header
            if line.strip().lower() == "@data":
                break
        for row in csv.reader(f):
            if len(out) >= rows:
                break
            if len(row) < 5:
                continue
            pid, puzzle, solution, clues, diff = (x.strip().strip("'") for x in row[:5])
            grid = puzzle.replace(".", "0")
            out.append({
                "source": "sudoku",
                "puzzle_id": pid,
                "game": "sudoku",
                "grid_size": 9,
                "n_givens": int(float(clues)),
                "difficulty": float(diff),
                "difficulty_kind": "solver_search_depth",
                "human_plays": None,
                "solver_backtracks": None,
                "features": json.dumps({"empty_cells": grid.count("0")}),
            })
    return pd.DataFrame(out)


# ---------- Queens ------------------------------------------------------------

def queens_backtracks(regions: list[list[str]], budget: int = 200_000) -> tuple[int, int]:
    """Count backtracks and solutions (capped at 2) for a plain row-by-row solver.
    Backtrack count is a cheap, human-free difficulty proxy."""
    n = len(regions)
    cols, regs, placed = set(), set(), []
    backtracks = solutions = 0

    def ok(r: int, c: int) -> bool:
        if c in cols or regions[r][c] in regs:
            return False
        return not (placed and abs(placed[-1] - c) <= 1)  # no touching, incl. diagonal

    def go(r: int) -> bool:
        nonlocal backtracks, solutions
        if backtracks > budget:
            return True
        if r == n:
            solutions += 1
            return solutions >= 2
        for c in range(n):
            if ok(r, c):
                cols.add(c); regs.add(regions[r][c]); placed.append(c)
                if go(r + 1):
                    return True
                cols.discard(c); regs.discard(regions[r][c]); placed.pop()
                backtracks += 1
        return False

    go(0)
    if backtracks > budget:
        return -1, -1  # too hard for the plain solver within budget
    return backtracks, solutions


def queens() -> pd.DataFrame:
    repo = RAW / "queens-game"
    if not repo.exists():
        log("[queens] cloning samimsu/queens-game")
        RAW.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", "-q", QUEENS_REPO, str(repo)], check=True)
    files = sorted((repo / "src/utils/community-levels").glob("level*.ts"))
    log(f"[queens] parsing {len(files)} community levels")
    out = []
    for fp in files:
        src = fp.read_text(encoding="utf-8")
        m = re.search(r"colorRegions:\s*(\[[\s\S]*?\],?\s*\])\s*,", src)
        if not m:
            continue
        try:
            regions = json.loads(re.sub(r",\s*]", "]", m.group(1)))
        except json.JSONDecodeError:
            continue
        n = len(regions)
        if n == 0 or any(len(row) != n for row in regions):
            continue
        sizes: dict[str, int] = {}
        for row in regions:
            for ch in row:
                sizes[ch] = sizes.get(ch, 0) + 1
        bt, sols = queens_backtracks(regions)
        out.append({
            "source": "queens",
            "puzzle_id": fp.stem,
            "game": "queens",
            "grid_size": n,
            "n_givens": 0,
            "difficulty": None,
            "difficulty_kind": "none",
            "human_plays": None,
            "solver_backtracks": bt if bt >= 0 else None,
            "features": json.dumps({
                "n_regions": len(sizes),
                "min_region": min(sizes.values()),
                "max_region": max(sizes.values()),
                "singleton_regions": sum(v == 1 for v in sizes.values()),
                "unique_solution": sols == 1 if sols >= 0 else None,
            }),
        })
    return pd.DataFrame(out)


# ---------- Zip (generated) ---------------------------------------------------

def random_hamiltonian_path(n: int, rng: random.Random) -> list[tuple[int, int]] | None:
    """Random Hamiltonian path on an n x n grid via Warnsdorff-style DFS."""
    total = n * n
    start = (rng.randrange(n), rng.randrange(n))
    path, seen = [start], {start}

    def nbrs(p):
        r, c = p
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (r + dr, c + dc)
            if 0 <= q[0] < n and 0 <= q[1] < n and q not in seen:
                yield q

    steps = 0
    def dfs() -> bool:
        nonlocal steps
        steps += 1
        if steps > 200_000:
            return False
        if len(path) == total:
            return True
        cand = list(nbrs(path[-1]))
        rng.shuffle(cand)
        cand.sort(key=lambda q: sum(1 for _ in nbrs(q)))  # fewest exits first
        for q in cand:
            path.append(q); seen.add(q)
            if dfs():
                return True
            path.pop(); seen.discard(q)
        return False

    return path if dfs() else None


def zip_solutions(n: int, dots: dict[tuple[int, int], int], cap: int = 2,
                  budget: int = 300_000, steps_out: list[int] | None = None) -> int:
    """Count paths (capped) that start at dot 1, visit every cell, and hit dots in order.
    Returns -1 if the search budget runs out (puzzle is then skipped)."""
    order = {v: k for k, v in dots.items()}
    k = len(order)
    start = order[1]
    seen, count, steps = {start}, 0, 0

    def dfs(p, nxt) -> bool:
        nonlocal count, steps
        steps += 1
        if steps > budget:
            return True
        if len(seen) == n * n:
            if nxt > k:
                count += 1
            return count >= cap
        r, c = p
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (r + dr, c + dc)
            if not (0 <= q[0] < n and 0 <= q[1] < n) or q in seen:
                continue
            label = dots.get(q)
            if label is not None and label != nxt:
                continue
            seen.add(q)
            if dfs(q, nxt + 1 if label == nxt else nxt):
                return True
            seen.discard(q)
        return False

    dfs(start, 2)
    if steps_out is not None:
        steps_out.append(steps)  # search steps used (budget + 1 if it ran out)
    return -1 if steps > budget else count


def zip_puzzles(count: int, seed: int = 7) -> pd.DataFrame:
    rng = random.Random(seed)
    log(f"[zip] generating {count} puzzles (5x5 and 6x6, unique solution)")
    out, tries = [], 0
    while len(out) < count and tries < count * 40:
        tries += 1
        n = rng.choice((5, 6, 6))
        path = random_hamiltonian_path(n, rng)
        if not path:
            continue
        # Start sparse, then add waypoints from the hidden path until the
        # solution is unique (each added dot shrinks the search a lot).
        chosen = {0, len(path) - 1, *rng.sample(range(1, len(path) - 1), n - 2)}
        free = [i for i in range(1, len(path) - 1) if i not in chosen]
        rng.shuffle(free)
        unique = False
        while True:
            idx = sorted(chosen)
            dots = {path[i]: j + 1 for j, i in enumerate(idx)}
            sols = zip_solutions(n, dots, budget=60_000)
            if sols == 1:
                unique = True
                break
            if not free or len(chosen) > n + 8:
                break
            chosen.add(free.pop())
        if not unique:
            continue
        gaps = [idx[j + 1] - idx[j] for j in range(len(idx) - 1)]
        turns = sum(
            1 for i in range(1, len(path) - 1)
            if (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
            != (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
        )
        out.append({
            "source": "zip_generated",
            "puzzle_id": f"zip{len(out):04d}",
            "game": "zip",
            "grid_size": n,
            "n_givens": len(dots),
            "difficulty": None,
            "difficulty_kind": "none",
            "human_plays": None,
            "solver_backtracks": None,
            "features": json.dumps({
                "dots": [[r, c, v] for (r, c), v in dots.items()],
                "solution": path,
                "max_gap": max(gaps),
                "mean_gap": round(sum(gaps) / len(gaps), 2),
                "turns": turns,
            }),
        })
    return pd.DataFrame(out)


# ---------- main --------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="+", choices=["lichess", "sudoku", "queens", "zip"])
    ap.add_argument("--lichess-rows", type=int, default=200_000)
    ap.add_argument("--sudoku-rows", type=int, default=200_000)
    ap.add_argument("--zip-count", type=int, default=200)
    args = ap.parse_args()
    want = set(args.only or ["lichess", "sudoku", "queens", "zip"])

    jobs = {
        "lichess": lambda: lichess(args.lichess_rows),
        "sudoku": lambda: sudoku(args.sudoku_rows),
        "queens": queens,
        "zip": lambda: zip_puzzles(args.zip_count),
    }
    frames = []
    for name in ("lichess", "sudoku", "queens", "zip"):
        if name not in want:
            continue
        try:
            df = jobs[name]()
            log(f"[{name}] {len(df):,} rows")
            frames.append(df)
        except Exception as e:  # keep going if one source is down
            log(f"[{name}] FAILED: {e}")

    if not frames:
        log("nothing collected")
        return 1
    OUT.mkdir(exist_ok=True)
    all_df = pd.concat(frames, ignore_index=True)
    all_df.to_parquet(OUT / "puzzles.parquet", index=False)
    all_df.to_csv(OUT / "puzzles.csv", index=False)
    log(f"wrote {len(all_df):,} rows -> {OUT/'puzzles.parquet'}")
    print(all_df.groupby("source").agg(rows=("puzzle_id", "size"), mean_grid=("grid_size", "mean")).to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
