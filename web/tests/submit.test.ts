// flushQueue resends solves parked by an earlier visit. It must say which ones the server really stored and which it
// rejected for good, so a queued daily can be marked saved (and its share link made to point at the result page).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { flushQueue, type SolvePayload } from "../lib/submit.ts";

const store = new Map<string, string>();
const g = globalThis as unknown as { localStorage?: unknown; fetch?: unknown };
const realFetch = g.fetch;

const payload = (solve_id: string): SolvePayload => ({
  solve_id, player_id: "11111111-1111-4111-8111-111111111111", puzzle_id: "daily-001", grid_size: 5, device: "touch", started_at_ms: 1, events: [[0, 0, 1, 2]], played_zip_before: null,
});
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const queued = () => (JSON.parse(store.get("yomi_queue") ?? "[]") as SolvePayload[]).map((p) => p.solve_id);

// status by solve id; "throw" = network failure
function stubServer(status: Record<string, number | "throw">) {
  g.fetch = async (_url: string, init: { body: string }) => {
    const id = (JSON.parse(init.body) as SolvePayload).solve_id;
    const s = status[id];
    if (s === "throw") throw new TypeError("offline");
    return { ok: s! >= 200 && s! < 300, status: s };
  };
}

beforeEach(() => {
  store.clear();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
afterEach(() => {
  delete g.localStorage;
  g.fetch = realFetch;
});

test("flushQueue reports what the server stored, what it rejected for good, and keeps what could not be sent", async () => {
  store.set("yomi_queue", JSON.stringify([payload(A), payload(B), payload(C), payload(D)]));
  stubServer({ [A]: 201, [B]: 400, [C]: 500, [D]: 200 }); // stored, rejected, server error, already stored (a retried request)
  const out = await flushQueue();
  assert.deepEqual(out, { saved: [A, D], rejected: [B] });
  assert.deepEqual(queued(), [C], "only the one that could not be sent stays parked");
});

test("a rate limit or a network failure is not a rejection: it stays queued and is not reported as saved", async () => {
  store.set("yomi_queue", JSON.stringify([payload(A), payload(B)]));
  stubServer({ [A]: 429, [B]: "throw" });
  assert.deepEqual(await flushQueue(), { saved: [], rejected: [] });
  assert.deepEqual(queued(), [A, B]);
});

test("an empty or unreadable queue gives empty lists", async () => {
  stubServer({});
  assert.deepEqual(await flushQueue(), { saved: [], rejected: [] });
  store.set("yomi_queue", "not json");
  assert.deepEqual(await flushQueue(), { saved: [], rejected: [] });
});
