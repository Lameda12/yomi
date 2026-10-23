import assert from "node:assert/strict";
import { test } from "node:test";
import { pathPoints, pointsAttr, reconcile, stepLength } from "../lib/pathAnim.ts";
import type { Cell } from "../lib/zip.ts";

const row: Cell[] = [[0, 0], [0, 1], [0, 2], [0, 3]];

test("pathPoints: whole cells, a partial last segment, and clamping", () => {
  assert.deepEqual(pathPoints(row, 3), [[0.5, 0.5], [1.5, 0.5], [2.5, 0.5], [3.5, 0.5]]);
  assert.deepEqual(pathPoints(row, 1.5), [[0.5, 0.5], [1.5, 0.5], [2.0, 0.5]]);
  assert.deepEqual(pathPoints(row, 99), pathPoints(row, 3));
  assert.deepEqual(pathPoints(row, -2), [[0.5, 0.5]]);
  assert.deepEqual(pathPoints([], 2), []);
  assert.equal(pointsAttr([[0.5, 0.5], [1.5, 0.5]]), "0.5,0.5 1.5,0.5");
});

test("pathPoints interpolates down a column too", () => {
  const col: Cell[] = [[0, 0], [1, 0]];
  assert.deepEqual(pathPoints(col, 0.25), [[0.5, 0.5], [0.5, 0.75]]);
});

test("stepLength eases toward the target, never overshoots, and lands exactly", () => {
  for (const [from, to] of [[0, 1], [5, 0], [0, 35], [35, 0], [3, 3.5]] as const) {
    let L: number = from;
    let frames = 0;
    let prev = Math.abs(to - L);
    while (L !== to && frames < 200) {
      L = stepLength(L, to, 1 / 60);
      frames++;
      const d = Math.abs(to - L);
      assert.ok(d <= prev + 1e-9, "always moves closer");
      assert.ok(from < to ? L <= to : L >= to, "no overshoot");
      prev = d;
    }
    assert.equal(L, to, `${from} -> ${to} lands exactly`);
    assert.ok(frames <= 30, `${from} -> ${to} settles in ${frames} frames (about ${Math.round((frames * 1000) / 60)} ms)`);
  }
});

test("a one-cell extension takes well under a quarter second at 60 fps", () => {
  let L = 0;
  let frames = 0;
  while (L !== 1) {
    L = stepLength(L, 1, 1 / 60);
    frames++;
  }
  assert.ok(frames / 60 < 0.25, `${frames} frames`);
});

test("stepLength copes with a zero or negative dt and an exact match", () => {
  assert.equal(stepLength(2, 2, 0.016), 2);
  assert.equal(stepLength(0, 5, 0), 0);
  assert.equal(stepLength(0, 5, -1), 0);
});

test("reconcile: extending keeps the drawn length and draws the longer path", () => {
  const r = reconcile(row.slice(0, 2), 1, row);
  assert.deepEqual(r.shown, row);
  assert.equal(r.L, 1);
});

test("reconcile: undo keeps the longer line so it can retract", () => {
  const r = reconcile(row, 3, row.slice(0, 2));
  assert.deepEqual(r.shown, row);
  assert.equal(r.L, 3);
});

test("reconcile: reset to the start retracts the whole line", () => {
  const r = reconcile(row, 2.5, [[0, 0]]);
  assert.deepEqual(r.shown, row);
  assert.equal(r.L, 2.5);
});

test("reconcile: extending again mid-retract clamps to the part both paths share", () => {
  // was drawn to 3 along row, user undid to [0,0],[0,1] and now heads down instead
  const next: Cell[] = [[0, 0], [0, 1], [1, 1]];
  const r = reconcile(row, 2.6, next);
  assert.deepEqual(r.shown, next);
  assert.equal(r.L, 1, "cannot show the old row beyond the shared cells");
});

test("reconcile: a different puzzle snaps", () => {
  const other: Cell[] = [[4, 4], [4, 3]];
  const r = reconcile(row, 3, other);
  assert.deepEqual(r.shown, other);
  assert.equal(r.L, 1);
});

test("reconcile: identical path changes nothing", () => {
  assert.deepEqual(reconcile(row, 3, row), { shown: row, L: 3 });
});
