import assert from "node:assert/strict";
import { test } from "node:test";
import { addDay, daysBefore, daysFrom, localDay, streakState } from "../lib/streak.ts";

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

test("addDay also takes a day that is already a YYYY-MM-DD string", () => {
  assert.deepEqual(addDay(["2026-10-21"], "2026-10-22"), ["2026-10-21", "2026-10-22"]);
  assert.deepEqual(addDay(["2026-10-22"], "2026-10-22"), ["2026-10-22"]);
});

test("daysFrom drops days before the first daily and anything that is not a day", () => {
  const stored = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "nonsense", "2026-13-99x"];
  assert.deepEqual(daysFrom(stored, "2026-11-03"), ["2026-11-03", "2026-11-05"]);
  assert.deepEqual(daysFrom([], "2026-11-03"), []);
});

test("the streak counts only days the daily was solved: old any-solve days before the first daily do not chain into it", () => {
  const before = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]; // days with some solve, before there was a daily
  const nov3 = at(2026, 11, 3);
  assert.equal(streakState(before, nov3).atRisk, true); // unfiltered, the old days would look like a live 4-day streak
  const s = streakState(addDay(daysFrom(before, "2026-11-03"), nov3), nov3);
  assert.deepEqual([s.count, s.doneToday, s.atRisk], [1, true, false]);
  const missed = streakState(addDay(daysFrom(before, "2026-11-03"), "2026-11-03"), at(2026, 11, 5));
  assert.deepEqual([missed.count, missed.atRisk], [0, false]); // skipped Nov 4: the streak is over
});
