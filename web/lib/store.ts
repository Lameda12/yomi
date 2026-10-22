import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getSql } from "./db.ts";
import { dedupeBySolveId } from "./dedupe.ts";
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
