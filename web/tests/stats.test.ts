import assert from "node:assert/strict";
import { test } from "node:test";
import { createTotalsSource } from "../lib/stats.ts";

const quiet = () => {
  const orig = console.error;
  console.error = () => {};
  return () => (console.error = orig);
};

test("fresh totals pass straight through", async () => {
  const get = createTotalsSource(async () => ({ solves: 12, players: 4 }));
  const a = await get();
  assert.deepEqual([a.solves, a.players, a.stale], [12, 4, false]);
  assert.ok(typeof a.at === "number");
});

test("a slow database falls back to the last totals instead of hanging", async () => {
  let slow = false;
  const get = createTotalsSource(() => (slow ? new Promise(() => {}) : Promise.resolve({ solves: 7, players: 3 })), 50);
  await get();
  slow = true;
  const restore = quiet();
  const started = Date.now();
  const a = await get();
  restore();
  assert.ok(Date.now() - started < 1000, "answered promptly");
  assert.deepEqual([a.solves, a.players, a.stale], [7, 3, true]);
});

test("a failing database falls back too, and recovers on the next good read", async () => {
  let fail = false;
  let n = 0;
  const get = createTotalsSource(async () => {
    if (fail) throw new Error("neon down");
    return { solves: ++n, players: 1 };
  });
  await get();
  fail = true;
  const restore = quiet();
  const down = await get();
  restore();
  assert.deepEqual([down.solves, down.stale], [1, true]);
  fail = false;
  const back = await get();
  assert.deepEqual([back.solves, back.stale], [2, false]);
});

test("nothing ever loaded and the database is down: nulls, marked stale", async () => {
  const get = createTotalsSource(async () => {
    throw new Error("down");
  });
  const restore = quiet();
  const a = await get();
  restore();
  assert.deepEqual([a.solves, a.players, a.stale, a.at], [null, null, true, null]);
});
