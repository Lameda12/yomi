import type { GameEvent } from "./stuck";

// solve_ms, backtracks and completed are not sent: the server derives them from `events`.
export interface SolvePayload {
  solve_id: string; // one per attempt; makes retries and queue flushes idempotent
  player_id: string;
  puzzle_id: string;
  grid_size: number;
  device: "mouse" | "touch" | null;
  started_at_ms: number;
  events: GameEvent[];
  played_zip_before: boolean | null;
  // What Yomi predicted before the solve; null when no model loaded. Old queued payloads lack it.
  mode?: "regular" | "extreme"; // missing on payloads queued before this existed = regular
  extreme_limit_ms?: number | null; // the clock this attempt played against (extreme only)
  source?: "demo"; // set only by the /demo presenter screen
  prediction?: { value: number; unit: "ms" | "solver_steps"; model_version: string } | null;
}

const QUEUE_KEY = "yomi_queue";
const MAX_QUEUED = 50;

function readQueue(): SolvePayload[] {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function writeQueue(q: SolvePayload[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUED)));
  } catch {
    // Storage full or blocked: nothing more we can do for this solve.
  }
}

// "retry" = network trouble, server error or rate limit; "drop" = the server rejected it for good.
async function post(p: SolvePayload): Promise<"ok" | "retry" | "drop"> {
  try {
    const body = JSON.stringify(p);
    const res = await fetch("/api/solves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: body.length < 60_000, // keepalive requests are capped at 64 KB
    });
    if (res.ok) return "ok";
    return res.status >= 500 || res.status === 429 || res.status === 408 ? "retry" : "drop";
  } catch {
    return "retry";
  }
}

/** Send a solve; on failure retry once, then park it in localStorage for the next visit. */
export async function submitSolve(p: SolvePayload): Promise<"saved" | "queued" | "failed"> {
  let r = await post(p);
  if (r === "retry") {
    await new Promise((res) => setTimeout(res, 1500));
    r = await post(p);
  }
  if (r === "ok") return "saved";
  if (r === "drop") return "failed";
  writeQueue([...readQueue(), p]);
  return "queued";
}

/** Called on page load: resend anything parked by an earlier visit. */
export async function flushQueue(): Promise<void> {
  const settled = new Set<string>();
  for (const p of readQueue()) {
    if ((await post(p)) !== "retry") settled.add(p.solve_id);
  }
  // Re-read so a solve queued while we were flushing is not lost.
  if (settled.size) writeQueue(readQueue().filter((p) => !settled.has(p.solve_id)));
}
