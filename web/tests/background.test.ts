import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXTREME_SPEED, LAYERS, MAX_ALPHA, ORANGE, PULSE, ROSE, makeShapes, mixRgb, mulberry32, pulseHz, shapeAlpha, spawnBurst, stepParticles, stepShapes, warning,
} from "../lib/background.ts";

test("3 parallax layers of squares, triangles and lines, deterministic for a seed", () => {
  const a = makeShapes(360, 740, 7);
  assert.equal(a.length, LAYERS.reduce((n, l) => n + l.count, 0));
  assert.deepEqual([...new Set(a.map((s) => s.layer))].sort(), [0, 1, 2]);
  assert.deepEqual([...new Set(a.map((s) => s.kind))].sort(), ["line", "square", "triangle"]);
  assert.deepEqual(makeShapes(360, 740, 7), a);
  assert.notDeepEqual(makeShapes(360, 740, 8), a);
  for (const s of a) assert.ok(s.x >= 0 && s.x <= 360 && s.y >= 0 && s.y <= 740);
});

test("nearer layers drift faster (parallax)", () => {
  const speed = (layer: number) => {
    const ss = makeShapes(360, 740).filter((s) => s.layer === layer);
    return ss.reduce((n, s) => n + Math.hypot(s.vx, s.vy), 0) / ss.length;
  };
  assert.ok(speed(0) < speed(1) && speed(1) < speed(2), `${speed(0)} ${speed(1)} ${speed(2)}`);
});

test("regular drift is calm: far layers move a few px per second, and extreme is faster by the stated factor", () => {
  const a = makeShapes(360, 740), b = makeShapes(360, 740);
  stepShapes(a, 1, 360, 740, 1);
  stepShapes(b, 1, 360, 740, EXTREME_SPEED);
  const start = makeShapes(360, 740);
  const moved = (s: typeof a, i: number) => Math.hypot(s[i].x - start[i].x, s[i].y - start[i].y);
  for (const i of [0, 8, 20]) {
    if (a[i].x > 0 && a[i].x < 360) assert.ok(Math.abs(moved(b, i) / moved(a, i) - EXTREME_SPEED) < 1e-6 || moved(a, i) === 0);
  }
  assert.ok(Math.max(...LAYERS.map((l) => l.speed)) <= 20, "regular stays slow");
});

test("shapes wrap around the edges and never run away", () => {
  const s = makeShapes(360, 740);
  for (let i = 0; i < 4000; i++) stepShapes(s, 0.1, 360, 740, EXTREME_SPEED);
  for (const x of s) assert.ok(x.x >= -x.size - 1 && x.x <= 360 + x.size + 1 && x.y >= -x.size - 1 && x.y <= 740 + x.size + 1);
});

test("warning colour starts in the last 20% of the clock and is complete at 100%", () => {
  assert.equal(warning(0), 0);
  assert.equal(warning(0.8), 0);
  assert.ok(Math.abs(warning(0.9) - 0.5) < 1e-9);
  assert.ok(Math.abs(warning(1) - 1) < 1e-9); // floating point: (1 - 0.8) / 0.2 is 0.9999999999999998
  assert.equal(warning(5), 1);
  assert.deepEqual(mixRgb(ORANGE, ROSE, 0), ORANGE);
  assert.deepEqual(mixRgb(ORANGE, ROSE, 1), ROSE);
});

test("pulse speeds up as the clock runs down, and only in extreme", () => {
  assert.equal(pulseHz(0.5, false), 0);
  assert.ok(pulseHz(0, true) < pulseHz(0.5, true) && pulseHz(0.5, true) < pulseHz(1, true));
  assert.ok(Math.abs(pulseHz(1, true) - 2.7) < 1e-9);
});

test("alpha stays very low in every mode, so the grid stays the focus", () => {
  assert.ok(MAX_ALPHA < 0.12, `peak alpha of a single shape ${MAX_ALPHA}`);
  for (const layer of [0, 1, 2] as const) {
    assert.ok(shapeAlpha(layer, false, 1) <= 0.08);
    assert.ok(shapeAlpha(layer, true, 1 + PULSE) <= MAX_ALPHA + 1e-12);
    assert.ok(shapeAlpha(layer, true, 1) > shapeAlpha(layer, false, 1));
  }
});

test("a win burst spawns, flies, and is gone within a second", () => {
  const rnd = mulberry32(3);
  let ps = spawnBurst(360, 740, rnd);
  assert.equal(ps.length, 28);
  let t = 0;
  while (ps.length && t < 5) {
    ps = stepParticles(ps, 1 / 60);
    t += 1 / 60;
  }
  assert.ok(t > 0.4 && t <= 1.0, `burst lasted ${t.toFixed(2)} s`);
});
