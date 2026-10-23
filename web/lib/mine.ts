// "Your attempts": what one player's own stored rows say. Pure functions, safe to import in the browser. Everything
// here is about the caller's own data, so there is no comparison with other players and no aggregate.
import type { Rating } from "./difficulty.ts";
import { median } from "./insights.ts";
import type { GameEvent } from "./stuck.ts";

export interface Attempt {
  solve_id: string | null;
  created_at: string;
  puzzle_id: string;
  puzzle_number: number | null; // the public number of the puzzle (its position in the list), when it still exists
  grid_size: number;
  mode: "regular" | "extreme";
  completed: boolean;
  solve_ms: number;
  backtracks: number;
  max_pause_ms: number | null;
  stuck_cell: [number, number] | null;
  pred_value: number | null;
  pred_unit: "ms" | "solver_steps" | null;
  model_version: string | null;
  perceived_difficulty: Rating | null; // your own optional answer
  events: GameEvent[];
}

export interface MinePuzzle {
  n: number;
  dots: [number, number, number][];
}

export interface Mine {
  attempts: Attempt[]; // newest first
  total: number; // all the player's attempts; more than attempts.length when the list is capped
  puzzles: Record<string, MinePuzzle>;
}

export interface SizeSummary {
  grid: number;
  count: number;
  best: number;
  median: number;
}

/** Finished Regular attempts per board size. Sprint runs are left out: they are played against a clock. */
export function sizeSummaries(attempts: readonly Attempt[]): SizeSummary[] {
  const by = new Map<number, number[]>();
  for (const a of attempts) {
    if (!a.completed || a.mode !== "regular" || !(a.solve_ms > 0)) continue;
    by.set(a.grid_size, [...(by.get(a.grid_size) ?? []), a.solve_ms]);
  }
  return [...by]
    .sort(([a], [b]) => a - b)
    .map(([grid, ms]) => ({ grid, count: ms.length, best: Math.min(...ms), median: median(ms) }));
}

/** Which try at its puzzle each attempt was (1 = first), counted over this player's attempts in time order. */
export function tryNumbers(attempts: readonly Attempt[]): Map<Attempt, number> {
  const seen = new Map<string, number>();
  const out = new Map<Attempt, number>();
  const oldestFirst = [...attempts].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const a of oldestFirst) {
    const n = (seen.get(a.puzzle_id) ?? 0) + 1;
    seen.set(a.puzzle_id, n);
    out.set(a, n);
  }
  return out;
}

export interface VsGuess {
  guess_ms: number;
  ratio: number; // actual / guess
}

/** How the time compares with Yomi's guess. Null unless the guess was a time: solver steps are not comparable. */
export function vsGuess(a: Pick<Attempt, "completed" | "solve_ms" | "pred_value" | "pred_unit">): VsGuess | null {
  if (!a.completed || a.pred_unit !== "ms" || !(a.pred_value && a.pred_value > 0) || !(a.solve_ms > 0)) return null;
  return { guess_ms: a.pred_value, ratio: a.solve_ms / a.pred_value };
}

export const fmtClock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The sentence under an attempt about the guess. `solverSteps` says the guess was in steps, not a time. */
export function guessLine(a: Attempt): string | null {
  const v = vsGuess(a);
  if (v) {
    const pct = Math.round(Math.abs(1 - v.ratio) * 100);
    const gap = pct < 10 ? "close to" : v.ratio < 1 ? `${pct}% faster than` : `${pct}% slower than`;
    return `Yomi guessed ${fmtClock(v.guess_ms)}. You took ${fmtClock(a.solve_ms)}, ${gap} the guess.`;
  }
  if (a.pred_unit === "solver_steps") return "Yomi's guess was in solver steps, not a time, so there is nothing to compare.";
  return null;
}

/** The player's own data as a file: their attempts as stored, without anyone else's and without their anonymous id. */
export function exportJson(m: Mine, exportedAt: string): string {
  return JSON.stringify({ exported_at: exportedAt, note: "Your own attempts from Yomi. Times are milliseconds. Events are [ms since first move, row, col, path length].", total_attempts: m.total, attempts: m.attempts }, null, 2);
}
