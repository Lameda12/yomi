import assert from "node:assert/strict";
import { test } from "node:test";
import { findStuck, type GameEvent } from "../lib/stuck.ts";

test("stuck cell is the head cell before the longest pause", () => {
  const events: GameEvent[] = [
    [0, 0, 0, 2],
    [500, 0, 1, 3],
    [4500, 0, 2, 4], // 4000 ms pause while the head sat on (0,1)
    [5000, 0, 3, 5],
  ];
  assert.deepEqual(findStuck(events), { cell: [0, 1], maxPauseMs: 4000 });
});

test("ties keep the earliest pause", () => {
  const events: GameEvent[] = [
    [0, 1, 1, 2],
    [1000, 1, 2, 3],
    [2000, 1, 3, 4],
  ];
  assert.deepEqual(findStuck(events), { cell: [1, 1], maxPauseMs: 1000 });
});

test("fewer than two events means no pause to report", () => {
  assert.deepEqual(findStuck([[0, 0, 0, 2]]), { cell: null, maxPauseMs: null });
});
