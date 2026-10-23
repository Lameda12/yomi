import { z } from "zod";
import { RATINGS } from "@/lib/difficulty";
import { setPerceivedDifficulty } from "@/lib/store";

// The optional "how difficult did that feel?" answer for a solve that is already saved. It can only change a finished
// Regular solve that belongs to the same anonymous player id, and it only ever sets one of three fixed values. Analysis
// only: the training pipeline does not read it.
const MAX_BODY_BYTES = 1_000;
const Body = z.object({ solve_id: z.uuid(), player_id: z.uuid(), rating: z.enum(RATINGS) });

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
  try {
    const ok = await setPerceivedDifficulty(parsed.data.solve_id, parsed.data.player_id, parsed.data.rating);
    if (!ok) return fail(404, "no such finished solve");
  } catch (err) {
    console.error("[feedback] storage error:", err instanceof Error ? err.message : err);
    return fail(500, "could not save");
  }
  return Response.json({ ok: true });
}
