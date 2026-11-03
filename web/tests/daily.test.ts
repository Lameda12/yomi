// Run these tests in a zone that has DST. Halifax falls back on 2026-11-01 (a 25-hour day) and springs forward on
// 2027-03-14 (a 23-hour day), which is exactly where a "milliseconds since the epoch / 86400000" calculation breaks.
process.env.TZ = "America/Halifax";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAILY_FIRST_DAY, dailyIndex, dailyNumber, dailyNumberOf, daysSinceEpoch, formatCountdown, isDailyId, markDailySaved, msUntilNextDay, parseDailyResult, puzzleTitle, shareLabel, splitPuzzles, withSaved,
} from "../lib/daily.ts";
import { sprintOrder } from "../lib/sprint.ts";
import { localDay } from "../lib/streak.ts";

const at = (y: number, m: number, d: number, h = 15, min = 0) => new Date(y, m - 1, d, h, min);
const POOL = 120;

test("the test zone really has DST (otherwise the DST cases below prove nothing)", () => {
  assert.notEqual(at(2026, 7, 1).getTimezoneOffset(), at(2026, 12, 1).getTimezoneOffset());
});

test("day 0 is 2026-11-03 and is puzzle #1", () => {
  assert.equal(DAILY_FIRST_DAY, "2026-11-03");
  assert.equal(daysSinceEpoch(at(2026, 11, 3)), 0);
  assert.equal(dailyIndex(at(2026, 11, 3), POOL), 0);
  assert.equal(dailyNumber(dailyIndex(at(2026, 11, 3), POOL)), 1);
});

test("the index depends on the calendar day, not on the time of day", () => {
  for (const [h, m] of [[0, 0], [0, 1], [12, 0], [23, 59]]) assert.equal(dailyIndex(at(2026, 11, 3, h, m), POOL), 0, `${h}:${m}`);
  for (const [h, m] of [[0, 0], [0, 1], [23, 59]]) assert.equal(dailyIndex(at(2026, 11, 4, h, m), POOL), 1, `${h}:${m}`);
});

test("day 1 is puzzle #2", () => {
  assert.equal(dailyIndex(at(2026, 11, 4), POOL), 1);
  assert.equal(dailyNumber(1), 2);
});

test("days across the 2026-11-01 DST change (25-hour day) are distinct and consecutive", () => {
  const days = [at(2026, 10, 31), at(2026, 11, 1), at(2026, 11, 2), at(2026, 11, 3), at(2026, 11, 4)];
  assert.deepEqual(days.map(daysSinceEpoch), [-3, -2, -1, 0, 1]);
  // the 25-hour day itself, early and late
  assert.equal(daysSinceEpoch(at(2026, 11, 1, 0, 30)), -2);
  assert.equal(daysSinceEpoch(at(2026, 11, 1, 23, 30)), -2);
});

test("the 2027-03-14 spring-forward day (23 hours) neither skips nor repeats a puzzle", () => {
  // 2026-11-03 to 2027-03-14 is 131 calendar days; 131 mod 120 is 11.
  assert.deepEqual([at(2027, 3, 13), at(2027, 3, 14), at(2027, 3, 15)].map((d) => daysSinceEpoch(d)), [130, 131, 132]);
  assert.deepEqual([at(2027, 3, 13), at(2027, 3, 14), at(2027, 3, 15)].map((d) => dailyIndex(d, POOL)), [10, 11, 12]);
  assert.equal(daysSinceEpoch(at(2027, 3, 14, 0, 30)), 131); // just after midnight, before the clocks jump
  assert.equal(daysSinceEpoch(at(2027, 3, 14, 23, 59)), 131);
});

test("wrap-around: the last puzzle is #120, and the day after it starts again at #1", () => {
  const last = at(2027, 3, 2); // day 119
  const wrapped = at(2027, 3, 3); // day 120
  assert.equal(daysSinceEpoch(last), 119);
  assert.equal(dailyNumber(dailyIndex(last, POOL)), 120);
  assert.equal(daysSinceEpoch(wrapped), 120);
  assert.equal(dailyNumber(dailyIndex(wrapped, POOL)), 1);
  assert.equal(dailyNumber(dailyIndex(at(2027, 3, 4), POOL)), 2);
  assert.equal(dailyIndex(at(2028, 11, 3), POOL), (365 + 366) % POOL); // 2028 is a leap year: 731 days later
});

