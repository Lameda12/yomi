import { z } from "zod";
import { buildExtremeBoard } from "@/lib/extremeBoard";
import { CAP_MS, MIN_SOLVES, TOP_N, buildBoard } from "@/lib/leaderboard";
import { loadModel } from "@/lib/model";
import { leaderboardSnapshot } from "@/lib/store";

// GET is the public board: the same for everyone, so the CDN may keep it for 5 s (s-maxage) and many open tabs
// polling every 10 s do not each hit Neon. POST returns only "you", with the player_id in the body (never in a
// URL or a log) and is never cached. Neither response contains a player_id.
const BOARD_CACHE = "public, max-age=0, s-maxage=5";

async function payload(me?: string) {
  const { solves, names, totals, extreme } = await leaderboardSnapshot();
  const { board, you, players } = buildBoard(solves, names, me);
  // The board compares a time prediction with a real time. Until a human-trained model exists the app
  // predicts solver steps, so there is nothing to compare: say so instead of showing an empty table.
  const open = loadModel()?.trained_on.label === "human_time" || board.length > 0;
  return {
    mode: open ? ("open" as const) : ("warming" as const),
    board,
    extreme: buildExtremeBoard(extreme, names, TOP_N),
    you,
    players,
    totals,
    rules: { min_solves: MIN_SOLVES, top: TOP_N, cap_ms: CAP_MS },
  };
}

export async function GET() {
  try {
    const p = await payload();
    return Response.json(
      { mode: p.mode, board: p.board, extreme: p.extreme, players: p.players, totals: p.totals, rules: p.rules },
      { headers: { "cache-control": BOARD_CACHE } },
    );
  } catch (err) {
    console.error("[leaderboard] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "leaderboard unavailable" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

const Body = z.object({ player_id: z.uuid() });

export async function POST(request: Request) {
  let me: string;
  try {
    const text = await request.text();
    if (text.length > 2_000) return Response.json({ error: "body too large" }, { status: 400 });
    const parsed = Body.safeParse(JSON.parse(text));
    if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });
    me = parsed.data.player_id;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const { you } = await payload(me);
    return Response.json({ you }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[leaderboard] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "leaderboard unavailable" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
