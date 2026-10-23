import { z } from "zod";
import { PLAYERS_TO_OPEN, buildCrowdBoard } from "@/lib/crowdBoard";
import { buildExtremeBoard } from "@/lib/extremeBoard";
import { CAP_MS, MIN_SOLVES, TOP_N, buildBoard } from "@/lib/leaderboard";
import { loadModel } from "@/lib/model";
import { leaderboardSnapshot } from "@/lib/store";

// GET is the public board: the same for everyone, so the CDN may keep it for 5 s (s-maxage) and many open tabs
// polling every 10 s do not each hit Neon. POST returns only "you", with the player_id in the body (never in a
// URL or a log) and is never cached. Neither response contains a player_id.
const BOARD_CACHE = "public, max-age=0, s-maxage=5";

/**
 * Which board is live. While the model predicts solver steps (or there is no model) there is no time prediction to
 * compare with, so players are ranked against the crowd's times. Once model.json is human_time they are ranked
 * against Yomi's time guess. The switch is automatic, from the model file.
 */
async function payload(me?: string) {
  const { solves, names, totals, extreme, crowd } = await leaderboardSnapshot();
  const basis = loadModel()?.trained_on.label === "human_time" ? ("yomi" as const) : ("crowd" as const);
  const extremeBoard = buildExtremeBoard(extreme, names, TOP_N);

  if (basis === "crowd") {
    const c = buildCrowdBoard(crowd, names, me, TOP_N);
    return {
      basis, board: c.board, you: c.you, players: c.players, totals, extreme: extremeBoard,
      progress: { ...c.progress }, rules: { min_solves: MIN_SOLVES, top: TOP_N, cap: "x10", open_players: PLAYERS_TO_OPEN },
    };
  }
  const y = buildBoard(solves, names, me);
  const perPlayer = new Map<string, number>();
  for (const s of solves) perPlayer.set(s.player_id, (perPlayer.get(s.player_id) ?? 0) + 1);
  const enough = [...perPlayer.values()].filter((n) => n >= MIN_SOLVES).length;
  return {
    basis, board: y.board, you: y.you, players: y.players, totals, extreme: extremeBoard,
    progress: { players: Math.min(PLAYERS_TO_OPEN, enough), need: PLAYERS_TO_OPEN },
    rules: { min_solves: MIN_SOLVES, top: TOP_N, cap: `${CAP_MS / 60_000} min`, open_players: PLAYERS_TO_OPEN },
  };
}

export async function GET() {
  try {
    const p = await payload();
    return Response.json(
      { basis: p.basis, mode: p.board.length > 0 ? "open" : "waiting", board: p.board, extreme: p.extreme, players: p.players, totals: p.totals, progress: p.progress, rules: p.rules },
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
