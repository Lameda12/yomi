import { z } from "zod";
import type { Attempt, Mine, MinePuzzle } from "@/lib/mine";
import { PUZZLES } from "@/lib/puzzles";
import { playerSolves, type SolveRow } from "@/lib/store";

// A player's own attempts, looked up by the anonymous id in the body (never in a URL or a log). The answer holds only
// that player's rows and never echoes the id. Never cached. The puzzle boards sent along are public and carry no solution.
const MAX_BODY_BYTES = 2_000;
const Body = z.object({ player_id: z.uuid() });

const numberOf = new Map(PUZZLES.map((p, i) => [p.id, i + 1]));

function toAttempt(r: SolveRow): Attempt {
  return {
    solve_id: r.solve_id,
    created_at: r.created_at,
    puzzle_id: r.puzzle_id,
    puzzle_number: numberOf.get(r.puzzle_id) ?? null,
    grid_size: r.grid_size,
    mode: r.mode === "extreme" ? "extreme" : "regular",
    completed: r.completed,
    solve_ms: r.solve_ms,
    backtracks: r.backtracks,
    max_pause_ms: r.max_pause_ms,
    stuck_cell: r.stuck_cell,
    pred_value: r.pred_value ?? null,
    pred_unit: r.pred_unit ?? null,
    model_version: r.model_version ?? null,
    perceived_difficulty: r.perceived_difficulty ?? null,
    events: r.events,
  };
}

export async function POST(request: Request) {
  let id: string;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "body too large" }, { status: 400 });
    const parsed = Body.safeParse(JSON.parse(text));
    if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });
    id = parsed.data.player_id;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const { rows, total } = await playerSolves(id);
    const puzzles: Record<string, MinePuzzle> = {};
    for (const r of rows) {
      const p = PUZZLES.find((x) => x.id === r.puzzle_id);
      if (p) puzzles[p.id] = { n: p.n, dots: p.dots };
    }
    const body: Mine = { attempts: rows.map(toAttempt), total, puzzles };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[me] storage error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "could not load your attempts" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
