import { z } from "zod";
import { CAP_MS, MIN_SOLVES, TOP_N, buildBoard } from "@/lib/leaderboard";
import { loadModel } from "@/lib/model";
import { getNicknames, predictedSolves, solveTotals } from "@/lib/store";

// POST, not GET, so the caller's player_id travels in the body and never lands in a URL or a log.
// The response carries nicknames and anonymous tags only, never a player_id.
const Body = z.object({ player_id: z.uuid().optional() });

export async function POST(request: Request) {
  let me: string | undefined;
  try {
    const text = await request.text();
    if (text.length > 2_000) return Response.json({ error: "body too large" }, { status: 400 });
    const parsed = Body.safeParse(text ? JSON.parse(text) : {});
    if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });
    me = parsed.data.player_id;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const solves = await predictedSolves();
    const ids = [...new Set(solves.map((s) => s.player_id)), ...(me ? [me] : [])];
    const names = await getNicknames(ids);
    const { board, you, players } = buildBoard(solves, names, me);
    // The board compares a time prediction with a real time. Until a human-trained model exists the app
    // predicts solver steps, so there is nothing to compare: say so instead of showing an empty table.
    const timeModel = loadModel()?.trained_on.label === "human_time";
    const open = timeModel || board.length > 0;
    return Response.json({
      mode: open ? "open" : "warming",
      board,
      you,
      players,
      totals: await solveTotals(),
      rules: { min_solves: MIN_SOLVES, top: TOP_N, cap_ms: CAP_MS },
    });
  } catch (err) {
    console.error("[leaderboard] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "leaderboard unavailable" }, { status: 500 });
  }
}
