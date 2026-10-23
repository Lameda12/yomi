import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getSql } from "./db.ts";
import { dedupeBySolveId } from "./dedupe.ts";
import { nicknameKey } from "./nickname.ts";
import type { GameEvent } from "./stuck.ts";

/** One stored attempt, shaped like a row of the `solves` table. */
export type SolveRow = {
  id: number;
  solve_id: string | null; // null for rows logged before solve ids existed
  created_at: string;
  player_id: string;
  puzzle_id: string;
  grid_size: number;
  n_dots: number;
  device: "mouse" | "touch" | null;
  started_at_ms: number;
  ended_at_ms: number;
  solve_ms: number;
  completed: boolean;
  events: GameEvent[];
  backtracks: number;
  max_pause_ms: number | null;
  stuck_cell: [number, number] | null;
  played_zip_before: boolean | null;
  // Prediction shown before the solve (optional: rows from before this existed, or visits without a model).
  pred_value?: number | null;
  pred_unit?: "ms" | "solver_steps" | null;
  model_version?: string | null;
  source?: string | null; // null = played on the live site; 'local_import' = copied in from the owner's machine
};

export type NewSolve = Omit<SolveRow, "id" | "created_at" | "solve_id"> & { solve_id: string };

// Without DATABASE_URL, solves go to a local JSONL file (repo-root data/, next to puzzles.parquet).
export const SOLVES_JSONL = process.env.SOLVES_JSONL ?? path.join(process.cwd(), "..", "data", "solves.jsonl");

export const storageLabel = () => (getSql() ? "Neon" : "local file (data/solves.jsonl)");

async function readFileRows(): Promise<SolveRow[]> {
  let text: string;
  try {
    text = await readFile(SOLVES_JSONL, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: SolveRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A half-written last line from a crash; skip it.
    }
  }
  return dedupeBySolveId(rows);
}

/** Solves this player stored in the last hour. */
export async function recentSolveCount(playerId: string): Promise<number> {
  const sql = getSql();
  if (sql) {
    const [{ n }] = await sql`
      select count(*)::int as n from solves
      where player_id = ${playerId} and created_at > now() - interval '1 hour'`;
    return n;
  }
  const since = Date.now() - 60 * 60_000;
  return (await readFileRows()).filter((r) => r.player_id === playerId && Date.parse(r.created_at) > since).length;
}

/** Store a solve. Returns false when this solve_id is already stored (a retried request). */
export async function insertSolve(s: NewSolve): Promise<boolean> {
  const sql = getSql();
  if (sql) {
    const rows = await sql`
      insert into solves (solve_id, player_id, puzzle_id, grid_size, n_dots, device, started_at_ms, ended_at_ms,
                          solve_ms, completed, events, backtracks, max_pause_ms, stuck_cell, played_zip_before,
                          pred_value, pred_unit, model_version)
      values (${s.solve_id}, ${s.player_id}, ${s.puzzle_id}, ${s.grid_size}, ${s.n_dots}, ${s.device},
              ${s.started_at_ms}, ${s.ended_at_ms}, ${s.solve_ms}, ${s.completed},
              ${JSON.stringify(s.events)}::jsonb, ${s.backtracks}, ${s.max_pause_ms},
              ${s.stuck_cell ? `{${s.stuck_cell[0]},${s.stuck_cell[1]}}` : null}::int[], ${s.played_zip_before},
              ${s.pred_value ?? null}, ${s.pred_unit ?? null}, ${s.model_version ?? null})
      on conflict (solve_id) do nothing
      returning id`;
    return rows.length > 0;
  }
  const existing = await readFileRows();
  if (existing.some((r) => r.solve_id === s.solve_id)) return false;
  const id = existing.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const row: SolveRow = { id, created_at: new Date().toISOString(), ...s };
  await mkdir(path.dirname(SOLVES_JSONL), { recursive: true });
  await appendFile(SOLVES_JSONL, JSON.stringify(row) + "\n");
  return true;
}

