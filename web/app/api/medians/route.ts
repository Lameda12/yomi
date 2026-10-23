import { puzzleMedians } from "@/lib/store";

// Extreme mode needs "the typical time" for a puzzle when the model cannot give a time in milliseconds.
// Aggregates only: puzzle id -> median and count. Slow or failing database: an empty map, and the game then
// uses its 60 s default. Kept 30 s in the CDN and 10 s in memory.
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
