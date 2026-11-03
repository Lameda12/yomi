// The 30 original puzzles are frozen. Stored solves reference their ids, so changing a puzzle's content (or its
// position) would corrupt the data. New puzzles may only be appended. Never run `npm run gen:puzzles`: it rewrites
// the whole file. The daily pool is added by `npm run gen:daily`, which only appends.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { countSolutions, isSolved, type ZipPuzzle } from "../lib/zip.ts";

// sha256 of JSON.stringify(first 30 entries), computed from data/puzzles.json before the daily pool was added.
const FIRST_30_SHA256 = "877b66decdb8e156b4bf5aaac862520103c3845051446b73619e9a023394e023";

const puzzles: ZipPuzzle[] = JSON.parse(readFileSync(new URL("../data/puzzles.json", import.meta.url), "utf8"));

test("the first 30 puzzles are unchanged", () => {
  const hash = createHash("sha256").update(JSON.stringify(puzzles.slice(0, 30))).digest("hex");
  assert.equal(hash, FIRST_30_SHA256);
  assert.deepEqual(
    puzzles.slice(0, 30).map((p) => p.id),
    [...Array.from({ length: 15 }, (_, i) => `zip-5x5-${String(i + 1).padStart(2, "0")}`), ...Array.from({ length: 15 }, (_, i) => `zip-6x6-${String(i + 1).padStart(2, "0")}`)],
  );
});

test("daily puzzles are appended after them as daily-001 ... daily-120, with no duplicate ids", () => {
  const daily = puzzles.slice(30);
  assert.equal(daily.length, 120);
  assert.deepEqual(
    daily.map((p) => p.id),
    Array.from({ length: 120 }, (_, i) => `daily-${String(i + 1).padStart(3, "0")}`),
  );
  assert.equal(new Set(puzzles.map((p) => p.id)).size, puzzles.length);
});

test("daily puzzles are new boards, each one solved by its stored solution and with exactly one solution", () => {
  const seen = new Set(puzzles.slice(0, 30).map((p) => JSON.stringify([p.n, p.dots])));
  for (const p of puzzles.slice(30)) {
    const key = JSON.stringify([p.n, p.dots]);
    assert.ok(!seen.has(key), `${p.id} repeats another board`);
    seen.add(key);
    assert.ok(isSolved(p.n, p.dots, p.solution), `${p.id}: stored solution does not solve it`);
    assert.equal(countSolutions(p.n, p.dots, 2, 2_000_000), 1, `${p.id}: not a unique puzzle`);
  }
});

test("daily boards are 5x5, 6x6 or 7x7 and both common sizes are present", () => {
  const sizes = new Set(puzzles.slice(30).map((p) => p.n));
  assert.ok([...sizes].every((n) => n >= 5 && n <= 7));
  assert.ok(sizes.has(5) && sizes.has(6));
});

test("every daily can be played and accepted end to end: its solution replays as a finished game and fits the solves API limits", async () => {
  const { replay } = await import("../lib/replay.ts");
  for (const p of puzzles.slice(30)) {
    // what the game would log for a clean solve: one event per move after the start, 300 ms apart
    const events = p.solution.slice(1).map(([r, c], i): [number, number, number, number] => [i * 300, r, c, i + 2]);
    const game = replay(p.n, p.dots, events);
    assert.ok(game?.completed, `${p.id} (${p.n}x${p.n}) does not replay as completed`);
    assert.equal(game.backtracks, 0);
    // app/api/solves/route.ts: grid_size 5..7, cell indexes 0..6, path length 1..49, solve time over 1 s
    assert.ok(p.n >= 5 && p.n <= 7 && p.solution.every(([r, c]) => r <= 6 && c <= 6) && p.n * p.n <= 49, `${p.id} is outside the API limits`);
    assert.ok(game.solveMs >= 1000);
  }
});
