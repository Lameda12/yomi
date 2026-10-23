// "Most Unpredictable (vs the crowd)": the board used while the live model predicts solver steps, not time.
//
//   error(solve) = |ln(actual_ms / median_ms)|, the median being that puzzle's regular solve times from OTHER players
//   score(player) = mean error over their solves, 3+ qualifying solves; the biggest score ranks first
//
// A solve only qualifies when 2+ solves by other players exist on that puzzle (a median of 2 is fine). A ratio (log) is used so a slow 5x5
// and a slow 6x6 count alike. Each solve counts at most CAP_LN off (x10), so walking away cannot buy the top spot.
// Inputs are completed regular-mode solves with demo volunteers already left out. Never returns a player_id.
import { rowId, anonName } from "./leaderboard.ts";

export const MIN_QUALIFYING = 3; // qualifying solves a player needs
export const MIN_OTHERS = 2; // other players' solves a puzzle needs before it counts as a crowd
export const CAP_LN = Math.log(10);
export const PLAYERS_TO_OPEN = 3; // shown as "Opens at 3 players x 3 solves"

export interface CrowdSolve {
  player_id: string;
  puzzle_id: string;
  solve_ms: number;
}

export interface CrowdRow {
  id: string; // opaque per-player row id (not the player_id)
  rank: number;
  name: string;
  ratio: number; // exp(mean |ln|): "typically x1.8 off the crowd"
  solves: number; // qualifying solves behind the score
}

export interface CrowdYou {
  played: number; // your regular solves
  solves: number; // of those, how many had a crowd to compare with
  rank: number | null;
  ratio: number | null;
  nickname: string | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Scored {
  player_id: string;
  errors: number[];
}

/** Per-player errors against the other players' median, for every solve that has a crowd. */
function score(solves: CrowdSolve[]): Map<string, Scored> {
  const valid = solves.filter((s) => Number.isFinite(s.solve_ms) && s.solve_ms > 0);
  const byPuzzle = new Map<string, CrowdSolve[]>();
  for (const s of valid) byPuzzle.set(s.puzzle_id, [...(byPuzzle.get(s.puzzle_id) ?? []), s]);
  const out = new Map<string, Scored>();
  for (const group of byPuzzle.values()) {
    for (const s of group) {
      const others = group.filter((o) => o.player_id !== s.player_id);
      if (others.length < MIN_OTHERS) continue;
      const err = Math.min(Math.abs(Math.log(s.solve_ms / median(others.map((o) => o.solve_ms)))), CAP_LN);
      const cur = out.get(s.player_id) ?? { player_id: s.player_id, errors: [] };
      cur.errors.push(err);
      out.set(s.player_id, cur);
    }
  }
  return out;
}

export function buildCrowdBoard(
  solves: CrowdSolve[],
  names: Map<string, string>,
  me?: string,
  top = 10,
): { board: CrowdRow[]; you: CrowdYou | null; players: number; progress: { players: number; need: number } } {
  const scored = score(solves);
  const ranked = [...scored.values()]
    .filter((p) => p.errors.length >= MIN_QUALIFYING)
    .map((p) => ({ player_id: p.player_id, mean: p.errors.reduce((a, b) => a + b, 0) / p.errors.length, solves: p.errors.length }))
    .sort((a, b) => b.mean - a.mean || b.solves - a.solves || a.player_id.localeCompare(b.player_id))
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const board = ranked.slice(0, top).map((p) => ({
    id: rowId(p.player_id),
    rank: p.rank,
    name: names.get(p.player_id) ?? anonName(p.player_id),
    ratio: Math.exp(p.mean),
    solves: p.solves,
  }));

  // Progress toward opening: players who have played enough, whether or not their puzzles have a crowd yet.
  const played = new Map<string, number>();
  for (const s of solves) played.set(s.player_id, (played.get(s.player_id) ?? 0) + 1);
  const enough = [...played.values()].filter((n) => n >= MIN_QUALIFYING).length;

  let you: CrowdYou | null = null;
  if (me) {
    const at = ranked.find((p) => p.player_id === me);
    you = {
      played: played.get(me) ?? 0,
      solves: scored.get(me)?.errors.length ?? 0,
      rank: at?.rank ?? null,
      ratio: at ? Math.exp(at.mean) : null,
      nickname: names.get(me) ?? null,
    };
  }
  return { board, you, players: ranked.length, progress: { players: Math.min(PLAYERS_TO_OPEN, enough), need: PLAYERS_TO_OPEN } };
}
