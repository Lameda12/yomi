// Browser-side helpers for the anonymous player id and the optional nickname. Client code only.
// Everything is best-effort: storage can be blocked and the network can fail, and neither may stop play.
export const PLAYER_KEY = "yomi_player"; // random id this browser made for itself
export const START_KEY = "yomi_start_done"; // set by an older start screen; read only, so those players skip the how-to-play
export const NICK_KEY = "yomi_nick"; // the nickname the server accepted
const PENDING_KEY = "yomi_nick_pending"; // typed but not saved yet (offline, rate limited); retried on the next load

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function getPlayerId(): string {
  let id = read(PLAYER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(PLAYER_KEY, id);
  }
  return id;
}

/** The id if this browser already has one. Unlike getPlayerId it never creates one. */
export const peekPlayerId = () => read(PLAYER_KEY) ?? undefined;

export const startDone = () => read(START_KEY) === "1";
export const savedNickname = () => read(NICK_KEY) ?? read(PENDING_KEY) ?? "";

export type SaveStatus = "ok" | "taken" | "invalid" | "later";
export interface SaveOutcome {
  status: SaveStatus; // "later" = could not save right now (offline, rate limited, server error); kept for a retry
  message?: string;
}

/** Send a nickname (or null for anonymous) to the server and keep local state in step. */
export async function saveNickname(nickname: string | null): Promise<SaveOutcome> {
  try {
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: getPlayerId(), nickname }),
    });
    const body = await res.json().catch(() => ({}));
    const message = typeof body.error === "string" ? body.error : undefined;
    if (res.ok) {
      write(NICK_KEY, body.nickname ?? null);
      write(PENDING_KEY, null);
      return { status: "ok" };
    }
    if (res.status === 409) return { status: "taken", message: "Taken, try another" };
    if (res.status === 400) return { status: "invalid", message };
    if (nickname !== null) write(PENDING_KEY, nickname);
    return { status: "later", message };
  } catch {
    if (nickname !== null) write(PENDING_KEY, nickname);
    return { status: "later" };
  }
}

/** On page load: try again with a nickname that could not be saved earlier. */
export async function retryPendingNickname(): Promise<void> {
  const pending = read(PENDING_KEY);
  if (!pending) return;
  const out = await saveNickname(pending);
  if (out.status === "taken" || out.status === "invalid") write(PENDING_KEY, null); // will never succeed as typed
}
