import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { replay } from "../lib/replay.ts";
import type { GameEvent } from "../lib/stuck.ts";
import type { Cell, ZipPuzzle } from "../lib/zip.ts";

const puzzles: ZipPuzzle[] = JSON.parse(readFileSync(new URL("../data/puzzles.json", import.meta.url), "utf8"));
const P = puzzles.find((p) => p.id === "zip-5x5-01")!;
const SOL = P.solution;

/** Events for walking `path` one cell per move, `stepMs` apart (path[0] is dot 1, never logged). */
function walk(path: Cell[], stepMs = 1000, t0 = 0): GameEvent[] {
  return path.slice(1).map(([r, c], i) => [t0 + i * stepMs, r, c, i + 2]);
}

test("full solution replays as completed, with time from the last event", () => {
  const g = replay(P.n, P.dots, walk(SOL))!;
  assert.ok(g);
  assert.equal(g.completed, true);
  assert.equal(g.backtracks, 0);
  assert.equal(g.solveMs, (SOL.length - 2) * 1000);
  assert.deepEqual(g.path, SOL);
});

test("ignores what a client would claim: a partial path is not completed", () => {
  const g = replay(P.n, P.dots, walk(SOL.slice(0, 10)))!;
  assert.equal(g.completed, false);
  assert.equal(g.path.length, 10);
});

test("fast drag: one event can extend several cells along a straight line", () => {
  // Find a straight run of 3+ cells in the solution and log it as a single event.
  let i = 1;
  while (i + 2 < SOL.length) {
    const [a, b, c] = [SOL[i - 1], SOL[i], SOL[i + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) break;
    i++;
  }
  assert.ok(i + 2 < SOL.length, "fixture needs a straight run");
  const events = walk(SOL);
  // events[k] adds SOL[k + 1]; merge the events that add SOL[i] and SOL[i + 1].
  events.splice(i - 1, 2, [events[i][0], SOL[i + 1][0], SOL[i + 1][1], i + 2]);
  const g = replay(P.n, P.dots, events)!;
  assert.ok(g);
  assert.equal(g.completed, true);
});

test("backtracks count undo episodes, not undo events", () => {
  const ev = walk(SOL.slice(0, 8)); // path length 8, last t = 6000
  ev.push([7000, ...SOL[5], 6] as GameEvent); // undo to length 6
  ev.push([7100, ...SOL[3], 4] as GameEvent); // undo again, same episode
  ev.push(...walk(SOL.slice(3, 9), 1000, 8000).map(([t, r, c, len]) => [t, r, c, len + 3] as GameEvent));
  ev.push([20000, ...SOL[0], 1] as GameEvent); // clear: second episode
  ev.push(...walk(SOL, 500, 21000));
  const g = replay(P.n, P.dots, ev)!;
  assert.ok(g);
  assert.equal(g.backtracks, 2);
  assert.equal(g.completed, true);
  assert.equal(g.solveMs, 21000 + (SOL.length - 2) * 500);
});

test("rejects impossible logs", () => {
  const ok = walk(SOL);
  const cases: [string, GameEvent[]][] = [
    ["time goes backwards", ok.map((e, i) => (i === 5 ? [0, e[1], e[2], e[3]] : e))],
    ["jump two cells but claim one", [[0, SOL[0][0] + 2, SOL[0][1], 2]]],
    ["diagonal step", [[0, SOL[0][0] + 1, SOL[0][1] + 1, 2]]],
    ["same length twice", [ok[0], [ok[0][0] + 1, ok[0][1], ok[0][2], ok[0][3]]]],
    ["undo whose head is not the cell at that length", [...ok.slice(0, 5), [9000, ...SOL[4], 2] as GameEvent]],
    ["off the board", [[0, 9, 0, 2]]],
  ];
  for (const [name, events] of cases) assert.equal(replay(P.n, P.dots, events), null, name);
});

test("rejects passing dots out of order or revisiting a cell", () => {
  // Fixture: dot 1 at (1,3), dot 4 at (1,2). Stepping left from dot 1 hits dot 4 before 2 and 3.
  assert.deepEqual(P.dots.find((d) => d[2] === 1), [1, 3, 1]);
  assert.deepEqual(P.dots.find((d) => d[2] === 4), [1, 2, 4]);
  assert.equal(replay(P.n, P.dots, [[0, 1, 2, 2]]), null);
  // Step forward, then "extend" back onto dot 1.
  assert.equal(replay(P.n, P.dots, [[0, ...SOL[1], 2] as GameEvent, [100, ...SOL[0], 3] as GameEvent]), null);
});
