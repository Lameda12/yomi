import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJson, fmtClock, guessLine, sizeSummaries, tryNumbers, vsGuess, type Attempt, type Mine } from "../lib/mine.ts";
import { replay, type ReplayStep } from "../lib/replay.ts";

const a = (o: Partial<Attempt> = {}): Attempt => ({
  solve_id: "s", created_at: "2026-10-23T10:00:00Z", puzzle_id: "zip-5x5-01", puzzle_number: 1, grid_size: 5, mode: "regular", completed: true, solve_ms: 30_000,
  backtracks: 0, max_pause_ms: null, stuck_cell: null, pred_value: null, pred_unit: null, model_version: null, events: [], ...o,
});

test("sizeSummaries keeps board sizes apart and ignores sprint runs and unfinished attempts", () => {
  const s = sizeSummaries([
    a({ solve_ms: 20_000 }), a({ solve_ms: 40_000 }), a({ solve_ms: 30_000 }),
    a({ grid_size: 6, solve_ms: 90_000 }),
    a({ mode: "extreme", solve_ms: 5_000 }), a({ completed: false, solve_ms: 1_000 }), a({ solve_ms: 0 }),
  ]);
  assert.deepEqual(s, [{ grid: 5, count: 3, best: 20_000, median: 30_000 }, { grid: 6, count: 1, best: 90_000, median: 90_000 }]);
  assert.deepEqual(sizeSummaries([]), []);
});

test("tryNumbers counts the nth go at the same puzzle in time order", () => {
  const first = a({ created_at: "2026-10-23T10:00:00Z" });
  const second = a({ created_at: "2026-10-23T11:00:00Z" });
  const other = a({ puzzle_id: "zip-5x5-02", created_at: "2026-10-23T10:30:00Z" });
  const t = tryNumbers([second, other, first]); // newest first, like the API
  assert.deepEqual([t.get(first), t.get(second), t.get(other)], [1, 2, 1]);
});

test("vsGuess and guessLine only compare a time with a time", () => {
  assert.equal(vsGuess(a({ pred_unit: "solver_steps", pred_value: 70 })), null);
  assert.equal(vsGuess(a({ pred_unit: "ms", pred_value: 0 })), null);
  assert.equal(vsGuess(a({ pred_unit: "ms", pred_value: 40_000, completed: false })), null);
  assert.equal(vsGuess(a({ pred_unit: "ms", pred_value: 40_000 }))?.ratio, 0.75);
  assert.equal(guessLine(a({ pred_unit: "ms", pred_value: 40_000 })), "Yomi guessed 0:40. You took 0:30, 25% faster than the guess.");
  assert.equal(guessLine(a({ pred_unit: "ms", pred_value: 20_000 })), "Yomi guessed 0:20. You took 0:30, 50% slower than the guess.");
  assert.match(guessLine(a({ pred_unit: "ms", pred_value: 31_000 }))!, /close to the guess/);
  assert.match(guessLine(a({ pred_unit: "solver_steps", pred_value: 70 }))!, /not a time/);
  assert.equal(guessLine(a()), null);
  assert.equal(fmtClock(65_400), "1:05");
});

test("the download holds the player's attempts and no anonymous id", () => {
  const mine: Mine = { attempts: [a({ solve_id: "x1" })], total: 3, puzzles: {} };
  const out = JSON.parse(exportJson(mine, "2026-10-23T12:00:00Z"));
  assert.equal(out.total_attempts, 3);
  assert.equal(out.attempts.length, 1);
  assert.ok(!("player_id" in out) && !("player_id" in out.attempts[0]));
});

test("replay can also return the path after every move, ending at the same path", () => {
  // 2x2 board: dots 1 at (0,0), 2 at (0,1), 3 at (1,1), 4 at (1,0); a drag, an undo, then the rest
  const dots: [number, number, number][] = [[0, 0, 1], [0, 1, 2], [1, 1, 3], [1, 0, 4]];
  const events: [number, number, number, number][] = [[100, 0, 1, 2], [200, 1, 1, 3], [400, 0, 1, 2], [600, 1, 1, 3], [800, 1, 0, 4]];
  const steps: ReplayStep[] = [];
  const r = replay(2, dots, events, steps);
  assert.ok(r && r.completed);
  assert.equal(r.backtracks, 1);
  assert.deepEqual(steps.map((s) => [s.t, s.path.length]), [[0, 1], [100, 2], [200, 3], [400, 2], [600, 3], [800, 4]]);
  assert.deepEqual(steps[steps.length - 1].path, r.path);
  steps[1].path.push([9, 9]);
  assert.equal(r.path.length, 4, "snapshots are copies");
  assert.deepEqual(replay(2, dots, events), r, "steps is optional");
});