test("the pool length is the modulus, whatever it is", () => {
  assert.equal(dailyIndex(at(2026, 11, 13), 7), 3); // day 10
  assert.equal(dailyIndex(at(2026, 11, 13), 1), 0);
});

test("before day 0 the index still lands inside the pool", () => {
  assert.equal(dailyIndex(at(2026, 11, 2), POOL), 119);
  assert.equal(dailyIndex(at(2026, 10, 1), POOL), (((-33) % POOL) + POOL) % POOL);
});

test("an empty pool is not a crash", () => {
  assert.equal(dailyIndex(at(2026, 11, 3), 0), 0);
});

test("daily ids and titles: Yomi #N for dailies, Practice #N for the old pool", () => {
  assert.ok(isDailyId("daily-001") && isDailyId("daily-120"));
  assert.ok(!isDailyId("zip-5x5-01") && !isDailyId("daily-1") && !isDailyId("xdaily-001") && !isDailyId("daily-0012"));
  assert.equal(dailyNumberOf("daily-007"), 7);
  assert.equal(dailyNumberOf("daily-120"), 120);
  assert.equal(dailyNumberOf("zip-6x6-03"), null);
  assert.equal(puzzleTitle("daily-007", 37), "Yomi #7");
  assert.equal(puzzleTitle("zip-6x6-03", 18), "Practice #18");
  assert.equal(puzzleTitle("unknown", 0), "Yomi");
});

test("share text names the puzzle: Yomi #N for a daily, Yomi Practice #N for the original pool", () => {
  assert.equal(shareLabel("daily-007", 37), "Yomi #7");
  assert.equal(shareLabel("zip-6x6-03", 18), "Yomi Practice #18");
});

test("time to the next daily is the time to the next LOCAL midnight, also on 23- and 25-hour days", () => {
  assert.equal(msUntilNextDay(at(2026, 11, 3, 23, 59)), 60_000);
  assert.equal(msUntilNextDay(at(2026, 11, 3, 0, 0)), 24 * 3_600_000);
  assert.equal(msUntilNextDay(at(2026, 11, 1, 0, 0)), 25 * 3_600_000); // fall back: the day has 25 hours
  assert.equal(msUntilNextDay(at(2027, 3, 14, 0, 0)), 23 * 3_600_000); // spring forward: 23 hours
  assert.equal(msUntilNextDay(at(2026, 12, 31, 23, 0)), 3_600_000); // across the year
});

test("the countdown reads h:mm:ss and never goes negative", () => {
  assert.equal(formatCountdown(0), "0:00:00");
  assert.equal(formatCountdown(-5), "0:00:00");
  assert.equal(formatCountdown(1), "0:00:01"); // rounds up: it never shows 0:00:00 while time is left
  assert.equal(formatCountdown(61_000), "0:01:01");
  assert.equal(formatCountdown(5 * 3_600_000 + 12 * 60_000 + 9_000), "5:12:09");
  assert.equal(formatCountdown(25 * 3_600_000), "25:00:00");
});

test("the day after the countdown ends is a different day (so the page can switch to the new puzzle)", () => {
  const now = at(2026, 11, 3, 23, 59);
  const next = new Date(now.getTime() + msUntilNextDay(now));
  assert.equal(localDay(next), "2026-11-04");
  assert.equal(dailyIndex(next, POOL), 1);
});

// ---- the saved result of today's daily -------------------------------------------------------------------------------

const good = {
  day: "2026-11-03", puzzle_id: "daily-001", solve_id: "3f2a8c1e-0b7d-4c55-9a11-5d2e6f7a8b90", ms: 31_000, backtracks: 2, pause_ms: 4_000,
  stuck: [1, 2], path: [[0, 0], [0, 1]], pred: { value: 28_000, unit: "ms", model_version: "crowd-median" }, saved: true, first_solve: false,
};

