// "Most Unpredictable": players ranked by how far Yomi's time prediction is from their real time.
//
//   score(player) = average over their solves of min(|actual_ms - predicted_ms|, CAP_MS),  at least MIN_SOLVES solves
//
// Only solves with a prediction in milliseconds count. A prediction in solver steps (the stand-in model) is not a
// time, so subtracting it from milliseconds would be meaningless and those solves are ignored.
// Pure functions: storage and nicknames are passed in. Never returns a player_id.
import { createHash } from "node:crypto";

export const MIN_SOLVES = 3;
export const TOP_N = 10;
// Anyone can pad their error by walking away mid-puzzle, so each solve counts at most this far off.
export const CAP_MS = 120_000;

export interface ScoredSolve {
  player_id: string;
  solve_ms: number;
  pred_value: number; // milliseconds
}

export interface BoardRow {
  id: string; // opaque, stable per player: lets the page animate a row as its rank changes. Not the player_id.
  rank: number;
  name: string;
  avg_error_ms: number;
  solves: number;
}

export interface You {
  solves: number; // solves of yours that count (completed, predicted in ms)
  needed: number; // more solves needed to qualify, 0 once you are on the board
  rank: number | null;
  avg_error_ms: number | null;
  nickname: string | null;
}

/** Stable anonymous label: the last 4 hex digits of a hash of the id. Identifies nobody, never shows the raw id. */
export function anonName(playerId: string): string {
  return `Anon ${createHash("sha256").update(playerId).digest("hex").slice(-4)}`;
}

/** Opaque row id: a hash of the player id with a different prefix than the anon tag, so neither reveals the other. */
export const rowId = (playerId: string) => createHash("sha256").update(`row:${playerId}`).digest("hex").slice(0, 12);

interface Ranked extends BoardRow {
  player_id: string;
}

export function rankPlayers(solves: ScoredSolve[], names: Map<string, string>): Ranked[] {
  const by = new Map<string, number[]>();
  for (const s of solves) {
    if (!Number.isFinite(s.solve_ms) || !Number.isFinite(s.pred_value) || s.pred_value <= 0) continue;
    const err = Math.min(Math.abs(s.solve_ms - s.pred_value), CAP_MS);
    by.set(s.player_id, [...(by.get(s.player_id) ?? []), err]);
  }
  return [...by]
    .filter(([, errs]) => errs.length >= MIN_SOLVES)
    .map(([player_id, errs]) => ({
      player_id,
      id: rowId(player_id),
      name: names.get(player_id) ?? anonName(player_id),
      avg_error_ms: Math.round(errs.reduce((a, b) => a + b, 0) / errs.length),
      solves: errs.length,
      rank: 0,
    }))
    .sort((a, b) => b.avg_error_ms - a.avg_error_ms || b.solves - a.solves || a.player_id.localeCompare(b.player_id))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export function buildBoard(
  solves: ScoredSolve[],
  names: Map<string, string>,
  me?: string,
): { board: BoardRow[]; you: You | null; players: number } {
  const ranked = rankPlayers(solves, names);
  const board = ranked.slice(0, TOP_N).map((r) => ({ id: r.id, rank: r.rank, name: r.name, avg_error_ms: r.avg_error_ms, solves: r.solves }));
  if (!me) return { board, you: null, players: ranked.length };
  const mine = solves.filter((s) => s.player_id === me && Number.isFinite(s.pred_value) && s.pred_value > 0).length;
  const at = ranked.find((r) => r.player_id === me);
  return {
    board,
    players: ranked.length,
    you: {
      solves: mine,
      needed: Math.max(0, MIN_SOLVES - mine),
      rank: at?.rank ?? null,
      avg_error_ms: at?.avg_error_ms ?? null,
      nickname: names.get(me) ?? null,
    },
  };
}
