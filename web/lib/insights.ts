// Aggregate insights for the learn and stats pages. Pure functions over stored rows: no storage, no player ids in
// anything they return. Every number here is computed from rows that exist; when there are too few rows the functions
// say what is missing instead of returning a chart.
import type { Rating } from "./difficulty.ts";
import { RATINGS } from "./difficulty.ts";
import type { SolveRow } from "./store.ts";

// What the training script needs before it will fit human solve time (ml/train_time.py MIN_HUMAN_SOLVES).
export const MIN_HUMAN_SOLVES = 30;
export const MIN_TRAIN_PLAYERS = 2;
// ml/train_time.py EXCLUDED_ROW_IDS: the owner's own test plays, rows 1 to 8. A test checks the two stay in step.
export const EXCLUDED_ROW_ID_MAX = 8;

// Provisional display rules for charts that compare the model with what happened. They are a guard against showing a
// pattern that is only one or two people, not a statistical guarantee that the pattern is real.
export const MIN_PLAYERS = 5;
export const MIN_ATTEMPTS = 20;
export const MIN_HEAT_SOLVES = 5; // finished solves of one puzzle before its stuck map is drawn

type Rows = readonly SolveRow[];

/** The training script's filter: finished, timed, Regular mode, a puzzle we know, and not one of the early test rows. */
export function isTrainable(r: SolveRow, puzzleIds: ReadonlySet<string>): boolean {
  if (!r.completed || !Number.isFinite(r.solve_ms) || r.solve_ms <= 0) return false;
  if (r.id >= 1 && r.id <= EXCLUDED_ROW_ID_MAX) return false;
  if (!puzzleIds.has(r.puzzle_id)) return false;
  return (r.mode ?? "regular") === "regular";
}

export interface DataStatus {
  attempts: number; // every stored row, finished or not
  finished: number;
  players: number;
  trainable: number; // what the next training run would use
  trainablePlayers: number;
  needed: number; // MIN_HUMAN_SOLVES - trainable, never below 0
  neededPlayers: number;
}

