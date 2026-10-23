// Extreme mode: the same puzzles, but a countdown. Pure limit math, safe to import from the browser.
// The server-side margin board is in lib/extremeBoard.ts.
//
//   limit = base * factor, where factor starts at 80% and each consecutive Extreme win takes 5 points off, floor 50%.
//   base  = the model's predicted time for this player, when the model predicts milliseconds (human_time label);
//           otherwise the median time of everyone who solved this puzzle (3+ solves needed);
//           otherwise a 60 second limit (base 75 s x 80%).
//   win margin = limit - solve time. The Extreme board ranks each player's best margin.

export const EXTREME_START = 0.8;
export const EXTREME_STEP = 0.05; // percentage points off per consecutive win (80 -> 75 -> 70 ...)
export const EXTREME_FLOOR = 0.5;
export const NO_DATA_MS = 60_000;
export const MIN_LIMIT_MS = 5_000; // a clock tighter than this is not playable on a phone
export const MIN_CROWD = 3; // solves of a puzzle before its median counts as "the crowd"
export const MAX_LIMIT_MS = 600_000; // what the server accepts; a sane cap, not a gameplay rule

export type BaseSource = "model" | "crowd" | "default";

export function extremeFactor(consecutiveWins: number): number {
  const wins = Math.max(0, Math.floor(consecutiveWins));
  return Math.max(EXTREME_FLOOR, Math.round((EXTREME_START - EXTREME_STEP * wins) * 1000) / 1000);
}

/**
 * What the clock is a fraction of. With no data the limit must be exactly 60 s at the start (and then tighten like
 * any other), so the base is 60 s / 80% = 75 s.
 */
export function extremeBase(opts: { modelMs: number | null; crowdMedianMs: number | null }): { ms: number; source: BaseSource } {
  if (opts.modelMs !== null && Number.isFinite(opts.modelMs) && opts.modelMs > 0) return { ms: opts.modelMs, source: "model" };
  if (opts.crowdMedianMs !== null && Number.isFinite(opts.crowdMedianMs) && opts.crowdMedianMs > 0) return { ms: opts.crowdMedianMs, source: "crowd" };
  return { ms: NO_DATA_MS / EXTREME_START, source: "default" };
}

export function extremeLimit(baseMs: number, consecutiveWins: number): number {
  return Math.max(MIN_LIMIT_MS, Math.round(baseMs * extremeFactor(consecutiveWins)));
}
