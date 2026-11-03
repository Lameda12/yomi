import { puzzleMedians } from "@/lib/store";

// The game shows "Crowd median: m:ss (N solves)" before a puzzle while the model cannot predict a time. This is where that
// number comes from. Aggregates only: puzzle id -> median and count of solves (not players). Slow or failing database: an
// empty map, and the game then shows no crowd median. Kept 30 s in the CDN and 10 s in memory.
let cached: { at: number; data: Awaited<ReturnType<typeof puzzleMedians>> } | null = null;

export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > 10_000) {
      const slow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 2_000));
      cached = { at: Date.now(), data: await Promise.race([puzzleMedians(), slow]) };
    }
    return Response.json(cached.data, { headers: { "cache-control": "public, max-age=0, s-maxage=30" } });
  } catch (err) {
    console.error("[medians] unavailable:", err instanceof Error ? err.message : err);
    return Response.json({}, { headers: { "cache-control": "no-store" } });
  }
}
