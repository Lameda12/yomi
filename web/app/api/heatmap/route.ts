import { PUZZLE_BY_ID } from "@/lib/puzzles";
import { stuckHeat } from "@/lib/store";

// Where people got stuck on one puzzle: counts per cell, no players. The demo screen asks for it after the
// volunteer finishes, so it is a reveal, not a hint. A slow or failing database just means no heatmap.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("puzzle_id") ?? "";
  if (!PUZZLE_BY_ID.has(id)) return Response.json({ error: "unknown puzzle" }, { status: 400 });
  try {
    const slow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 2_000));
    const heat = await Promise.race([stuckHeat(id), slow]);
    return Response.json(heat, { headers: { "cache-control": "public, max-age=0, s-maxage=5" } });
  } catch (err) {
    console.error("[heatmap] unavailable:", err instanceof Error ? err.message : err);
    return Response.json({ cells: [], total: 0 }, { headers: { "cache-control": "no-store" } });
  }
}
