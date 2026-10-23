// Pure helpers behind the "How Yomi learns" page: what the six features mean, how far each one moves the model's guess,
// the model history file, and the honest answer to "did a newer version improve". No file access here (see lib/model.ts).
import { PUZZLE_FEATURES, type Geometry, type Label, type Model, type PuzzleFeature } from "./predict.ts";

export const FEATURE_INFO: Record<PuzzleFeature, { title: string; plain: string; idea: string }> = {
  grid_size: {
    title: "Grid size",
    plain: "How wide the board is: 5 means a 5×5 grid.",
    idea: "A bigger board has more cells to fill and more places to take a wrong turn.",
  },
  n_dots: {
    title: "Number of dots",
    plain: "How many numbered dots the puzzle has.",
    idea: "More dots give you more checkpoints, which may help, or may force a more tangled route.",
  },
  max_gap: {
    title: "Longest gap",
    plain: "The most steps the path takes between two neighbouring numbers, for example from 3 to 4.",
    idea: "A long stretch with no dot to aim at is easy to get lost in.",
  },
  mean_gap: {
    title: "Average gap",
    plain: "The typical number of steps between neighbouring numbers.",
    idea: "On the same board, fewer dots means longer gaps and more freedom, and more ways to wander.",
  },
  turns: {
    title: "Turns",
    plain: "How many times the answer path changes direction.",
    idea: "A path that winds around is harder to see ahead than one that runs in long lines.",
  },
  solver_steps: {
    title: "Solver effort",
    plain: "How many steps a computer search needs to prove the puzzle has exactly one answer.",
    idea: "A rough sign of how tangled the puzzle is for a machine. It is not the same thing as hard for a person.",
  },
};

/** What the model's output means, in words a player can use. */
export function labelPlain(label: Label): { short: string; long: string } {
  return label === "human_time"
    ? { short: "Human solve time", long: "It predicts how long a player takes, in seconds, learned from real solves." }
    : {
        short: "Solver steps (a stand-in)",
        long: "It predicts how many steps a computer search needs for the puzzle, not how long you take. That is a stand-in until there are enough real solves to learn time from.",
      };
}

// ---------- what the model leans on ------------------------------------------------------------------

export interface Effect {
  feature: PuzzleFeature;
  coef: number;
  spread: number; // standard deviation of this feature over the puzzles we have
  logEffect: number; // coef x spread: the change in the log of the guess for a typical difference between puzzles
  multiplier: number; // exp(logEffect): the guess is this many times larger (or smaller) for a typical difference
  used: boolean;
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * How much each feature moves the guess across the puzzles that exist. The raw coefficients cannot be compared with
 * each other (a step of 1 in grid size is not a step of 1 in mean gap), so each is multiplied by how much that feature
 * really varies from puzzle to puzzle. Sorted by the size of the effect.
 */
export function featureEffects(model: Model, table: Record<PuzzleFeature, number>[]): Effect[] {
  if (table.length === 0) return [];
  return PUZZLE_FEATURES.map((feature) => {
    const coef = model.time.coef[feature];
    const spread = sd(table.map((t) => t[feature]));
    const logEffect = coef * spread;
    return { feature, coef, spread, logEffect, multiplier: Math.exp(logEffect), used: coef !== 0 };
  }).sort((a, b) => Math.abs(b.logEffect) - Math.abs(a.logEffect));
}

// ---------- model history ----------------------------------------------------------------------------

export type EvalEntry =
  | { status: "not_run"; reason: string }
  | { status: "scored"; n_solves: number; n_players: number; metrics: Record<string, number> };

export interface HistoryEntry {
  version: string;
  trained_at: string;
  source: string | null;
  rows_read: number | null;
  label: Label;
  human_solves: number;
  players: number;
  time: { intercept: number; coef: Record<string, number>; residual_std: number; eval: EvalEntry };
  stuck: { trained: boolean; solves: number | null; eval: EvalEntry };
  note: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseEval(v: unknown): EvalEntry | null {
  if (!isObj(v)) return null;
  if (v.status === "not_run") return typeof v.reason === "string" ? { status: "not_run", reason: v.reason } : null;
  if (v.status === "scored" && isNum(v.n_solves) && isNum(v.n_players) && isObj(v.metrics)) {
    const metrics: Record<string, number> = {};
    for (const [k, x] of Object.entries(v.metrics)) if (isNum(x)) metrics[k] = x;
    return { status: "scored", n_solves: v.n_solves, n_players: v.n_players, metrics };
  }
  return null;
}

/** Entries that match the shape, oldest first as stored. A malformed entry is dropped, never repaired. */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.version !== "string" || typeof e.trained_at !== "string") continue;
    if (e.label !== "solver_effort" && e.label !== "human_time") continue;
    if (!isNum(e.human_solves) || !isNum(e.players) || !isObj(e.time) || !isObj(e.stuck)) continue;
    const t = e.time;
    const timeEval = parseEval(t.eval);
    const stuckEval = parseEval(e.stuck.eval);
    if (!isNum(t.intercept) || !isNum(t.residual_std) || !isObj(t.coef) || !timeEval || !stuckEval) continue;
    const coef: Record<string, number> = {};
    for (const [k, x] of Object.entries(t.coef)) if (isNum(x)) coef[k] = x;
    out.push({
      version: e.version,
      trained_at: e.trained_at,
      source: typeof e.source === "string" ? e.source : null,
      rows_read: isNum(e.rows_read) ? e.rows_read : null,
      label: e.label,
      human_solves: e.human_solves,
      players: e.players,
      time: { intercept: t.intercept, coef, residual_std: t.residual_std, eval: timeEval },
      stuck: { trained: e.stuck.trained === true, solves: isNum(e.stuck.solves) ? e.stuck.solves : null, eval: stuckEval },
      note: typeof e.note === "string" ? e.note : "",
    });
  }
  return out;
}

