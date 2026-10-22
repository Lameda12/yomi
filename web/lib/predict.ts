// Prediction math for the model contract in CLAUDE.md. Pure functions only, no file access, so the
// same code runs in the server and in tests. Loading model.json lives in lib/model.ts.
//
//   time:  predicted value = exp(intercept + sum(coef[f] * x[f]) + (players[id] ?? 0))
//   stuck: score(cell)     = intercept + sum(coef[f] * x[f]); the 3 highest-scoring cells are the prediction
//
// Everything here must match ml/features.py and ml/train_*.py within 1e-6 (see tests/predict.test.ts).
import { solverSteps, type Cell, type Dot } from "./zip.ts";

export const PUZZLE_FEATURES = ["grid_size", "n_dots", "max_gap", "mean_gap", "turns", "solver_steps"] as const;
export const CELL_FEATURES = ["dist_to_next_dot", "is_edge", "is_corner", "is_turn", "segment_len", "path_frac"] as const;
export type PuzzleFeature = (typeof PUZZLE_FEATURES)[number];
export type CellFeature = (typeof CELL_FEATURES)[number];
export type Label = "solver_effort" | "human_time";

export interface Model {
  version: string;
  trained_on: { human_solves: number; label: Label };
  puzzle_features: PuzzleFeature[];
  time: { intercept: number; coef: Record<PuzzleFeature, number>; residual_std: number };
  players: Record<string, number>;
  cell_features: CellFeature[];
  stuck: { intercept: number; coef: Partial<Record<CellFeature, number>> };
}

/** What the features need: the board and its (server-side) solution path. */
export interface Geometry {
  n: number;
  dots: Dot[];
  solution: Cell[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sameList = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/** Validate a parsed model.json against the contract. Returns null for anything that does not match exactly. */
export function parseModel(raw: unknown): Model | null {
  if (!isObj(raw) || typeof raw.version !== "string") return null;
  const trained = raw.trained_on;
  if (!isObj(trained) || !isNum(trained.human_solves)) return null;
  if (trained.label !== "solver_effort" && trained.label !== "human_time") return null;
  if (!sameList(raw.puzzle_features, PUZZLE_FEATURES) || !sameList(raw.cell_features, CELL_FEATURES)) return null;

  const time = raw.time;
  if (!isObj(time) || !isNum(time.intercept) || !isNum(time.residual_std) || !isObj(time.coef)) return null;
  if (!PUZZLE_FEATURES.every((f) => isNum((time.coef as Record<string, unknown>)[f]))) return null;

  const players = raw.players;
  if (!isObj(players) || !Object.values(players).every(isNum)) return null;

  const stuck = raw.stuck;
  if (!isObj(stuck) || !isNum(stuck.intercept) || !isObj(stuck.coef)) return null;
  const keys = Object.keys(stuck.coef);
  // Empty coef = untrained. Anything else must name every cell feature, or the scores would be partial.
  if (keys.length > 0 && !CELL_FEATURES.every((f) => isNum((stuck.coef as Record<string, unknown>)[f]))) return null;

  return raw as unknown as Model;
}

// ---------- features (ports of ml/features.py) ----------------------------------------------

/** Index in the solution path of each dot, ordered by dot label. */
function dotIndices(g: Geometry): number[] {
  const where = new Map(g.solution.map(([r, c], i) => [r * g.n + c, i]));
  return [...g.dots]
    .sort((a, b) => a[2] - b[2])
    .map(([r, c]) => {
      const i = where.get(r * g.n + c);
      if (i === undefined) throw new Error("dot is not on the solution path");
      return i;
    });
}

function isTurn(path: Cell[], i: number): boolean {
  if (i === 0 || i === path.length - 1) return false;
  const [r0, c0] = path[i - 1], [r1, c1] = path[i], [r2, c2] = path[i + 1];
  return r1 - r0 !== r2 - r1 || c1 - c0 !== c2 - c1;
}

export function puzzleFeatures(g: Geometry): Record<PuzzleFeature, number> {
  if (g.solution.length < 2 || g.dots.length < 2) throw new Error("board too small to describe");
  const idx = dotIndices(g);
  const gaps = idx.slice(1).map((v, i) => v - idx[i]);
  let turns = 0;
  for (let i = 0; i < g.solution.length; i++) if (isTurn(g.solution, i)) turns++;
  return {
    grid_size: g.n,
    n_dots: g.dots.length,
    max_gap: Math.max(...gaps),
    mean_gap: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    turns,
    solver_steps: solverSteps(g.n, g.dots),
  };
}

export interface CellRow {
  cell: Cell;
  features: Record<CellFeature, number>;
}

/** Features for every cell on the solution path, in solution order. */
export function cellFeatures(g: Geometry): CellRow[] {
  if (g.solution.length < 2 || g.dots.length < 2) throw new Error("board too small to describe");
  const idx = dotIndices(g);
  const last = g.solution.length - 1;
  return g.solution.map(([r, c], i) => {
    const next = idx.find((d) => d > i);
    const prev = Math.max(0, ...idx.filter((d) => d <= i));
    const edgeR = r === 0 || r === g.n - 1, edgeC = c === 0 || c === g.n - 1;
    return {
      cell: [r, c] as Cell,
      features: {
        dist_to_next_dot: next !== undefined ? next - i : 0,
        is_edge: edgeR || edgeC ? 1 : 0,
        is_corner: edgeR && edgeC ? 1 : 0,
        is_turn: isTurn(g.solution, i) ? 1 : 0,
        segment_len: next !== undefined ? next - prev : 0,
        path_frac: i / last,
      },
    };
  });
}

// ---------- predictions ---------------------------------------------------------------------

/** intercept + sum(coef * x), on the log scale and without the player offset. */
export function timeLog(model: Model, f: Record<PuzzleFeature, number>): number {
  return model.time.intercept + PUZZLE_FEATURES.reduce((s, name) => s + model.time.coef[name] * f[name], 0);
}

/** Predicted value for a player. Unseen players get offset 0. Unit depends on `trained_on.label`. */
export function timeValue(z: number, players: Record<string, number>, playerId?: string): number {
  return Math.exp(z + (playerId !== undefined ? (players[playerId] ?? 0) : 0));
}

export function stuckTrained(model: Model): boolean {
  return Object.keys(model.stuck.coef).length > 0;
}

/** Logistic score per cell, in solution order. Empty for an untrained stuck model. */
export function stuckScores(model: Model, rows: CellRow[]): number[] {
  if (!stuckTrained(model)) return [];
  const coef = model.stuck.coef as Record<CellFeature, number>;
  return rows.map((r) => model.stuck.intercept + CELL_FEATURES.reduce((s, f) => s + coef[f] * r.features[f], 0));
}

/** The k highest-scoring cells, ties broken by solution order. Empty for an untrained stuck model. */
export function topStuck(model: Model, rows: CellRow[], k = 3): Cell[] {
  const scores = stuckScores(model, rows);
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, k)
    .map(({ i }) => rows[i].cell);
}

/** What the page needs per puzzle to show a time prediction. */
export interface TimeInfo {
  label: Label;
  version: string;
  logByPuzzle: Record<string, number>;
  players: Record<string, number>;
}

export function timeInfo(model: Model, puzzles: ({ id: string } & Geometry)[]): TimeInfo {
  const logByPuzzle: Record<string, number> = {};
  for (const p of puzzles) logByPuzzle[p.id] = timeLog(model, puzzleFeatures(p));
  return { label: model.trained_on.label, version: model.version, logByPuzzle, players: model.players };
}
