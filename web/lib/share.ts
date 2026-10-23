// Shareable result links: /r/<solve_id>. The page shows what the server stored for that solve (time and backtracks are
// derived server-side from the move log), never numbers carried in the URL, so a link cannot be edited into a fake time.
// This module is pure so the same copy runs in the game, the share page and the tests.
import { clock } from "./clock.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isShareId = (s: string): boolean => UUID.test(s);
export const sharePath = (solveId: string): string => `/r/${solveId}`;

/** What a share page may show. No player id, no move log. */
export interface SharedSolve {
  solve_id: string;
  puzzle_id: string;
  grid_size: number;
  solve_ms: number;
  backtracks: number;
  mode: "regular" | "extreme";
  extreme_limit_ms: number | null;
  pred: { value: number; unit: "ms" | "solver_steps" } | null;
  name: string; // the player's nickname, or their anonymous label
}

/** The fields of a stored solve that the projection reads (a SolveRow satisfies this). */
export interface SharedSource {
  solve_id: string | null;
  puzzle_id: string;
  grid_size: number;
  solve_ms: number;
  backtracks: number;
  completed: boolean;
  mode?: "regular" | "extreme";
  extreme_limit_ms?: number | null;
  pred_value?: number | null;
  pred_unit?: "ms" | "solver_steps" | null;
}

/** Public projection of a stored solve, or null when it is not a finished solve with an id. */
export function toShared(row: SharedSource, name: string): SharedSolve | null {
  if (!row.completed || !row.solve_id || !isShareId(row.solve_id) || !(row.solve_ms > 0)) return null;
  const hasPred = row.pred_unit && row.pred_value !== null && row.pred_value !== undefined && row.pred_value > 0;
  return {
    solve_id: row.solve_id,
    puzzle_id: row.puzzle_id,
    grid_size: row.grid_size,
    solve_ms: row.solve_ms,
    backtracks: row.backtracks,
    mode: row.mode === "extreme" ? "extreme" : "regular",
    extreme_limit_ms: row.mode === "extreme" ? (row.extreme_limit_ms ?? null) : null,
    pred: hasPred ? { value: row.pred_value as number, unit: row.pred_unit as "ms" | "solver_steps" } : null,
    name,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Anon 3f2a solved a 5×5 in 0:03 with 1 backtrack." */
export function resultLine(s: SharedSolve): string {
  const mode = s.mode === "extreme" ? " on Extreme" : "";
  return `${s.name} solved a ${s.grid_size}×${s.grid_size}${mode} in ${clock(s.solve_ms)} with ${plural(s.backtracks, "backtrack")}.`;
}

/**
 * How the solve compared with Yomi's guess. Only when the model predicted a time: a solver-step count is not a time,
 * so it is never compared with one (the label honesty rule).
 */
export function predictionLine(s: SharedSolve): string | null {
  if (!s.pred || s.pred.unit !== "ms") return null;
  const diff = Math.round(Math.abs(s.solve_ms - s.pred.value) / 1000);
  if (diff < 1) return `Yomi predicted ${clock(s.pred.value)}. Dead on.`;
  return s.solve_ms <= s.pred.value
    ? `Yomi predicted ${clock(s.pred.value)}. Beat it by ${diff}s.`
    : `Yomi predicted ${clock(s.pred.value)}. It was ahead by ${diff}s.`;
}

/** Extreme only: how the solve went against the clock it played. */
export function clockLine(s: SharedSolve): string | null {
  if (s.mode !== "extreme" || s.extreme_limit_ms === null) return null;
  const margin = s.extreme_limit_ms - s.solve_ms;
  return margin >= 0 ? `Beat the clock (${clock(s.extreme_limit_ms)}) by ${clock(margin)}.` : null;
}

/** Text for the share sheet / clipboard. `url` is the absolute link. */
export function shareMessage(label: string, ms: number, backtracks: number, url: string): string {
  return `${label}: ${clock(ms)}, ${plural(backtracks, "backtrack")}. Can you beat it? ${url}`;
}
