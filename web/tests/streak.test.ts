import assert from "node:assert/strict";
import { test } from "node:test";
import { addDay, daysBefore, localDay, streakState } from "../lib/streak.ts";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 0);
const TODAY = at(2026, 10, 22);

test("no solves means no streak and nothing at risk", () => {
  const s = streakState([], TODAY);
  assert.deepEqual([s.count, s.doneToday, s.atRisk], [0, false, false]);
  assert.deepEqual(s.week, [false, false, false, false, false, false, false]);
});

test("solved today counts today and the run before it", () => {
  const s = streakState(["2026-10-20", "2026-10-21", "2026-10-22"], TODAY);
  assert.deepEqual([s.count, s.doneToday, s.atRisk], [3, true, false]);
  assert.deepEqual(s.week, [false, false, false, false, true, true, true]);
});

test("streak from yesterday is alive but at risk until today is solved", () => {
  const s = streakState(["2026-10-20", "2026-10-21"], TODAY);
  assert.deepEqual([s.count, s.doneToday, s.atRisk], [2, false, true]);
});

test("a missed day resets the streak", () => {
  const s = streakState(["2026-10-18", "2026-10-19", "2026-10-20"], TODAY);
  assert.deepEqual([s.count, s.doneToday, s.atRisk], [0, false, false]);
});

test("days across a month boundary and a DST change still chain", () => {
  // US/Canada clocks go back on 2026-11-01; the 31st, 1st and 2nd must be three distinct days.
  const s = streakState(["2026-10-31", "2026-11-01", "2026-11-02"], at(2026, 11, 2));
  assert.equal(s.count, 3);
  assert.equal(daysBefore(at(2026, 3, 1), 1), "2026-02-28");
});

test("addDay is idempotent, sorted and bounded", () => {
  const once = addDay(["2026-10-21"], TODAY);
  assert.deepEqual(once, ["2026-10-21", "2026-10-22"]);
  assert.equal(addDay(once, TODAY), once);
  const many = Array.from({ length: 450 }, (_, i) => daysBefore(at(2026, 10, 21), i + 1));
  assert.equal(addDay(many, TODAY).length, 400);
  assert.equal(localDay(TODAY), "2026-10-22");
});
