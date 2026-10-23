import { createTotalsSource } from "@/lib/stats";
import { leaderboardSnapshot } from "@/lib/store";

// Live counters for /demo. Slow or failing database: the last totals this server saw, marked stale. Like the board,
// a fresh answer may sit in the CDN for 5 s; a fallback answer never does, so the next poll tries the database again.
const totals = createTotalsSource(async () => (await leaderboardSnapshot()).totals, 1_500);

export async function GET() {
  const answer = await totals();
  return Response.json(answer, {
    headers: { "cache-control": answer.stale ? "no-store" : "public, max-age=0, s-maxage=5" },
  });
}