test("a saved daily result survives the round trip through JSON", () => {
  assert.deepEqual(parseDailyResult(JSON.stringify(good)), good);
  assert.deepEqual(parseDailyResult(JSON.stringify({ ...good, stuck: null, pause_ms: null, pred: null })), { ...good, stuck: null, pause_ms: null, pred: null });
});

test("a damaged saved result is ignored, never trusted", () => {
  assert.equal(parseDailyResult(null), null);
  assert.equal(parseDailyResult("{not json"), null);
  assert.equal(parseDailyResult("[]"), null);
  for (const bad of [
    { ...good, day: "yesterday" }, { ...good, puzzle_id: "zip-5x5-01" }, { ...good, solve_id: "x" }, { ...good, ms: 0 }, { ...good, ms: "31" }, { ...good, backtracks: -1 },
    { ...good, path: [] }, { ...good, path: [[0, 0], [1]] }, { ...good, path: [[0, 0.5]] }, { ...good, stuck: [1] }, { ...good, saved: "yes" },
    { ...good, pred: { value: 0, unit: "ms", model_version: "x" } }, { ...good, pred: { value: 5, unit: "minutes", model_version: "x" } }, { ...good, pred: { value: 5, unit: "ms" } },
  ]) assert.equal(parseDailyResult(JSON.stringify(bad)), null, JSON.stringify(bad));
});

test("markDailySaved flips saved on the stored result of that solve, and only that one", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    store.set("yomi_daily", JSON.stringify({ ...good, saved: false }));
    markDailySaved("11111111-1111-4111-8111-111111111111"); // some other solve
    assert.equal(parseDailyResult(store.get("yomi_daily") ?? null)?.saved, false);
    markDailySaved(good.solve_id);
    assert.equal(parseDailyResult(store.get("yomi_daily") ?? null)?.saved, true);
    store.set("yomi_daily", "garbage");
    markDailySaved(good.solve_id); // a damaged record is left alone, not crashed on
    assert.equal(store.get("yomi_daily"), "garbage");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

// ---- which puzzles each mode plays ---------------------------------------------------------------------------------

const all = JSON.parse((await import("node:fs")).readFileSync(new URL("../data/puzzles.json", import.meta.url), "utf8")) as { id: string; n: number }[];

test("the daily pool is the 120 dailies in id order; practice is the original 30, in file order", () => {
  const { dailies, practice } = splitPuzzles([...all].reverse()); // order of the input must not matter for the daily pool
  assert.equal(dailies.length, 120);
  assert.deepEqual(dailies.map((p) => p.id), Array.from({ length: 120 }, (_, i) => `daily-${String(i + 1).padStart(3, "0")}`));
  assert.equal(practice.length, 30);
  assert.ok(practice.every((p) => p.id.startsWith("zip-")));
});

test("Extreme plays the original 30 in the order it always did, and never a daily", () => {
  const { practice } = splitPuzzles(all);
  const order = sprintOrder(practice).map((p) => p.id);
  assert.equal(order.length, 30);
  assert.ok(order.every((id) => !isDailyId(id)));
  assert.deepEqual(order, sprintOrder(all.slice(0, 30)).map((p) => p.id), "same order as before the dailies were added");
  assert.deepEqual(order.slice(0, 15), all.slice(0, 15).map((p) => p.id)); // 5x5 first, in file order
});

test("withSaved marks a restored result saved only when its own solve was uploaded", () => {
  const r = parseDailyResult(JSON.stringify({ ...good, saved: false }))!;
  const other = "11111111-1111-4111-8111-111111111111";
  assert.equal(withSaved(r, [other]), r, "another solve being saved changes nothing (same object, no re-render)");
  assert.equal(withSaved(r, []), r);
  assert.equal(withSaved(null, [good.solve_id]), null);
  const done = withSaved(r, [other, good.solve_id])!;
  assert.equal(done.saved, true);
  assert.deepEqual({ ...done, saved: false }, r, "nothing else about the result changes");
  assert.equal(withSaved(done, [good.solve_id]), done, "already saved: unchanged");
});
