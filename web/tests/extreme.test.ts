import assert from "node:assert/strict";
import { test } from "node:test";
import { EXTREME_FLOOR, MIN_LIMIT_MS, NO_DATA_MS, extremeBase, extremeFactor, extremeLimit } from "../lib/extreme.ts";

test("factor starts at 80%, loses 5 points per consecutive win, and stops at 50%", () => {
  assert.deepEqual([0, 1, 2, 3, 6, 7, 20].map(extremeFactor), [0.8, 0.75, 0.7, 0.65, 0.5, EXTREME_FLOOR, EXTREME_FLOOR]);
  assert.equal(extremeFactor(-3), 0.8); // never looser than the start
});

test("limit = base x factor, rounded, never below the playable minimum", () => {
  assert.equal(extremeLimit(50_000, 0), 40_000);
  assert.equal(extremeLimit(50_000, 2), 35_000);
  assert.equal(extremeLimit(50_000, 99), 25_000); // floor 50%
  assert.equal(extremeLimit(3_000, 0), MIN_LIMIT_MS);
  assert.equal(extremeLimit(33_333, 0), 26_666);
});

test("base: the model's time first, then the puzzle's crowd median, then 60 s", () => {
  assert.deepEqual(extremeBase({ modelMs: 42_000, crowdMedianMs: 30_000 }), { ms: 42_000, source: "model" });
  assert.deepEqual(extremeBase({ modelMs: null, crowdMedianMs: 30_000 }), { ms: 30_000, source: "crowd" });
  const none = extremeBase({ modelMs: null, crowdMedianMs: null });
  assert.equal(none.source, "default");
  assert.equal(extremeLimit(none.ms, 0), NO_DATA_MS, "no data: the limit is exactly 60 s to start");
  assert.equal(extremeLimit(none.ms, 2), 52_500, "and it tightens like any other clock");
  assert.equal(extremeBase({ modelMs: NaN, crowdMedianMs: -1 }).source, "default"); // bad numbers are ignored
  assert.equal(extremeBase({ modelMs: 0, crowdMedianMs: 0 }).source, "default");
});