/** True when every version has the very same coefficients (so a change in counts did not change the model). */
export function sameCoefficients(history: readonly HistoryEntry[]): boolean {
  if (history.length < 2) return false;
  const key = (h: HistoryEntry) => JSON.stringify([h.time.intercept, Object.entries(h.time.coef).sort(([a], [b]) => a.localeCompare(b))]);
  return history.every((h) => key(h) === key(history[0]));
}

export interface Verdict {
  kind: "unchecked" | "single" | "compared";
  text: string;
}

/** Whether newer versions are better. Only held-out scores count; with fewer than two there is nothing to compare. */
export function improvementVerdict(history: readonly HistoryEntry[]): Verdict {
  const scored = history.filter((h): h is HistoryEntry & { time: { eval: Extract<EvalEntry, { status: "scored" }> } } => h.time.eval.status === "scored");
  if (scored.length === 0) return { kind: "unchecked", text: "We cannot say yet whether newer versions are better. None of them has been checked on held-out data." };
  if (scored.length === 1) return { kind: "single", text: "Only one version has a held-out score, so there is nothing to compare it with yet." };
  const prev = scored[scored.length - 2].time.eval.metrics.median_abs_pct_err;
  const last = scored[scored.length - 1].time.eval.metrics.median_abs_pct_err;
  if (!isNum(prev) || !isNum(last)) return { kind: "single", text: "The two latest scored versions did not report the same measure, so they cannot be compared." };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const dir = last < prev ? "lower" : last > prev ? "higher" : "the same";
  return {
    kind: "compared",
    text: `Median error on held-out players was ${pct(last)} for the latest scored version and ${pct(prev)} for the one before: ${dir === "the same" ? "the same" : `${dir} (${last < prev ? "better" : "worse"})`}. They were trained on different amounts of data, so read it with care.`,
  };
}

// ---------- a small picture of one puzzle ------------------------------------------------------------

export interface PuzzleSketch {
  path: [number, number][];
  dots: { r: number; c: number; label: number }[];
  turns: [number, number][]; // cells where the answer path changes direction
  longestGap: { from: number; to: number; steps: number; path: [number, number][] }; // between two dot labels
}

/** Everything the diagram needs, from the same definitions as the model's features (ml/features.py). */
export function sketchPuzzle(g: Geometry): PuzzleSketch {
  const where = new Map(g.solution.map(([r, c], i) => [`${r},${c}`, i]));
  const ordered = [...g.dots].sort((a, b) => a[2] - b[2]);
  const idx = ordered.map(([r, c]) => where.get(`${r},${c}`) as number);
  let best = { from: 0, to: 1, steps: 0, a: 0, b: 0 };
  for (let i = 1; i < idx.length; i++) {
    const steps = idx[i] - idx[i - 1];
    if (steps > best.steps) best = { from: ordered[i - 1][2], to: ordered[i][2], steps, a: idx[i - 1], b: idx[i] };
  }
  const turns: [number, number][] = [];
  for (let i = 1; i < g.solution.length - 1; i++) {
    const [r0, c0] = g.solution[i - 1], [r1, c1] = g.solution[i], [r2, c2] = g.solution[i + 1];
    if (r1 - r0 !== r2 - r1 || c1 - c0 !== c2 - c1) turns.push([r1, c1]);
  }
  return {
    path: g.solution.map(([r, c]) => [r, c]),
    dots: ordered.map(([r, c, label]) => ({ r, c, label })),
    turns,
    longestGap: { from: best.from, to: best.to, steps: best.steps, path: g.solution.slice(best.a, best.b + 1).map(([r, c]) => [r, c]) },
  };
}