/** Every stored solve, oldest first. Fine at prototype scale; the CSV export pages Neon itself. */
export async function allSolves(): Promise<SolveRow[]> {
  const sql = getSql();
  if (!sql) return readFileRows();
  const rows = await sql`select * from solves order by id`;
  // Neon returns bigint columns as strings.
  return rows.map((r) => ({
    ...(r as SolveRow),
    id: Number(r.id),
    created_at: new Date(r.created_at).toISOString(),
    started_at_ms: Number(r.started_at_ms),
    ended_at_ms: Number(r.ended_at_ms),
  }));
}

/** File-mode rows for the CSV export (Neon mode streams pages straight from the database). */
export const fileSolves = readFileRows;

// ---------- leaderboard + nicknames ----------------------------------------------------------

/** A solve that can be scored for "Most Unpredictable": completed, with a prediction in milliseconds. */
export interface PredictedSolve {
  player_id: string;
  solve_ms: number;
  pred_value: number;
}

export async function predictedSolves(): Promise<PredictedSolve[]> {
  const sql = getSql();
  if (sql) {
    const rows = await sql`
      select player_id, solve_ms, pred_value from solves
      where completed and pred_unit = 'ms' and pred_value > 0 and source is null`;
    return rows.map((r) => ({ player_id: String(r.player_id), solve_ms: Number(r.solve_ms), pred_value: Number(r.pred_value) }));
  }
  return (await readFileRows())
    .filter((r) => r.completed && r.pred_unit === "ms" && (r.pred_value ?? 0) > 0 && !r.source)
    .map((r) => ({ player_id: r.player_id, solve_ms: r.solve_ms, pred_value: r.pred_value as number }));
}

/** Totals for the stats tiles: completed solves and distinct players. */
export async function solveTotals(): Promise<{ solves: number; players: number }> {
  const sql = getSql();
  if (sql) {
    const [r] = await sql`select count(*) filter (where completed)::int as solves, count(distinct player_id)::int as players from solves`;
    return { solves: r.solves, players: r.players };
  }
  const rows = await readFileRows();
  return { solves: rows.filter((r) => r.completed).length, players: new Set(rows.map((r) => r.player_id)).size };
}

// ---------- players (optional nicknames) -----------------------------------------------------

const NAME_COOLDOWN_MS = 5_000; // one nickname write per player per 5 s
const NEW_PLAYERS_PER_MINUTE = 60; // cap on brand-new nicknames, so fresh UUIDs cannot flood the table

export type SavePlayerResult = "ok" | "taken" | "cooldown" | "busy";

interface PlayerLine {
  player_id: string;
  nickname: string | null;
  created_at: string;
  updated_at: string;
}

// File mode keeps players in repo-root data/players.jsonl (next to solves.jsonl, outside web/):
// one line per change, the last line per player wins. Only POST handlers ever write it.
const playersFile = () => path.join(path.dirname(SOLVES_JSONL), "players.jsonl");

async function readFilePlayers(): Promise<Map<string, PlayerLine>> {
  const players = new Map<string, PlayerLine>();
  let text: string;
  try {
    text = await readFile(playersFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return players;
    throw err;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as PlayerLine;
      const first = players.get(l.player_id);
      players.set(l.player_id, { ...l, created_at: first?.created_at ?? l.created_at });
    } catch {
      // A half-written last line; skip it.
    }
  }
  for (const [id, l] of players) if (!l.nickname) players.delete(id);
  return players;
}

/** Nicknames for the given players (players without one are simply absent). Read-only. */
export async function getNicknames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const sql = getSql();
  if (sql) {
    const rows = await sql`select player_id, nickname from players where player_id = any(${ids}::uuid[])`;
    return new Map(rows.map((r) => [String(r.player_id), String(r.nickname)]));
  }
  const all = await readFilePlayers();
  return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!.nickname!]));
}

