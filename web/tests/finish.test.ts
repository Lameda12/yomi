import assert from "node:assert/strict";
import { test } from "node:test";
import { mulberry32 } from "../lib/background.ts";
import { MAX_LIFE, burstDuration, finishKind, spawnSparks } from "../lib/finish.ts";

test("outcome decides the effect: full on a win, subtle on an Extreme loss, none on a timeout", () => {
  assert.equal(finishKind("win"), "full");
  assert.equal(finishKind("late"), "subtle");
  assert.equal(finishKind("timeout"), null);
});

test("a full burst has more, bigger and faster sparks than a subtle one", () => {
  const full = spawnSparks([100, 100], "full", mulberry32(1));
  const subtle = spawnSparks([100, 100], "subtle", mulberry32(1));
  assert.ok(full.length > subtle.length);
  assert.ok(Math.max(...full.map((p) => p.size)) > Math.max(...subtle.map((p) => p.size)));
  const speed = (ps: typeof full) => Math.max(...ps.map((p) => Math.hypot(p.vx, p.vy)));
  assert.ok(speed(full) > speed(subtle));
});

test("every spark starts at the origin", () => {
  for (const kind of ["full", "subtle"] as const) {
    for (const p of spawnSparks([40, 70], kind, mulberry32(3))) assert.deepEqual([p.x, p.y], [40, 70]);
  }
});

test("the whole effect is gone in under a second, at 60 fps and at 30 fps", () => {
  assert.ok(MAX_LIFE < 1);
  for (const kind of ["full", "subtle"] as const) {
    for (const seed of [1, 2, 3, 99]) {
      for (const fps of [60, 30]) {
        const d = burstDuration(spawnSparks([50, 50], kind, mulberry32(seed)), fps);
        assert.ok(d < 1, `${kind} seed ${seed} at ${fps} fps took ${d.toFixed(2)} s`);
      }
    }
  }
});

test("sparks scale with the board", () => {
  const small = spawnSparks([0, 0], "full", mulberry32(5), 0.5);
  const big = spawnSparks([0, 0], "full", mulberry32(5), 1);
  assert.ok(Math.max(...small.map((p) => p.size)) < Math.max(...big.map((p) => p.size)));
});

test("the same seed gives the same burst", () => {
  assert.deepEqual(spawnSparks([1, 2], "full", mulberry32(7)), spawnSparks([1, 2], "full", mulberry32(7)));
});
