import { predictStuck } from "@/lib/model";
import { PUZZLE_BY_ID } from "@/lib/puzzles";

// Predicted stuck cells are shown on the result card only. The page asks for them after the solve ends;
// they are never part of the page props. Untrained model: an empty list, and the card shows nothing.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("puzzle_id") ?? "";
  if (!PUZZLE_BY_ID.has(id)) return Response.json({ error: "unknown puzzle" }, { status: 400 });
  return Response.json({ cells: predictStuck(id) });
}
