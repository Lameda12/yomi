import assert from "node:assert/strict";
import { test } from "node:test";
import { clock } from "../lib/clock.ts";
import { explainGap, gapParts, nearestDot, objectiveLine, ordinal, targetCopy, type GapInput } from "../lib/explain.ts";
import type { Dot } from "../lib/zip.ts";

const dots: Dot[] = [[0, 0, 1], [0, 4, 2], [2, 2, 3], [4, 4, 4]];
const base: GapInput = {
  actualMs: 30_000,
  predicted: { value: 50_000, unit: "ms" },
  label: "human_time",
  backtracks: 0,
  pause: null,
  dots,
  firstTime: false,
};

test("clock formats m:ss", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65_000), "1:05");
});

test("ordinals, including the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "112th"]);
});

test("nearest dot: within 2 cells, lower label wins a tie, else none", () => {
  assert.equal(nearestDot(dots, [2, 3]), 3);
  assert.equal(nearestDot(dots, [0, 2]), 1, "equidistant from 1 and 2 picks 1");
  assert.equal(nearestDot(dots, [3, 0]), null, "far from every dot");
});

test("faster: the percent is the headline, the explanation sits under it", () => {
  const p = gapParts(base);
  assert.deepEqual(p.headline, { big: "40%", small: "faster than predicted", tone: "faster" });
  assert.equal(p.detail, "No backtracks.");
  assert.equal(gapParts({ ...base, backtracks: 1 }).detail, "Only 1 backtrack.");
  assert.equal(gapParts({ ...base, backtracks: 3 }).detail, "Only 3 backtracks.");
  assert.equal(explainGap(base), "You were 40% faster than predicted. No backtracks.");
});

test("slower: pause near a dot plus backtracks, which the model cannot see", () => {
  const p = gapParts({ ...base, actualMs: 70_000, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] } });
  assert.deepEqual(p.headline, { big: "40%", small: "slower than predicted", tone: "slower" });
  assert.equal(p.detail, "You paused 9 s near the 3rd dot and backtracked 4 times, which the model does not see.");
});

test("slower with only backtracks, only a pause, or neither", () => {
  assert.match(gapParts({ ...base, actualMs: 70_000, backtracks: 1 }).detail, /^You backtracked 1 time, which the model does not see\.$/);
  assert.match(gapParts({ ...base, actualMs: 70_000, pause: { ms: 12_000, cell: [3, 0] } }).detail, /^You paused 12 s, which/, "no dot nearby: no location");
  assert.match(gapParts({ ...base, actualMs: 70_000 }).detail, /^A clean run, so this one was just harder on you than Yomi guessed\.$/);
});

test("slower on a first solve says Yomi has no history", () => {
  assert.match(gapParts({ ...base, actualMs: 70_000, firstTime: true }).detail, /first solve, so Yomi has no history on you yet\.$/);
  assert.doesNotMatch(gapParts({ ...base, actualMs: 70_000 }).detail, /first solve/);
});

test("a short pause is not blamed", () => {
  assert.doesNotMatch(gapParts({ ...base, actualMs: 70_000, backtracks: 1, pause: { ms: 2_000, cell: [2, 2] } }).detail, /paused/);
  assert.doesNotMatch(gapParts({ ...base, actualMs: 70_000, backtracks: 1, pause: { ms: 4_000, cell: [2, 2] } }).detail, /paused/, "under 10% of a 70 s solve");
});

test("within 10% is spot on", () => {
  assert.deepEqual(gapParts({ ...base, actualMs: 52_000 }), { headline: { big: "Right on", small: "Yomi's guess", tone: "close" }, detail: "Within 10% of Yomi's guess." });
  assert.equal(gapParts({ ...base, actualMs: 52_000, backtracks: 2 }).detail, "Even though you backtracked 2 times.");
  assert.equal(explainGap({ ...base, actualMs: 52_000 }), "Right on Yomi's guess. Within 10% of Yomi's guess.");
});

test("solver_effort never claims a time gap and says the guess is not a time yet", () => {
  const solver: GapInput = { ...base, label: "solver_effort", predicted: { value: 72, unit: "solver_steps" }, actualMs: 90_000 };
  const p = gapParts({ ...solver, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] } });
  assert.equal(p.headline, null, "no percentage for solver steps");
  assert.equal(p.detail, "You paused 9 s near the 3rd dot and backtracked 4 times. Yomi's guess is still in solver steps, not a time. It needs a retrain on 30+ real solves first.");
  assert.doesNotMatch(p.detail, /faster|slower|%/);
  assert.equal(explainGap(solver), "A clean run with no backtracks. Yomi's guess is still in solver steps, not a time. It needs a retrain on 30+ real solves first.");
});

test("no model or a bad prediction falls back to the learning line, never a ratio", () => {
  for (const bad of [{ label: null, predicted: null }, { predicted: { value: 0, unit: "ms" as const } }, { predicted: { value: Number.NaN, unit: "ms" as const } }]) {
    const p = gapParts({ ...base, ...bad });
    assert.equal(p.headline, null);
    assert.doesNotMatch(p.detail, /faster|slower|%/);
  }
});

test("no em dashes in any line", () => {
  const lines = [
    explainGap(base),
    explainGap({ ...base, actualMs: 70_000, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] }, firstTime: true }),
    explainGap({ ...base, label: "solver_effort" }),
    targetCopy("human_time", 42_000, "x").headline + targetCopy("human_time", 42_000, "x").note,
    targetCopy("solver_effort", 72, "middle of the pack").headline + targetCopy("solver_effort", 72, "middle of the pack").note,
    objectiveLine(13),
    JSON.stringify(gapParts({ ...base, actualMs: 70_000 })),
  ];
  for (const l of lines) assert.doesNotMatch(l, /[—–]/);
});

test("target copy: a time target to beat only for a human-time model", () => {
  const human = targetCopy("human_time", 42_000, "on the easier side");
  assert.equal(human.headline, "Target: beat 0:42");
  const solver = targetCopy("solver_effort", 72.4, "on the harder side");
  assert.match(solver.headline, /Yomi's read: on the harder side\. Think you can crack it\?/);
  assert.match(solver.note, /72 solver steps for a computer, not a time/);
  assert.doesNotMatch(solver.headline + solver.note, /\d:\d\d/, "no clock-looking number for solver steps");
});

test("objective line names the last dot", () => {
  assert.equal(objectiveLine(13), "Connect 1 to 13 in order and fill every cell");
  assert.equal(objectiveLine(4), "Connect 1 to 4 in order and fill every cell");
});
