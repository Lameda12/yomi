import { z } from "zod";
import { PUZZLE_BY_ID } from "@/lib/puzzles";
import { findStuck } from "@/lib/stuck";
import { insertSolve, recentSolveCount } from "@/lib/store";

const MAX_BODY_BYTES = 400_000;
// TODO: rate limit is keyed on player_id, which the client sends; a fresh UUID per request bypasses it.
// Key it on something the server controls (IP, signed cookie) before opening this up.
const MAX_INSERTS_PER_HOUR = 60;

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const Body = z.object({
  player_id: z.uuid(),
  puzzle_id: z.string().refine((id) => PUZZLE_BY_ID.has(id), "unknown puzzle"),
  grid_size: int(5, 7),
  device: z.enum(["mouse", "touch"]).nullable(),
  started_at_ms: int(1, Number.MAX_SAFE_INTEGER),
  ended_at_ms: int(1, Number.MAX_SAFE_INTEGER),
  solve_ms: int(1_000, 30 * 60_000),
  completed: z.boolean(),
  events: z.array(z.tuple([int(0, 30 * 60_000), int(0, 6), int(0, 6), int(1, 49)])).max(5000),
  backtracks: int(0, 5000),
  played_zip_before: z.boolean().nullable(),
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

  try {
    if ((await recentSolveCount(b.player_id)) >= MAX_INSERTS_PER_HOUR) {
      return fail(429, "too many solves, try again later");
    }
    // Derived on the server so these columns never depend on client maths.
    const { cell, maxPauseMs } = findStuck(b.events);
    await insertSolve({
      ...b,
      grid_size: puzzle.n,
      n_dots: puzzle.dots.length,
      max_pause_ms: maxPauseMs,
      stuck_cell: cell,
    });
  } catch (err) {
    console.error("[solves] storage error:", err instanceof Error ? err.message : err);
    return fail(500, "could not store solve");
  }
  return Response.json({ ok: true }, { status: 201 });
}
