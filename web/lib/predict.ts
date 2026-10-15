// Port of ml/features.py + ml/predict.py. Must match ml/test_vectors.json within 1e-6
// (tests/predict.test.ts). Reads web/public/model.json; see "Model contract" in CLAUDE.md.
import type { Cell, Dot } from "./zip.ts";

export const PUZZLE_FEATURES = ["grid_size", "n_dots", "max_gap", "mean_gap", "turns", "solver_steps"] as const;
export const CELL_FEATURES = ["dist_to_next_dot", "is_edge", "is_corner", "is_turn", "segment_len", "path_frac"] as const;
export const TOP_K = 3;

export type PuzzleFeature = (typeof PUZZLE_FEATURES)[number];
export type CellFeature = (typeof CELL_FEATURES)[number];
export type Label = "solver_effort" | "human_time";

export interface SolvedPuzzle {
  n: number;
  dots: Dot[];
  solution: Cell[];
}

export interface Model {
  version: string;
  trained_on: { human_solves: number; label: Label };
  time: { intercept: number; coef: Record<PuzzleFeature, number>; residual_std: number };
  players: Record<string, number>;
  /** null = the stuck block has no coefficients (not fitted yet): no stuck prediction. */
  stuck: { intercept: number; coef: Record<CellFeature, number> } | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameList = (a: unknown, b: readonly string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

function coefs<K extends string>(raw: unknown, names: readonly K[]): Record<K, number> | null {
  if (!isObj(raw) || !names.every((k) => isNum(raw[k]))) return null;
  return Object.fromEntries(names.map((k) => [k, raw[k] as number])) as Record<K, number>;
}

/** Validate a parsed model.json. Anything off-contract returns null, and the game runs without predictions. */
export function parseModel(raw: unknown): Model | null {
  if (!isObj(raw) || typeof raw.version !== "string") return null;
  const { trained_on: on, time, players, stuck } = raw;
  if (!isObj(on) || (on.label !== "solver_effort" && on.label !== "human_time") || !isNum(on.human_solves)) return null;
  if (!sameList(raw.puzzle_features, PUZZLE_FEATURES) || !sameList(raw.cell_features, CELL_FEATURES)) return null;
  if (!isObj(time) || !isNum(time.intercept) || !isNum(time.residual_std)) return null;
  const timeCoef = coefs(time.coef, PUZZLE_FEATURES);
  if (!timeCoef) return null;
  if (!isObj(players) || !Object.values(players).every(isNum)) return null;
  if (!isObj(stuck) || !isNum(stuck.intercept) || !isObj(stuck.coef)) return null;
  let stuckModel: Model["stuck"] = null;
  if (Object.keys(stuck.coef).length > 0) {
    const c = coefs(stuck.coef, CELL_FEATURES);
    if (!c) return null;
    stuckModel = { intercept: stuck.intercept, coef: c };
  }
  return {
    version: raw.version,
    trained_on: { human_solves: on.human_solves, label: on.label },
    time: { intercept: time.intercept, coef: timeCoef, residual_std: time.residual_std },
    players: players as Record<string, number>,
    stuck: stuckModel,
  };
}

// ---------- features ----------------------------------------------------------

function checkBoard(p: SolvedPuzzle) {
  if (p.solution.length < 2) throw new Error("a single-cell board has no path to describe");
  if (p.dots.length < 2) throw new Error("needs at least 2 dots");
}

/** Index in the solution path of each dot, ordered by label. */
function dotIndices(p: SolvedPuzzle): number[] {
  const where = new Map(p.solution.map(([r, c], i) => [r * p.n + c, i]));
  return [...p.dots].sort((a, b) => a[2] - b[2]).map(([r, c]) => where.get(r * p.n + c)!);
}

function isTurn(path: Cell[], i: number): boolean {
  if (i === 0 || i === path.length - 1) return false;
  const [r0, c0] = path[i - 1], [r1, c1] = path[i], [r2, c2] = path[i + 1];
  return r1 - r0 !== r2 - r1 || c1 - c0 !== c2 - c1;
}

/**
 * Search steps of the uniqueness solver: zip_solutions in prep_datasets.py (cap 2, budget 300_000),
 * same move order. Returns budget + 1 when the budget runs out, like the Python side.
 */
export function solverSteps(n: number, dots: Dot[], cap = 2, budget = 300_000): number {
  const label = new Map(dots.map(([r, c, v]) => [r * n + c, v]));
  const one = dots.find((d) => d[2] === 1);
  if (!one) return 0;
  const k = dots.length;
  const seen = new Set<number>([one[0] * n + one[1]]);
  let count = 0, steps = 0;
  const dfs = (r: number, c: number, nxt: number): boolean => {
    steps++;
    if (steps > budget) return true;
    if (seen.size === n * n) {
      if (nxt > k) count++;
      return count >= cap;
    }
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qr = r + dr, qc = c + dc;
      const q = qr * n + qc;
      if (qr < 0 || qr >= n || qc < 0 || qc >= n || seen.has(q)) continue;
      const l = label.get(q);
      if (l !== undefined && l !== nxt) continue;
      seen.add(q);
      if (dfs(qr, qc, l === nxt ? nxt + 1 : nxt)) return true;
      seen.delete(q);
    }
    return false;
  };
  dfs(one[0], one[1], 2);
  return steps;
}

export function puzzleFeatures(p: SolvedPuzzle): Record<PuzzleFeature, number> {
  checkBoard(p);
  const idx = dotIndices(p);
  const gaps = idx.slice(1).map((b, i) => b - idx[i]);
  let turns = 0;
  for (let i = 0; i < p.solution.length; i++) if (isTurn(p.solution, i)) turns++;
  return {
    grid_size: p.n,
    n_dots: p.dots.length,
    max_gap: Math.max(...gaps),
    mean_gap: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    turns,
    solver_steps: solverSteps(p.n, p.dots),
  };
}

/** Features of every cell, in solution order. Same definitions as ml/features.py cell_features. */
export function cellFeatures(p: SolvedPuzzle): { cell: Cell; features: Record<CellFeature, number> }[] {
  checkBoard(p);
  const path = p.solution;
  const last = path.length - 1;
  const idx = dotIndices(p);
  return path.map(([r, c], i) => {
    const nxt = idx.find((d) => d > i);
    const prev = idx.filter((d) => d <= i).reduce((m, d) => Math.max(m, d), 0);
    const edgeR = r === 0 || r === p.n - 1;
    const edgeC = c === 0 || c === p.n - 1;
    return {
      cell: [r, c] as Cell,
      features: {
        dist_to_next_dot: nxt !== undefined ? nxt - i : 0,
        is_edge: edgeR || edgeC ? 1 : 0,
        is_corner: edgeR && edgeC ? 1 : 0,
        is_turn: isTurn(path, i) ? 1 : 0,
        segment_len: nxt !== undefined ? nxt - prev : 0,
        path_frac: i / last,
      },
    };
  });
}

// ---------- predictions ---------------------------------------------------------

/** intercept + sum(coef * x), before any player offset. */
export function baseLogTime(model: Model, feats: Record<PuzzleFeature, number>): number {
  let z = model.time.intercept;
  for (const f of PUZZLE_FEATURES) z += model.time.coef[f] * feats[f];
  return z;
}

/** exp(base + players[id] ?? 0). ms for human_time, solver steps for solver_effort. */
export function timeFromBase(base: number, players: Record<string, number>, playerId?: string | null): number {
  return Math.exp(base + (playerId != null ? (players[playerId] ?? 0) : 0));
}

export function predictTime(model: Model, p: SolvedPuzzle, playerId?: string | null): number {
  return timeFromBase(baseLogTime(model, puzzleFeatures(p)), model.players, playerId);
}

/** Log-odds per cell in solution order; empty when the stuck model is not fitted. */
export function stuckScores(model: Model, p: SolvedPuzzle): { cell: Cell; score: number }[] {
  const s = model.stuck;
  if (!s) return [];
  return cellFeatures(p).map(({ cell, features }) => {
    let z = s.intercept;
    for (const f of CELL_FEATURES) z += s.coef[f] * features[f];
    return { cell, score: z };
  });
}

/** Top-k cells by score. Ties keep solution order (Array.prototype.sort is stable). */
export function stuckTop(model: Model, p: SolvedPuzzle, k = TOP_K): Cell[] {
  return stuckScores(model, p)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.cell);
}

// ---------- what the client gets -----------------------------------------------

/** Model metadata the browser needs: enough to add the player offset and label the units. */
export interface ModelInfo {
  version: string;
  label: Label;
  humanSolves: number;
  players: Record<string, number>;
  stuckFitted: boolean;
}

/** Per-puzzle prediction, computed on the server (the client never sees the solution). */
export interface PuzzlePrediction {
  baseLogTime: number;
  stuck: Cell[]; // empty when the stuck model is not fitted
}

/** Everything the page hands the game; null when model.json is missing or invalid. */
export interface Predictions {
  model: ModelInfo;
  byPuzzle: Record<string, PuzzlePrediction>;
}

export function modelInfo(m: Model): ModelInfo {
  return {
    version: m.version,
    label: m.trained_on.label,
    humanSolves: m.trained_on.human_solves,
    players: m.players,
    stuckFitted: m.stuck !== null,
  };
}

export function puzzlePrediction(m: Model, p: SolvedPuzzle): PuzzlePrediction {
  return { baseLogTime: baseLogTime(m, puzzleFeatures(p)), stuck: stuckTop(m, p) };
}
