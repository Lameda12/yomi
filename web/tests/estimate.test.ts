import assert from "node:assert/strict";
import { test } from "node:test";
import { CROWD_VERSION, chooseEstimate, estimateFromSaved, lockEstimate, parseMedians, toPrediction } from "../lib/estimate.ts";
import { MIN_CROWD } from "../lib/extreme.ts";

const steps = { value: 311, unit: "solver_steps" as const, version: "m1" };
const time = { value: 42_000, unit: "ms" as const, version: "m2" };
const crowd = { median_ms: 38_000, n: 5 };

test("with a solver-step model, a crowd median is the estimate; it is saved as the crowd-median 'model'", () => {
  const e = chooseEstimate({ model: steps, crowd })!;
  assert.deepEqual(e, { source: "crowd", value: 38_000, unit: "ms", version: "crowd-median", n: 5 });
  assert.equal(CROWD_VERSION, "crowd-median");
  assert.deepEqual(toPrediction(e), { value: 38_000, unit: "ms", model_version: "crowd-median" });
});

test("without a crowd median the solver-steps line stays exactly as it was, with no invented time", () => {
  assert.deepEqual(chooseEstimate({ model: steps, crowd: undefined }), { source: "model", value: 311, unit: "solver_steps", version: "m1", n: null });
  assert.deepEqual(chooseEstimate({ model: steps, crowd: null }), { source: "model", value: 311, unit: "solver_steps", version: "m1", n: null });
  assert.deepEqual(toPrediction(chooseEstimate({ model: steps, crowd: undefined })!), { value: 311, unit: "solver_steps", model_version: "m1" });
});

test("a model that predicts a time wins over the crowd median", () => {
  assert.deepEqual(chooseEstimate({ model: time, crowd }), { source: "model", value: 42_000, unit: "ms", version: "m2", n: null });
});

test("no model and no crowd: no estimate; no model but a crowd: the crowd", () => {
  assert.equal(chooseEstimate({ model: null, crowd: undefined }), null);
  assert.equal(chooseEstimate({ model: null, crowd })?.source, "crowd");
});

test("a crowd that is too small or not a number is ignored", () => {
  assert.equal(chooseEstimate({ model: steps, crowd: { median_ms: 38_000, n: MIN_CROWD - 1 } })?.source, "model");
  for (const bad of [{ median_ms: 0, n: 9 }, { median_ms: -5, n: 9 }, { median_ms: NaN, n: 9 }, { median_ms: Infinity, n: 9 }, { median_ms: 38_000, n: NaN }]) {
    assert.equal(chooseEstimate({ model: steps, crowd: bad })?.source, "model", JSON.stringify(bad));
  }
});

test("the estimate is locked at the first move: later medians change neither the line nor what is saved", () => {
  const before = chooseEstimate({ model: steps, crowd: undefined });
  const arrived = chooseEstimate({ model: steps, crowd });
  assert.equal(lockEstimate(undefined, before), before, "before the first move the live estimate is taken");
  assert.equal(lockEstimate(before, arrived), before, "after it, the locked one stays");
  assert.equal(lockEstimate(null, arrived), null, "locked with nothing to show: nothing appears later either");
});

test("medians from the API: only well-formed entries with enough solves are kept", () => {
  const raw = {
    a: { median_ms: 30_000, n: 4 },
    b: { median_ms: 30_000, n: 2 }, // too few
    c: { median_ms: "30", n: 4 },
    d: null,
    e: { median_ms: 0, n: 9 },
    f: { median_ms: 12_345.6, n: 3 },
  };
  assert.deepEqual(parseMedians(raw), { a: { median_ms: 30_000, n: 4 }, f: { median_ms: 12_346, n: 3 } });
  for (const junk of [null, undefined, 5, "x", [], [1, 2]]) assert.deepEqual(parseMedians(junk), {});
});

test("a saved prediction comes back as the same kind of estimate", () => {
  assert.equal(estimateFromSaved({ value: 38_000, unit: "ms", model_version: "crowd-median" }).source, "crowd");
  assert.equal(estimateFromSaved({ value: 311, unit: "solver_steps", model_version: "m1" }).source, "model");
  assert.equal(estimateFromSaved({ value: 42_000, unit: "ms", model_version: "m2" }).source, "model");
});
