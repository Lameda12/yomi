import { z } from "zod";
import { validateNickname } from "@/lib/nickname";
import { savePlayer } from "@/lib/store";

const MAX_BODY_BYTES = 2_000;
// Writes are limited in lib/store.ts (one per player per 5 s, 60 new nicknames a minute overall), keyed on data
// the server controls. player_id itself is client-made, so it is not trusted as a rate-limit key on its own.
const Body = z.object({ player_id: z.uuid(), nickname: z.string().max(100).nullable() });

const fail = (status: number, error: string, extra: object = {}) => Response.json({ error, ...extra }, { status });

// POST only: nothing here is readable by GET, and GET routes never write.
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

  // Never trust the client's own validation: run the same rules again here.
  const result = validateNickname(parsed.data.nickname);
  if (!result.ok) return fail(400, result.error);

  try {
    const saved = await savePlayer(parsed.data.player_id, result.nickname);
    if (saved === "taken") return fail(409, "Taken, try another");
    if (saved === "cooldown") return fail(429, "Slow down, try again in a few seconds", { retry_after: 5 });
    if (saved === "busy") return fail(429, "Busy right now, try again in a minute", { retry_after: 60 });
  } catch (err) {
    console.error("[players] storage error:", err instanceof Error ? err.message : err);
    return fail(500, "could not save nickname");
  }
  return Response.json({ ok: true, nickname: result.nickname });
}
