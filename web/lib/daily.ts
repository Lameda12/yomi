// The daily puzzle. Everyone who opens Yomi on the same local calendar day gets the same puzzle, and it changes at the
// player's own local midnight. Pure date math lives here; the game component owns the state.
//
// A day is a calendar date built from local parts (year, month, day), never "milliseconds / 86400000". A local day is
// 23 or 25 hours long when the clocks change, so dividing by a fixed 24 hours would skip or repeat a puzzle.
import { isShareId } from "./share.ts";
import type { Cell } from "./zip.ts";

/** Day 0: the first daily. 2026-11-03, local time. */
export const DAILY_FIRST_DAY = "2026-11-03";
const EPOCH = { year: 2026, month: 11, day: 3 };

const DAY_MS = 86_400_000;

/** Whole calendar days from day 0 to the local calendar date of `today` (negative before day 0). */
export function daysSinceEpoch(today: Date): number {
  // Date.UTC has no DST, so two calendar dates are always a whole number of days apart.
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
  return Math.round((a - b) / DAY_MS);
}

/** Which puzzle of the daily pool is today's. Always inside the pool, also before day 0 and for an empty pool. */
export function dailyIndex(today: Date, poolLength: number): number {
  if (!(poolLength > 0)) return 0;
  return ((daysSinceEpoch(today) % poolLength) + poolLength) % poolLength;
}

/** The number players see: "Yomi #N". */
export const dailyNumber = (index: number): number => index + 1;

// ---- ids and titles ------------------------------------------------------------------------------------------------

const DAILY_ID = /^daily-(\d{3})$/;

export const isDailyId = (id: string): boolean => DAILY_ID.test(id);

/** 7 for "daily-007", null for any other id. */
export function dailyNumberOf(id: string): number | null {
  const m = DAILY_ID.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * The public name of a puzzle: "Yomi #7" for a daily (the number is in its id), "Practice #18" for the original pool
 * (`position` is its 1-based place in the list, as before). The two number ranges overlap, so the word matters.
 */
export function puzzleTitle(id: string, position: number): string {
  const daily = dailyNumberOf(id);
  if (daily !== null) return `Yomi #${daily}`;
  return position > 0 ? `Practice #${position}` : "Yomi";
}

/**
 * The daily pool (in id order, so index 0 is Yomi #1) and the original practice pool (in the order given).
 * Extreme and the demo play the practice pool only: a sprint's order must stay comparable between runs, and a
 * projector must not show an upcoming daily.
 */
export function splitPuzzles<T extends { id: string }>(puzzles: readonly T[]): { dailies: T[]; practice: T[] } {
  return {
    dailies: puzzles.filter((p) => isDailyId(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1)),
    practice: puzzles.filter((p) => !isDailyId(p.id)),
  };
}

/** The name in share text: "Yomi #7" for a daily, "Yomi Practice #18" for the original pool. */
export const shareLabel = (id: string, position: number): string => (isDailyId(id) ? puzzleTitle(id, position) : `Yomi ${puzzleTitle(id, position)}`);

// ---- the countdown to the next daily ---------------------------------------------------------------------------------

/** Milliseconds until the next local midnight. Correct on 23- and 25-hour days. */
export function msUntilNextDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/** "5:12:09". Rounds up, so it never reads 0:00:00 while time is left. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---- the saved result of today's daily (this device only) ------------------------------------------------------------

export const DAILY_RESULT_KEY = "yomi_daily";

/**
 * What the device keeps about the daily it solved, so reopening the page that day shows the result instead of a fresh
 * puzzle. One record, replaced by the next day's. It holds what the result card needs and nothing the server does not
 * already have: the final path is the player's own.
 */
export interface DailyResult {
  day: string; // the local calendar day it was solved, YYYY-MM-DD
  puzzle_id: string;
  solve_id: string;
  ms: number;
  backtracks: number;
  pause_ms: number | null;
  stuck: Cell | null;
  path: Cell[];
  pred: { value: number; unit: "ms" | "solver_steps"; model_version: string } | null; // what was shown before the first move
  saved: boolean; // the server confirmed the solve; only then does the share link point at the result page
  first_solve: boolean; // no earlier solves on this device
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCell = (v: unknown): v is Cell => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 100);

/** Parse whatever is in storage. Anything that is not a complete, plausible result is null. */
export function parseDailyResult(raw: string | null): DailyResult | null {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (!isObj(v)) return null;
    if (typeof v.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return null;
    if (typeof v.puzzle_id !== "string" || !isDailyId(v.puzzle_id)) return null;
    if (typeof v.solve_id !== "string" || !isShareId(v.solve_id)) return null;
    if (typeof v.ms !== "number" || !Number.isFinite(v.ms) || v.ms <= 0) return null;
    if (!Number.isInteger(v.backtracks) || (v.backtracks as number) < 0) return null;
    if (v.pause_ms !== null && (typeof v.pause_ms !== "number" || !Number.isFinite(v.pause_ms) || v.pause_ms < 0)) return null;
    if (v.stuck !== null && !isCell(v.stuck)) return null;
    if (!Array.isArray(v.path) || v.path.length === 0 || !v.path.every(isCell)) return null;
    if (typeof v.saved !== "boolean" || typeof v.first_solve !== "boolean") return null;
    let pred: DailyResult["pred"] = null;
    if (v.pred !== null) {
      const p = v.pred;
      if (!isObj(p) || typeof p.value !== "number" || !Number.isFinite(p.value) || p.value <= 0) return null;
      if (p.unit !== "ms" && p.unit !== "solver_steps") return null;
      if (typeof p.model_version !== "string" || p.model_version === "") return null;
      pred = { value: p.value, unit: p.unit, model_version: p.model_version };
    }
    return {
      day: v.day, puzzle_id: v.puzzle_id, solve_id: v.solve_id, ms: v.ms, backtracks: v.backtracks as number,
      pause_ms: v.pause_ms as number | null, stuck: v.stuck as Cell | null, path: v.path as Cell[], pred, saved: v.saved, first_solve: v.first_solve,
    };
  } catch {
    return null;
  }
}

export function readDailyResult(): DailyResult | null {
  try {
    return parseDailyResult(localStorage.getItem(DAILY_RESULT_KEY));
  } catch {
    return null; // storage blocked: the game keeps the result in memory for this visit
  }
}

export function writeDailyResult(r: DailyResult): void {
  try {
    localStorage.setItem(DAILY_RESULT_KEY, JSON.stringify(r));
  } catch {}
}

/** The server confirmed this solve: remember it, so the share link on a later visit points at the result page. */
export function markDailySaved(solveId: string): void {
  try {
    const r = parseDailyResult(localStorage.getItem(DAILY_RESULT_KEY));
    if (r && r.solve_id === solveId && !r.saved) localStorage.setItem(DAILY_RESULT_KEY, JSON.stringify({ ...r, saved: true }));
  } catch {}
}