export function dataStatus(rows: Rows, puzzleIds: ReadonlySet<string>): DataStatus {
  const usable = rows.filter((r) => isTrainable(r, puzzleIds));
  const trainablePlayers = new Set(usable.map((r) => r.player_id)).size;
  return {
    attempts: rows.length,
    finished: rows.filter((r) => r.completed).length,
    players: new Set(rows.map((r) => r.player_id)).size,
    trainable: usable.length,
    trainablePlayers,
    needed: Math.max(0, MIN_HUMAN_SOLVES - usable.length),
    neededPlayers: Math.max(0, MIN_TRAIN_PLAYERS - trainablePlayers),
  };
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- predictions against what happened -------------------------------------------------------

export interface LivePoint {
  predicted_ms: number;
  actual_ms: number;
  grid: number;
}

export interface LiveEval {
  version: string;
  attempts: number; // first tries at a puzzle, finished, with a prediction in ms from this version
  players: number;
  ready: boolean;
  missing: string[]; // plain-English list of what is still short, empty when ready
  otherVersions: number; // eligible attempts predicted by other model versions, left out
  points: LivePoint[]; // only when ready
  overall: { modelErr: number; baselineErr: number; within20: number } | null;
  byGrid: { grid: number; n: number; modelErr: number; baselineErr: number }[]; // grids with MIN_HEAT_SOLVES+ attempts
}

const absPctErr = (pred: number, actual: number) => Math.abs(pred - actual) / actual;

/**
 * The model's own live predictions against the time people took. A prediction is made before the solve, by the model
 * version that was deployed then, so the solve was never in that version's training data: it is a genuine held-out
 * check. Caveats the pages repeat: players see the guess and may try to beat it, and only a player's first try at a
 * puzzle counts (a second try is practice).
 *
 * The baseline is "always guess the typical time", using the median of these same solves. That is slightly generous to
 * the baseline, which makes the comparison harder on the model, not easier.
 */
export function liveEvaluation(rows: Rows, version: string, minPlayers = MIN_PLAYERS, minAttempts = MIN_ATTEMPTS): LiveEval {
  const mine = rows
    .filter((r) => r.completed && (r.mode ?? "regular") === "regular" && r.pred_unit === "ms" && (r.pred_value ?? 0) > 0 && r.solve_ms > 0)
    .sort((a, b) => a.id - b.id);
  const seen = new Set<string>();
  const first = mine.filter((r) => {
    const k = `${r.player_id}|${r.puzzle_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const used = first.filter((r) => r.model_version === version);
  const players = new Set(used.map((r) => r.player_id)).size;

  const missing: string[] = [];
  if (players < minPlayers) missing.push(`${minPlayers - players} more ${minPlayers - players === 1 ? "player" : "players"} (${players} so far)`);
  if (used.length < minAttempts) missing.push(`${minAttempts - used.length} more first tries (${used.length} so far)`);
  const ready = missing.length === 0;
  const out: LiveEval = { version, attempts: used.length, players, ready, missing, otherVersions: first.length - used.length, points: [], overall: null, byGrid: [] };
  if (!ready) return out;

  const typical = median(used.map((r) => r.solve_ms));
  const err = (rs: SolveRow[]) => ({
    modelErr: median(rs.map((r) => absPctErr(r.pred_value as number, r.solve_ms))),
    baselineErr: median(rs.map((r) => absPctErr(typical, r.solve_ms))),
  });
  out.points = used.map((r) => ({ predicted_ms: r.pred_value as number, actual_ms: r.solve_ms, grid: r.grid_size }));
  out.overall = { ...err(used), within20: used.filter((r) => absPctErr(r.pred_value as number, r.solve_ms) <= 0.2).length / used.length };
  const grids = [...new Set(used.map((r) => r.grid_size))].sort((a, b) => a - b);
  for (const g of grids) {
    const rs = used.filter((r) => r.grid_size === g);
    if (rs.length >= MIN_HEAT_SOLVES) out.byGrid.push({ grid: g, n: rs.length, ...err(rs) });
  }
  return out;
}

// ---------- where people got stuck ---------------------------------------------------------------

export interface PuzzleHeat {
  puzzle_id: string;
  n: number; // finished solves with a recorded pause
  players: number;
  cells: { r: number; c: number; n: number }[];
  ready: boolean; // MIN_HEAT_SOLVES+ solves: below that a single cell is a person, not a pattern
}

/** Longest-pause cells per puzzle, from finished Regular solves (a sprint's pace would distort pauses). Aggregate only: no player ids leave this function. */
export function puzzleHeat(rows: Rows, puzzleId: string): PuzzleHeat {
  const mine = rows.filter((r) => r.puzzle_id === puzzleId && r.completed && (r.mode ?? "regular") === "regular" && r.stuck_cell);
  const counts = new Map<string, { r: number; c: number; n: number }>();
  for (const row of mine) {
    const [r, c] = row.stuck_cell as [number, number];
    const k = `${r},${c}`;
    const cur = counts.get(k) ?? { r, c, n: 0 };
    cur.n++;
    counts.set(k, cur);
  }
  return {
    puzzle_id: puzzleId,
    n: mine.length,
    players: new Set(mine.map((r) => r.player_id)).size,
    cells: [...counts.values()],
    ready: mine.length >= MIN_HEAT_SOLVES,
  };
}

// ---------- how hard it felt against how hard the model thinks it is ----------------------------------

export interface FeltVsModel {
  answers: number; // first tries with an answer
  players: number;
  ready: boolean;
  missing: string[];
  rows: { rating: Rating; n: number; meanPercentile: number }[]; // only when ready
}

/**
 * For each answer to "how difficult did that feel?", how hard the model rates the puzzles people gave it, as a percentile
 * among all puzzles (0 = the model's easiest, 100 = its hardest). `scores` is the model's number per puzzle, higher meaning
 * harder; it does not matter whether that number is solver steps or time. Exploratory: an answer is given after the solve
 * and is shaped by how the solve went. First tries only.
 */
export function feltVsModel(rows: Rows, scores: Readonly<Record<string, number>>, minPlayers = MIN_PLAYERS, minAnswers = MIN_ATTEMPTS): FeltVsModel {
  const ids = Object.keys(scores);
  const seen = new Set<string>();
  const answered = rows
    .filter((r) => r.completed && (r.mode ?? "regular") === "regular" && r.perceived_difficulty && RATINGS.includes(r.perceived_difficulty) && r.puzzle_id in scores)
    .sort((a, b) => a.id - b.id)
    .filter((r) => {
      const k = `${r.player_id}|${r.puzzle_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const players = new Set(answered.map((r) => r.player_id)).size;
  const missing: string[] = [];
  if (players < minPlayers) missing.push(`${minPlayers - players} more ${minPlayers - players === 1 ? "player" : "players"} (${players} so far)`);
  if (answered.length < minAnswers) missing.push(`${minAnswers - answered.length} more answers (${answered.length} so far)`);
  const out: FeltVsModel = { answers: answered.length, players, ready: missing.length === 0, missing, rows: [] };
  if (!out.ready || ids.length < 2) return { ...out, ready: out.ready && ids.length >= 2, rows: [] };
  const percentile = (id: string) => (100 * ids.filter((o) => scores[o] < scores[id]).length) / (ids.length - 1);
  for (const rating of RATINGS) {
    const rs = answered.filter((r) => r.perceived_difficulty === rating);
    if (rs.length > 0) out.rows.push({ rating, n: rs.length, meanPercentile: rs.reduce((a, r) => a + percentile(r.puzzle_id), 0) / rs.length });
  }
  return out;
}
