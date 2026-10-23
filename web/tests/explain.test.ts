import assert from "node:assert/strict";
import { test } from "node:test";
import { clock } from "../lib/clock.ts";
import { explainGap, nearestDot, ordinal, targetCopy, type GapInput } from "../lib/explain.ts";
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

test("faster with no backtracks", () => {
  assert.equal(explainGap(base), "You were 40% faster: no backtracks.");
});

test("faster even with backtracks", () => {
  assert.equal(explainGap({ ...base, backtracks: 1 }), "You were 40% faster: only 1 backtrack.");
  assert.equal(explainGap({ ...base, backtracks: 3 }), "You were 40% faster: only 3 backtracks.");
});

test("slower: pause near a dot plus backtracks, the model cannot see either", () => {
  const out = explainGap({ ...base, actualMs: 70_000, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] } });
  assert.equal(out, "You were 40% slower. You paused 9 s near the 3rd dot and backtracked 4 times, which the model does not see.");
});

test("slower with only backtracks, only a pause, or neither", () => {
  assert.match(explainGap({ ...base, actualMs: 70_000, backtracks: 1 }), /You backtracked 1 time, which the model does not see\./);
  assert.match(explainGap({ ...base, actualMs: 70_000, pause: { ms: 12_000, cell: [3, 0] } }), /You paused 12 s, which/, "no dot nearby: no location");
  assert.match(explainGap({ ...base, actualMs: 70_000 }), /A clean run, so this one was just harder on you than Yomi guessed\./);
});

test("slower on a first solve says Yomi has no history", () => {
  assert.match(explainGap({ ...base, actualMs: 70_000, firstTime: true }), /first solve, so Yomi has no history on you yet\.$/);
  assert.doesNotMatch(explainGap({ ...base, actualMs: 70_000 }), /first solve/);
});

test("a short pause is not blamed", () => {
  assert.doesNotMatch(explainGap({ ...base, actualMs: 70_000, backtracks: 1, pause: { ms: 2_000, cell: [2, 2] } }), /paused/);
  assert.doesNotMatch(explainGap({ ...base, actualMs: 70_000, backtracks: 1, pause: { ms: 4_000, cell: [2, 2] } }), /paused/, "under 10% of a 70 s solve");
});

test("within 10% is spot on", () => {
  assert.equal(explainGap({ ...base, actualMs: 52_000 }), "Right on Yomi's guess.");
  assert.equal(explainGap({ ...base, actualMs: 52_000, backtracks: 2 }), "Right on Yomi's guess, even though you backtracked 2 times.");
});

test("solver_effort never claims a time gap and says the model is still learning", () => {
  const solver: GapInput = { ...base, label: "solver_effort", predicted: { value: 72, unit: "solver_steps" }, actualMs: 90_000 };
  const out = explainGap({ ...solver, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] } });
  assert.equal(out, "You paused 9 s near the 3rd dot and backtracked 4 times. Yomi's model is still learning from real players, so its guess is not a time yet.");
  assert.doesNotMatch(out, /faster|slower|%/);
  assert.equal(explainGap(solver), "A clean run with no backtracks. Yomi's model is still learning from real players, so its guess is not a time yet.");
});

test("no model or a bad prediction falls back to the learning line, never a ratio", () => {
  assert.doesNotMatch(explainGap({ ...base, label: null, predicted: null }), /faster|slower|%/);
  assert.doesNotMatch(explainGap({ ...base, predicted: { value: 0, unit: "ms" } }), /faster|slower|%/);
  assert.doesNotMatch(explainGap({ ...base, predicted: { value: Number.NaN, unit: "ms" } }), /faster|slower|%/);
});

test("no em dashes in any line", () => {
  const lines = [
    explainGap(base),
    explainGap({ ...base, actualMs: 70_000, backtracks: 4, pause: { ms: 9_000, cell: [2, 3] }, firstTime: true }),
    explainGap({ ...base, label: "solver_effort" }),
    targetCopy("human_time", 42_000, "x").headline + targetCopy("human_time", 42_000, "x").note,
    targetCopy("solver_effort", 72, "middle of the pack").headline + targetCopy("solver_effort", 72, "middle of the pack").note,
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
