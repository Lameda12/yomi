#!/usr/bin/env python3
"""Yomi Sprint 1 analysis: which puzzle features make puzzles hard?

Reads data/puzzles.parquet (from prep_datasets.py) plus logged Yomi solves, then
writes plots and a one-page write-up to reports/.

Usage:
  python analysis.py --source neon             # solves from Neon (DATABASE_URL in .env)
  python analysis.py --source csv              # solves from data/solves.csv (the /api/export file)
  python analysis.py --source csv --csv path/to/export.csv
  python analysis.py --source none             # public datasets only
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

ROOT = Path(__file__).resolve().parent
PUZZLES_PARQUET = ROOT / "data" / "puzzles.parquet"
ZIP_JSON = ROOT / "web" / "data" / "puzzles.json"
REPORTS = ROOT / "reports"
MIN_N = 5  # fewest solves before a correlation is reported


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def spearman(a: pd.Series, b: pd.Series) -> float:
    """Spearman rho without scipy: Pearson correlation of the ranks."""
    ok = a.notna() & b.notna()
    if ok.sum() < 3 or a[ok].nunique() < 2 or b[ok].nunique() < 2:
        return float("nan")
    return float(a[ok].rank().corr(b[ok].rank()))


# ---------- loading solves ----------------------------------------------------

def database_url() -> str | None:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for env in (ROOT / ".env", ROOT / "web" / ".env.local"):
        if not env.exists():
            continue
        for line in env.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "DATABASE_URL" and value.strip():
                return value.strip().strip("\"'")
    return None


def load_solves(source: str, csv_path: Path) -> pd.DataFrame:
    if source == "none":
        return pd.DataFrame()
    if source == "neon":
        import psycopg

        url = database_url()
        if not url:
            raise SystemExit("DATABASE_URL not found (environment, .env or web/.env.local)")
        with psycopg.connect(url, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("select * from solves order by id")
            cols = [d.name for d in cur.description]
            df = pd.DataFrame(cur.fetchall(), columns=cols)
    else:
        if not csv_path.exists():
            raise SystemExit(f"{csv_path} not found. Download it from /api/export?token=...")
        df = pd.read_csv(csv_path)
        for col in ("events", "stuck_cell"):  # JSON text in the export
            df[col] = df[col].map(lambda v: json.loads(v) if isinstance(v, str) and v else None)
    if df.empty:
        return df
    df["completed"] = df["completed"].astype(str).str.lower().isin(("true", "t", "1"))
    # A retried request can insert the same attempt twice.
    return df.drop_duplicates(subset=["player_id", "puzzle_id", "started_at_ms"]).reset_index(drop=True)


# ---------- public datasets ---------------------------------------------------

def dataset_correlations(puz: pd.DataFrame) -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}

    li = puz[puz.source == "lichess"].copy()
    if len(li):
        f = pd.DataFrame(li.features.map(json.loads).tolist(), index=li.index)
        li["pieces"] = li.n_givens
        li["solution_len"] = f.solution_len
        li["n_themes"] = f.themes.map(len)
        li["popularity"] = f.popularity
        li["human_plays"] = li.human_plays
        out["lichess"] = pd.Series({c: spearman(li[c], li.difficulty)
                                    for c in ("solution_len", "pieces", "n_themes", "popularity", "human_plays")})
        out["lichess_n"] = pd.Series({"n": len(li)})
        by_len = li.groupby("solution_len").difficulty.agg(["mean", "size"])
        out["lichess_by_len"] = by_len[by_len["size"] >= 200]["mean"].round(0)

    su = puz[puz.source == "sudoku"]
    if len(su):
        out["sudoku"] = pd.Series({"n_givens": spearman(su.n_givens, su.difficulty)})
        out["sudoku_n"] = pd.Series({"n": len(su), "zero_share": float((su.difficulty == 0).mean())})

    qu = puz[(puz.source == "queens") & puz.solver_backtracks.notna()].copy()
    if len(qu):
        f = pd.DataFrame(qu.features.map(json.loads).tolist(), index=qu.index)
        qu = qu.join(f[["min_region", "max_region", "singleton_regions"]])
        out["queens"] = pd.Series({c: spearman(qu[c], qu.solver_backtracks)
                                   for c in ("grid_size", "min_region", "max_region", "singleton_regions")})
        out["queens_n"] = pd.Series({"n": len(qu)})
        # Grid size dominates, so also report region effects inside one common size.
        top = qu.grid_size.mode().iloc[0]
        same = qu[qu.grid_size == top]
        out["queens_within"] = pd.Series({c: spearman(same[c], same.solver_backtracks)
                                          for c in ("min_region", "max_region", "singleton_regions")})
        out["queens_within_n"] = pd.Series({"n": len(same), "grid": int(top)})
    return out


def plot_datasets(corr: dict[str, pd.Series]) -> None:
    panels = [("lichess", "Lichess: feature vs human rating (Glicko-2)"),
              ("sudoku", "Sudoku: feature vs solver search depth"),
              ("queens", "Queens: feature vs solver backtracks")]
    panels = [(k, t) for k, t in panels if k in corr]
    if not panels:
        return
    fig, axes = plt.subplots(1, len(panels), figsize=(5 * len(panels), 3.6), squeeze=False)
    for ax, (key, title) in zip(axes[0], panels):
        s = corr[key].dropna().sort_values()
        ax.barh(s.index, s.values, color=["#e11d48" if v < 0 else "#f97316" for v in s.values])
        ax.axvline(0, color="#333", lw=0.8)
        ax.set_xlim(-1, 1)
        ax.set_xlabel("Spearman rho")
        ax.set_title(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(REPORTS / "dataset_correlations.png", dpi=140)
    plt.close(fig)


# ---------- Yomi solves -------------------------------------------------------

FEATURES = ("grid_size", "n_dots", "max_gap", "mean_gap", "turns")


def solve_stats(solves: pd.DataFrame, zips: dict[str, dict]) -> dict:
    stats: dict = {"n_rows": len(solves)}
    if solves.empty:
        return stats
    done = solves[solves.completed].copy()
    feats = pd.DataFrame({pid: p["features"] for pid, p in zips.items()}).T[["max_gap", "mean_gap", "turns"]]
    done = done.join(feats.astype(float), on="puzzle_id")
    stats.update(
        n_completed=len(done),
        n_skipped=int((~solves.completed).sum()),
        n_players=int(solves.player_id.nunique()),
        n_puzzles=int(done.puzzle_id.nunique()),
        done=done,
    )
    if len(done):
        stats["median_s"] = float(done.solve_ms.median() / 1000)
        stats["by_grid"] = (done.groupby("grid_size").solve_ms.agg(["median", "size"]) / [1000, 1]).round(1)
        stats["by_device"] = (done.groupby("device").solve_ms.agg(["median", "size"]) / [1000, 1]).round(1)
        stats["by_puzzle"] = done.groupby("puzzle_id").agg(
            solves=("solve_ms", "size"), median_s=("solve_ms", lambda s: round(s.median() / 1000, 1)),
            mean_backtracks=("backtracks", "mean")).sort_values("median_s", ascending=False)
    if len(done) >= MIN_N:
        stats["corr"] = pd.Series({c: spearman(done[c].astype(float), done.solve_ms.astype(float)) for c in FEATURES})
        stats["corr_backtracks"] = spearman(done.backtracks.astype(float), done.solve_ms.astype(float))
    return stats


def plot_solves(stats: dict) -> None:
    done = stats.get("done")
    if done is None or done.empty:
        return
    fig, axes = plt.subplots(1, len(FEATURES), figsize=(3.2 * len(FEATURES), 3.2), sharey=True)
    for ax, col in zip(axes, FEATURES):
        ax.scatter(done[col], done.solve_ms / 1000, s=18, alpha=0.6, color="#f97316")
        ax.set_xlabel(col)
    axes[0].set_ylabel("solve time (s)")
    fig.suptitle(f"Yomi solves (human, n={len(done)}): solve time vs puzzle features", fontsize=10)
    fig.tight_layout()
    fig.savefig(REPORTS / "solve_time_vs_features.png", dpi=140)
    plt.close(fig)


def plot_stuck(solves: pd.DataFrame, zips: dict[str, dict]) -> int:
    """One heatmap per puzzle: how often each cell was the stuck cell."""
    if solves.empty:
        return 0
    rows = solves[solves.stuck_cell.map(lambda v: v is not None and len(v) == 2)]
    ids = [pid for pid in zips if pid in set(rows.puzzle_id)]
    if not ids:
        return 0
    cols = min(4, len(ids))
    nrows = -(-len(ids) // cols)
    fig, axes = plt.subplots(nrows, cols, figsize=(3 * cols, 3.2 * nrows), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, pid in zip(axes.flat, ids):
        n = zips[pid]["n"]
        grid = [[0] * n for _ in range(n)]
        sub = rows[rows.puzzle_id == pid]
        for r, c in sub.stuck_cell:
            if 0 <= r < n and 0 <= c < n:
                grid[int(r)][int(c)] += 1
        ax.axis("on")
        ax.imshow(grid, cmap="Oranges", vmin=0)
        for r, c, v in zips[pid]["dots"]:
            ax.text(c, r, str(v), ha="center", va="center", fontsize=8, fontweight="bold")
        ax.set_xticks([]), ax.set_yticks([])
        ax.set_title(f"{pid} (n={len(sub)})", fontsize=9)
    fig.suptitle("Stuck cells: where the longest pause happened (numbers = dots)", fontsize=10)
    fig.tight_layout()
    fig.savefig(REPORTS / "stuck_heatmaps.png", dpi=140)
    plt.close(fig)
    return len(ids)


# ---------- write-up ----------------------------------------------------------

def fmt(s: pd.Series) -> str:
    return ", ".join(f"{k} {v:+.2f}" for k, v in s.dropna().sort_values(key=abs, ascending=False).items())


def write_findings(corr: dict[str, pd.Series], stats: dict, n_heatmaps: int, source: str) -> Path:
    L: list[str] = ["# Yomi Sprint 1: what makes a puzzle hard?", ""]
    L += ["All correlations are Spearman rho (rank correlation, -1 to +1). "
          "Regenerate with `python analysis.py --source neon|csv`.", ""]
    L += ["## Where each difficulty label comes from", "",
          "| Data | Rows | Difficulty label | Source of label |", "|---|---|---|---|"]
    if "lichess" in corr:
        L.append(f"| Lichess chess puzzles | {int(corr['lichess_n']['n']):,} | Glicko-2 rating | **Humans** (real attempts) |")
    if "sudoku" in corr:
        L.append(f"| Sudoku (OpenML) | {int(corr['sudoku_n']['n']):,} | search depth | **Solver** |")
    if "queens" in corr:
        L.append(f"| Queens community levels | {int(corr['queens_n']['n']):,} | backtrack count | **Solver** (ours, row by row) |")
    L.append(f"| Yomi Zip solves | {stats.get('n_completed', 0)} completed | solve time, backtracks | **Humans** (our prototype) |")
    L += ["", "Solver labels measure how hard a puzzle is for one algorithm, not for a person. "
          "Only Lichess and our own solves are human difficulty.", ""]

    L += ["## Public datasets", ""]
    if "lichess" in corr:
        L.append(f"- **Lichess (human):** {fmt(corr['lichess'])}.")
        by = corr.get("lichess_by_len")
        if by is not None and len(by) >= 2:
            L.append(f"  Mean rating by solution length: " + ", ".join(f"{int(k)} moves {int(v)}" for k, v in by.items()) + ".")
    if "sudoku" in corr:
        L.append(f"- **Sudoku (solver):** n_givens {corr['sudoku']['n_givens']:+.2f}. "
                 f"{corr['sudoku_n']['zero_share']:.0%} of puzzles have difficulty 0 (no search needed), so the label is coarse.")
    if "queens" in corr:
        w, wn = corr["queens_within"], corr["queens_within_n"]
        L.append(f"- **Queens (solver):** {fmt(corr['queens'])}. "
                 f"Inside {int(wn['grid'])}x{int(wn['grid'])} grids only (n={int(wn['n'])}): {fmt(w)}.")
    L.append("")

    L += ["## Yomi solves (human)", ""]
    if not stats.get("n_completed"):
        L.append(f"No completed solves loaded yet (source: {source}). Rerun once the prototype has data.")
    else:
        L.append(f"{stats['n_completed']} completed solves and {stats['n_skipped']} skips from "
                 f"{stats['n_players']} players across {stats['n_puzzles']} puzzles. "
                 f"Median solve time {stats['median_s']:.1f}s.")
        L.append("- Median seconds by grid size: " + ", ".join(
            f"{int(g)}x{int(g)} {r['median']:.1f}s (n={int(r['size'])})" for g, r in stats["by_grid"].iterrows()) + ".")
        if len(stats["by_device"]):
            L.append("- Median seconds by device: " + ", ".join(
                f"{d} {r['median']:.1f}s (n={int(r['size'])})" for d, r in stats["by_device"].iterrows()) + ".")
        if "corr" in stats:
            L.append(f"- Solve time vs puzzle features: {fmt(stats['corr'])}. "
                     f"Solve time vs backtracks: {stats['corr_backtracks']:+.2f}.")
        else:
            L.append(f"- Fewer than {MIN_N} completed solves, so no correlations are reported.")
        hard = stats["by_puzzle"].head(3)
        L.append("- Slowest puzzles: " + ", ".join(f"{pid} {r.median_s}s (n={int(r.solves)})" for pid, r in hard.iterrows()) + ".")
        if stats["n_completed"] < 50:
            L.append(f"- **Caution:** n={stats['n_completed']} is below the 50-solve target; treat these as provisional.")
    L += ["", "## Plots", "", "- `dataset_correlations.png`: feature correlations for the three public datasets."]
    if stats.get("n_completed"):
        L.append("- `solve_time_vs_features.png`: Yomi solve time against each grid feature.")
    if n_heatmaps:
        L.append(f"- `stuck_heatmaps.png`: stuck-cell heatmaps for {n_heatmaps} puzzles.")
    path = REPORTS / "sprint1_findings.md"
    path.write_text("\n".join(L) + "\n")
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["neon", "csv", "none"], default="neon", help="where to read Yomi solves from")
    ap.add_argument("--csv", type=Path, default=ROOT / "data" / "solves.csv", help="CSV export path for --source csv")
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)
    if not PUZZLES_PARQUET.exists():
        raise SystemExit(f"{PUZZLES_PARQUET} missing. Run prep_datasets.py first.")
    puz = pd.read_parquet(PUZZLES_PARQUET)
    zips = {p["id"]: p for p in json.loads(ZIP_JSON.read_text())}

    solves = load_solves(args.source, args.csv)
    log(f"[solves] {len(solves)} rows from {args.source}")
    unknown = set(solves.puzzle_id) - set(zips) if len(solves) else set()
    if unknown:
        log(f"[solves] ignoring {len(unknown)} unknown puzzle ids")
        solves = solves[solves.puzzle_id.isin(zips)]

    corr = dataset_correlations(puz)
    stats = solve_stats(solves, zips)
    plot_datasets(corr)
    plot_solves(stats)
    n_heatmaps = plot_stuck(solves, zips)
    path = write_findings(corr, stats, n_heatmaps, args.source)
    log(f"wrote {path} and plots in {REPORTS}/")
    print(path.read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