/**
 * Set a nickname, or clear it with null (back to anonymous). `nickname` must already be validated with
 * lib/nickname.ts. Names are unique case-insensitively ("taken"). A player can write once per 5 s
 * ("cooldown"), and only 60 new nicknames are accepted per minute overall ("busy").
 */
async function savePlayerInner(playerId: string, nickname: string | null): Promise<SavePlayerResult> {
  const sql = getSql();
  const key = nickname === null ? null : nicknameKey(nickname);
  if (sql) {
    if (nickname === null) {
      await sql`delete from players where player_id = ${playerId}`;
      return "ok";
    }
    const [mine] = await sql`select (now() - updated_at) < ${`${NAME_COOLDOWN_MS} milliseconds`}::interval as hot from players where player_id = ${playerId}`;
    if (mine?.hot) return "cooldown";
    if (!mine) {
      const [{ n }] = await sql`select count(*)::int as n from players where created_at > now() - interval '1 minute'`;
      if (n >= NEW_PLAYERS_PER_MINUTE) return "busy";
    }
    try {
      await sql`
        insert into players (player_id, nickname, nickname_lower) values (${playerId}, ${nickname}, ${key})
        on conflict (player_id) do update set nickname = excluded.nickname, nickname_lower = excluded.nickname_lower, updated_at = now()`;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return "taken"; // unique_violation on nickname_lower
      throw err;
    }
    return "ok";
  }

  const all = await readFilePlayers();
  const now = new Date();
  const mine = all.get(playerId);
  if (nickname !== null) {
    if ([...all].some(([id, l]) => id !== playerId && nicknameKey(l.nickname!) === key)) return "taken";
    if (mine && now.getTime() - Date.parse(mine.updated_at) < NAME_COOLDOWN_MS) return "cooldown";
    if (!mine && [...all.values()].filter((l) => now.getTime() - Date.parse(l.created_at) < 60_000).length >= NEW_PLAYERS_PER_MINUTE) return "busy";
  }
  const line: PlayerLine = { player_id: playerId, nickname, created_at: mine?.created_at ?? now.toISOString(), updated_at: now.toISOString() };
  await mkdir(path.dirname(playersFile()), { recursive: true });
  await appendFile(playersFile(), JSON.stringify(line) + "\n");
  return "ok";
}

export async function savePlayer(playerId: string, nickname: string | null): Promise<SavePlayerResult> {
  const result = await savePlayerInner(playerId, nickname);
  if (result === "ok") dropSnapshot();
  return result;
}

// ---------- leaderboard snapshot (shared 5 s cache) ------------------------------------------

export interface LeaderboardSnapshot {
  solves: PredictedSolve[];
  names: Map<string, string>; // every nickname, so "you" never needs its own query
  totals: { solves: number; players: number };
}

const SNAPSHOT_MS = 5_000;
let snapshot: { at: number; data: LeaderboardSnapshot } | null = null;
let loading: Promise<LeaderboardSnapshot> | null = null;

async function allNicknames(): Promise<Map<string, string>> {
  const sql = getSql();
  if (sql) {
    const rows = await sql`select player_id, nickname from players`;
    return new Map(rows.map((r) => [String(r.player_id), String(r.nickname)]));
  }
  const all = await readFilePlayers();
  return new Map([...all].map(([id, l]) => [id, l.nickname!]));
}

/**
 * Everything the leaderboard and the live counters need, read once and shared for 5 seconds. Many open tabs
 * polling every 10 s therefore cost one round of database reads per 5 s per server instance, not one per tab.
 * Concurrent callers share a single in-flight load. A nickname change on this instance drops the cache.
 */
export async function leaderboardSnapshot(): Promise<LeaderboardSnapshot> {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_MS) return snapshot.data;
  loading ??= (async () => {
    try {
      const [solves, names, totals] = await Promise.all([predictedSolves(), allNicknames(), solveTotals()]);
      const data = { solves, names, totals };
      snapshot = { at: Date.now(), data };
      return data;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Forget the cached snapshot (tests, and nickname writes on this instance). */
export function dropSnapshot() {
  snapshot = null;
}
