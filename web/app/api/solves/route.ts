import { z } from "zod";
import { getSql } from "@/lib/db";
import { PUZZLE_BY_ID } from "@/lib/puzzles";
import { findStuck } from "@/lib/stuck";

const MAX_BODY_BYTES = 400_000;
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

  const sql = getSql();
  if (!sql) {
    console.error("[solves] DATABASE_URL is not set");
    return fail(503, "storage not configured");
  }

  try {
    const [{ n }] = await sql`
      select count(*)::int as n from solves
      where player_id = ${b.player_id} and created_at > now() - interval '1 hour'`;
    if (n >= MAX_INSERTS_PER_HOUR) return fail(429, "too many solves, try again later");

    // Derived on the server so these columns never depend on client maths.
    const { cell, maxPauseMs } = findStuck(b.events);
    await sql`
      insert into solves (player_id, puzzle_id, grid_size, n_dots, device, started_at_ms, ended_at_ms,
                          solve_ms, completed, events, backtracks, max_pause_ms, stuck_cell, played_zip_before)
      values (${b.player_id}, ${b.puzzle_id}, ${puzzle.n}, ${puzzle.dots.length}, ${b.device},
              ${b.started_at_ms}, ${b.ended_at_ms}, ${b.solve_ms}, ${b.completed},
              ${JSON.stringify(b.events)}::jsonb, ${b.backtracks}, ${maxPauseMs},
              ${cell ? `{${cell[0]},${cell[1]}}` : null}::int[], ${b.played_zip_before})`;
  } catch (err) {
    console.error("[solves] database error:", err instanceof Error ? err.message : err);
    return fail(500, "could not store solve");
  }
  return Response.json({ ok: true }, { status: 201 });
}
