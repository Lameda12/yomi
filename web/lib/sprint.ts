// Extreme mode is a sprint: solve as many puzzles as you can before the clock runs out. Pure helpers here (duration
// parsing, puzzle order, the on-device best score, clock text); the component owns the state and the timers.
// Scores and the chosen duration live on the player's device only (localStorage, wrapped in try/catch).

export const SPRINT_DEFAULT_S = 60;
export const SPRINT_MIN_S = 10;
export const SPRINT_MAX_S = 600;
export const SPRINT_PRESETS = [30, 60, 120, 300] as const;

export type DurationResult = { ok: true; seconds: number } | { ok: false; error: string };

/** A custom duration typed as a number plus a unit. Minutes may be fractional ("1.5" is 90 s). */
export function parseDuration(value: string, unit: "s" | "min"): DurationResult {
  const text = value.trim().replace(",", ".");
  if (text === "") return { ok: false, error: "Enter a number" };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Numbers only" };
  const n = Number(text);
  const seconds = Math.round(unit === "min" ? n * 60 : n);
  if (!Number.isFinite(seconds) || seconds < SPRINT_MIN_S) return { ok: false, error: `At least ${SPRINT_MIN_S} seconds` };
  if (seconds > SPRINT_MAX_S) return { ok: false, error: `At most ${SPRINT_MAX_S / 60} minutes` };
  return { ok: true, seconds };
}

/** "30 s", "1 min", "2 min 30 s". */
export function durationLabel(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/** Remaining time on the run clock: m:ss, with tenths in the last 10 seconds so the end feels close. */
export function formatRemaining(ms: number): string {
  const left = Math.max(0, ms);
  if (left < 10_000) {
    const tenths = Math.ceil(left / 100); // rounds up, so the clock never reads 0.0 while time is left
    if (tenths < 100) return `0:0${(tenths / 10).toFixed(1)}`;
  }
  const s = Math.ceil(left / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Every run plays the same puzzles in the same order, smallest grids first, so two runs are comparable. */
export function sprintOrder<T extends { n: number }>(puzzles: T[]): T[] {
  return puzzles.map((p, i) => ({ p, i })).sort((a, b) => a.p.n - b.p.n || a.i - b.i).map(({ p }) => p);
}

export interface ScoreResult {
  map: Record<string, number>;
  previous: number | null; // the best before this run for this duration
  isNew: boolean; // beat an earlier best (a first scoring run sets the best but is not a "new best")
}

/** Best score per run length; higher is better. A run that solved nothing never sets a best. */
export function recordScore(map: Record<string, number>, seconds: number, score: number): ScoreResult {
  const key = String(Math.round(seconds));
  const previous = Number.isInteger(map[key]) && map[key] > 0 ? map[key] : null;
  if (!Number.isInteger(score) || score <= 0) return { map, previous, isNew: false };
  if (previous !== null && score <= previous) return { map, previous, isNew: false };
  return { map: { ...map, [key]: score }, previous, isNew: previous !== null };
}

export function parseScores(raw: string | null): Record<string, number> {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number" && Number.isInteger(x) && x > 0));
  } catch {
    return {};
  }
}

export const shareScoreMessage = (score: number, seconds: number, url: string): string =>
  `Yomi Extreme: ${score} puzzle${score === 1 ? "" : "s"} in ${durationLabel(seconds)}. Can you beat it? ${url}`;

// ---- on-device storage ----------------------------------------------------------------------------------------

const SCORES_KEY = "yomi_sprint_scores";
const SECONDS_KEY = "yomi_sprint_seconds";
const RULES_KEY = "yomi_sprint_rules_seen";

export function readScores(): Record<string, number> {
  try {
    return parseScores(localStorage.getItem(SCORES_KEY));
  } catch {
    return {};
  }
}
export function writeScores(map: Record<string, number>): void {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(map));
  } catch {}
}

/** The last duration the player chose, or the default. Anything outside the allowed range is ignored. */
export function readSprintSeconds(): number {
  try {
    const n = Number(localStorage.getItem(SECONDS_KEY));
    return Number.isInteger(n) && n >= SPRINT_MIN_S && n <= SPRINT_MAX_S ? n : SPRINT_DEFAULT_S;
  } catch {
    return SPRINT_DEFAULT_S;
  }
}
export function writeSprintSeconds(seconds: number): void {
  try {
    localStorage.setItem(SECONDS_KEY, String(seconds));
  } catch {}
}

export function sprintRulesSeen(): boolean {
  try {
    return localStorage.getItem(RULES_KEY) === "1";
  } catch {
    return false; // storage blocked: the component keeps an in-memory flag for this visit
  }
}
export function markSprintRulesSeen(): void {
  try {
    localStorage.setItem(RULES_KEY, "1");
  } catch {}
}
