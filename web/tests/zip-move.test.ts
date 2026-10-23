import assert from "node:assert/strict";
import { test } from "node:test";
import { planMove, type Cell } from "../lib/zip.ts";

// 3x3, dots 1 (0,0), 2 (0,2), 3 (2,0)
const n = 3;
const labelAt = new Map([[0, 1], [2, 2], [6, 3]]);
const start: Cell[] = [[0, 0]];

test("a fast drag extends cell by cell along a line", () => {
  assert.deepEqual(planMove(n, labelAt, start, [0, 2]), { kind: "extend", path: [[0, 0], [0, 1], [0, 2]] });
});

test("dragging back onto the path undoes to that cell", () => {
  const cur: Cell[] = [[0, 0], [0, 1], [0, 2]];
  assert.deepEqual(planMove(n, labelAt, cur, [0, 1]), { kind: "undo", path: [[0, 0], [0, 1]] });
  assert.equal(planMove(n, labelAt, cur, [0, 2]), null, "the head itself is a no-op");
});

test("dots must be hit in order: the drag stops just before an out-of-order dot", () => {
  assert.deepEqual(planMove(n, labelAt, start, [2, 0]), { kind: "extend", path: [[0, 0], [1, 0]] }, "3 is not reachable before 2");
  const cur: Cell[] = [[0, 0], [1, 0]];
  assert.equal(planMove(n, labelAt, cur, [2, 0]), null, "already adjacent to 3, still blocked");
});

test("diagonals are ignored", () => {
  assert.equal(planMove(n, labelAt, start, [1, 1]), null);
});
