import type { GameEvent } from "./stuck";

export interface SolvePayload {
  player_id: string;
  puzzle_id: string;
  grid_size: number;
  device: "mouse" | "touch" | null;
  started_at_ms: number;
  ended_at_ms: number;
  solve_ms: number;
  completed: boolean;
  events: GameEvent[];
  backtracks: number;
  played_zip_before: boolean | null;
}

const QUEUE_KEY = "yomi_queue";
const MAX_QUEUED = 50;

const keyOf = (p: SolvePayload) => `${p.puzzle_id}:${p.started_at_ms}`;

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

// "retry" = network or server trouble; "drop" = the server rejected it for good (4xx).
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
    return res.status >= 500 ? "retry" : "drop";
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
    if ((await post(p)) !== "retry") settled.add(keyOf(p));
  }
  // Re-read so a solve queued while we were flushing is not lost.
  if (settled.size) writeQueue(readQueue().filter((p) => !settled.has(keyOf(p))));
}
