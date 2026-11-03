// What the pre-solve line shows, and what is saved with the solve as its prediction. Pure functions, no storage.
//
//   1. a model that predicts a time (label human_time) wins,
//   2. else the crowd median of this puzzle, when MIN_CROWD or more solves stand behind it,
//   3. else the model's solver-step count (a read of the puzzle, not a time),
//   4. else nothing. A time is never invented.
//
// The crowd median is saved as { unit: "ms", model_version: "crowd-median" }, so it is never mistaken for a model
// version when the guesses are compared with what happened.
import { MIN_CROWD } from "./extreme.ts";

export const CROWD_VERSION = "crowd-median";

export type Unit = "ms" | "solver_steps";
export type Medians = Record<string, { median_ms: number; n: number }>; // n counts solves, not players

export interface Estimate {
  source: "model" | "crowd";
  value: number;
  unit: Unit;
  version: string; // the model version, or CROWD_VERSION
  n: number | null; // solves behind a crowd median; null for the model
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The /api/medians answer, keeping only well-formed entries that have enough solves. Anything else is an empty map. */
export function parseMedians(raw: unknown): Medians {
  const out: Medians = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v !== "object" || v === null) continue;
    const { median_ms, n } = v as Record<string, unknown>;
    if (isNum(median_ms) && median_ms > 0 && isNum(n) && n >= MIN_CROWD) out[id] = { median_ms: Math.round(median_ms), n };
  }
  return out;
}

/** `model` is the model's own prediction for this puzzle and player (null when there is no model). */
export function chooseEstimate(opts: { model: { value: number; unit: Unit; version: string } | null; crowd: { median_ms: number; n: number } | null | undefined }): Estimate | null {
  const { model, crowd } = opts;
  if (model && model.unit === "ms") return { source: "model", ...model, n: null };
  if (crowd && isNum(crowd.median_ms) && crowd.median_ms > 0 && isNum(crowd.n) && crowd.n >= MIN_CROWD) {
    return { source: "crowd", value: crowd.median_ms, unit: "ms", version: CROWD_VERSION, n: crowd.n };
  }
  if (model) return { source: "model", ...model, n: null };
  return null;
}

/** `locked` is undefined until the first move. From then on it is fixed, even if a better estimate arrives later. */
export function lockEstimate(locked: Estimate | null | undefined, live: Estimate | null): Estimate | null {
  return locked !== undefined ? locked : live;
}

export const toPrediction = (e: Estimate): { value: number; unit: Unit; model_version: string } => ({ value: e.value, unit: e.unit, model_version: e.version });

/** The estimate behind a prediction that was saved earlier (a stored daily result). */
export function estimateFromSaved(p: { value: number; unit: Unit; model_version: string }): Estimate {
  return { source: p.model_version === CROWD_VERSION ? "crowd" : "model", value: p.value, unit: p.unit, version: p.model_version, n: null };
}
