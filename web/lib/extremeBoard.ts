// The Extreme board: each player's best win margin. Server side (hashes ids), so it is kept apart from the
// browser-safe clock math in lib/extreme.ts. Never returns a player_id.
import { createHash } from "node:crypto";

export const MAX_MARGIN_MS = 300_000; // a margin counts for at most this much on the board

export interface ExtremeWin {
  player_id: string;
  margin_ms: number; // limit - solve time, only wins (> 0)
}

export interface ExtremeRow {
  id: string; // opaque per-player row id (not the player_id)
  rank: number;
  name: string;
  best_margin_ms: number;
  wins: number;
}

const rowId = (playerId: string) => createHash("sha256").update(`row:${playerId}`).digest("hex").slice(0, 12);
const anon = (playerId: string) => `Anon ${createHash("sha256").update(playerId).digest("hex").slice(-4)}`;

/** Best (largest) win margin per player, top n. Names: nickname when set, else the anonymous tag. */
export function buildExtremeBoard(wins: ExtremeWin[], names: Map<string, string>, top = 10): ExtremeRow[] {
  const by = new Map<string, number[]>();
  for (const w of wins) {
    if (!Number.isFinite(w.margin_ms) || w.margin_ms <= 0) continue;
    by.set(w.player_id, [...(by.get(w.player_id) ?? []), Math.min(w.margin_ms, MAX_MARGIN_MS)]);
  }
  return [...by]
    .map(([player_id, margins]) => ({ player_id, best: Math.max(...margins), wins: margins.length }))
    .sort((a, b) => b.best - a.best || b.wins - a.wins || a.player_id.localeCompare(b.player_id))
    .slice(0, top)
    .map((r, i) => ({ id: rowId(r.player_id), rank: i + 1, name: names.get(r.player_id) ?? anon(r.player_id), best_margin_ms: r.best, wins: r.wins }));
}
