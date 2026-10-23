import { z } from "zod";
import { PUZZLE_BY_ID } from "@/lib/puzzles";
import { replay } from "@/lib/replay";
import { findStuck } from "@/lib/stuck";
import { insertSolve, recentSolveCount } from "@/lib/store";

const MAX_BODY_BYTES = 400_000;
// TODO: rate limit is keyed on player_id, which the client sends; a fresh UUID per request bypasses it.
// Key it on something the server controls (IP, signed cookie) before opening this up.
const MAX_INSERTS_PER_HOUR = 60;
const MIN_SOLVE_MS = 1_000; // a finished grid faster than this is not a human

const int = (min: number, max: number) => z.number().int().min(min).max(max);

// solve_ms, backtracks and completed are derived from `events` on the server.
// Clients that still send them (or ended_at_ms) are fine: z.object drops unknown keys.
const Body = z.object({
  solve_id: z.uuid(),
  player_id: z.uuid(),
  puzzle_id: z.string().refine((id) => PUZZLE_BY_ID.has(id), "unknown puzzle"),
  grid_size: int(5, 7),
  device: z.enum(["mouse", "touch"]).nullable(),
  started_at_ms: int(1, Number.MAX_SAFE_INTEGER),
  events: z.array(z.tuple([int(0, 30 * 60_000), int(0, 6), int(0, 6), int(1, 49)])).min(1).max(5000),
  played_zip_before: z.boolean().nullable(),
  // Only the /demo presenter screen sets this, so volunteer solves can be told apart (and left out of the board).
  source: z.literal("demo").optional(),
  // What the page predicted before the solve. Optional: no model, or an older client.
  prediction: z
    .object({
      value: z.number().positive().max(1e12),
      unit: z.enum(["ms", "solver_steps"]),
      model_version: z.string().max(64),
    })
    .nullable()
    .optional(),
});

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  let json: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return fail(400, "body too large");
    json = JSON.parse(text);
  } catch {
    return fail(400, "invalid json");
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(400, "invalid payload");
  const b = parsed.data;
  const puzzle = PUZZLE_BY_ID.get(b.puzzle_id)!;
  if (b.grid_size !== puzzle.n) return fail(400, "grid_size does not match puzzle");

  const game = replay(puzzle.n, puzzle.dots, b.events);
  if (!game) return fail(400, "events do not form a valid game");
  if (game.completed && game.solveMs < MIN_SOLVE_MS) return fail(400, "solve too fast");

  try {
    if ((await recentSolveCount(b.player_id)) >= MAX_INSERTS_PER_HOUR) {
      return fail(429, "too many solves, try again later");
    }
    // Derived on the server so these columns never depend on client maths.
    const { cell, maxPauseMs } = findStuck(b.events);
    const { prediction, source, ...rest } = b;
    const inserted = await insertSolve({
      ...rest,
      grid_size: puzzle.n,
      n_dots: puzzle.dots.length,
      ended_at_ms: b.started_at_ms + game.solveMs,
      solve_ms: game.solveMs,
      completed: game.completed,
      backtracks: game.backtracks,
      max_pause_ms: maxPauseMs,
      stuck_cell: cell,
      pred_value: prediction?.value ?? null,
      pred_unit: prediction?.unit ?? null,
      model_version: prediction?.model_version ?? null,
      source: source ?? null,
    });
    // Same solve_id again = a retry whose first response got lost; tell the client it is saved.
    if (!inserted) return Response.json({ ok: true, duplicate: true }, { status: 200 });
  } catch (err) {
    console.error("[solves] storage error:", err instanceof Error ? err.message : err);
    return fail(500, "could not store solve");
  }
  return Response.json({ ok: true }, { status: 201 });
}
