import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPRINT_DEFAULT_S, durationLabel, formatRemaining, parseDuration, parseScores, readScores, readSprintSeconds, recordScore, shareScoreMessage,
  sprintOrder, sprintRulesSeen, writeScores, writeSprintSeconds, markSprintRulesSeen,
} from "../lib/sprint.ts";

test("parseDuration: seconds and minutes, fractions, and the bounds", () => {
  assert.deepEqual(parseDuration("60", "s"), { ok: true, seconds: 60 });
  assert.deepEqual(parseDuration("2", "min"), { ok: true, seconds: 120 });
  assert.deepEqual(parseDuration("1.5", "min"), { ok: true, seconds: 90 });
  assert.deepEqual(parseDuration("1,5", "min"), { ok: true, seconds: 90 }, "decimal comma");
  assert.deepEqual(parseDuration("  45 ", "s"), { ok: true, seconds: 45 });
  assert.deepEqual(parseDuration("10", "s"), { ok: true, seconds: 10 });
  assert.deepEqual(parseDuration("10", "min"), { ok: true, seconds: 600 });
});

test("parseDuration rejects empty, non-numeric, too short and too long", () => {
  for (const [v, u] of [["", "s"], ["   ", "min"], ["abc", "s"], ["-5", "s"], ["1e3", "s"], ["5 0", "s"], ["0x10", "s"], ["NaN", "s"], ["Infinity", "s"]] as const) {
    assert.equal(parseDuration(v, u).ok, false, `${v} ${u}`);
  }
  const short = parseDuration("9", "s");
  assert.equal(short.ok, false);
  assert.match(short.ok ? "" : short.error, /At least 10 seconds/);
  const long = parseDuration("11", "min");
  assert.match(long.ok ? "" : long.error, /At most 10 minutes/);
  assert.equal(parseDuration("0.1", "min").ok, false, "6 s is under the minimum");
  assert.equal(parseDuration("601", "s").ok, false);
});

test("durationLabel", () => {
  assert.deepEqual([30, 60, 90, 120, 125, 600].map(durationLabel), ["30 s", "1 min", "1 min 30 s", "2 min", "2 min 5 s", "10 min"]);
});

test("formatRemaining: m:ss, tenths under 10 s, never negative", () => {
  assert.equal(formatRemaining(60_000), "1:00");
  assert.equal(formatRemaining(59_001), "1:00", "rounds up so the clock never shows 0:59 at the start");
  assert.equal(formatRemaining(42_300), "0:43");
  assert.equal(formatRemaining(9_950), "0:10", "rounds up to the next whole second, not 0:010.0");
  assert.equal(formatRemaining(9_900), "0:09.9");
  assert.equal(formatRemaining(7_340), "0:07.4");
  assert.equal(formatRemaining(100), "0:00.1");
  assert.equal(formatRemaining(0), "0:00.0");
  assert.equal(formatRemaining(-500), "0:00.0");
});

test("sprintOrder: smallest grids first, otherwise the original order", () => {
  const ps = [{ id: "a", n: 6 }, { id: "b", n: 5 }, { id: "c", n: 7 }, { id: "d", n: 5 }, { id: "e", n: 6 }];
  assert.deepEqual(sprintOrder(ps).map((p) => p.id), ["b", "d", "a", "e", "c"]);
  assert.deepEqual(ps.map((p) => p.id), ["a", "b", "c", "d", "e"], "input is not mutated");
});

test("recordScore: first scoring run sets the best but is not a new best", () => {
  assert.deepEqual(recordScore({}, 60, 5), { map: { "60": 5 }, previous: null, isNew: false });
});

test("recordScore: only a higher score is a new best, per duration", () => {
  const start = { "60": 5 };
  assert.deepEqual(recordScore(start, 60, 7), { map: { "60": 7 }, previous: 5, isNew: true });
  for (const score of [5, 3]) assert.deepEqual(recordScore(start, 60, score), { map: start, previous: 5, isNew: false });
  const other = recordScore(start, 120, 4);
  assert.equal(other.isNew, false, "a different duration has its own best");
  assert.deepEqual(other.map, { "60": 5, "120": 4 });
});

test("recordScore ignores zero and bad scores, and a corrupt stored best", () => {
  for (const score of [0, -1, 2.5, Number.NaN]) assert.deepEqual(recordScore({ "60": 5 }, 60, score).map, { "60": 5 });
  assert.equal(recordScore({}, 60, 0).map["60"], undefined, "a zero run never sets a best");
  assert.equal(recordScore({ "60": Number.NaN }, 60, 3).previous, null);
});

test("parseScores drops anything that is not a positive whole number", () => {
  assert.deepEqual(parseScores('{"60":5,"30":"x","120":-2,"300":1.5}'), { "60": 5 });
  assert.deepEqual(parseScores("not json"), {});
  assert.deepEqual(parseScores("[1]"), {});
  assert.deepEqual(parseScores(null), {});
});

test("share message", () => {
  assert.equal(shareScoreMessage(7, 60, "https://y.example"), "Yomi Extreme: 7 puzzles in 1 min. Can you beat it? https://y.example");
  assert.equal(shareScoreMessage(1, 30, "https://y.example"), "Yomi Extreme: 1 puzzle in 30 s. Can you beat it? https://y.example");
  assert.doesNotMatch(shareScoreMessage(3, 90, "u"), /[—–]/);
});

function withStorage(storage: unknown, run: () => void) {
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: storage });
  try {
    run();
  } finally {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: saved });
    if (saved === undefined) delete g.localStorage;
  }
}
const blocked = {
  get getItem(): never {
    throw new DOMException("blocked", "SecurityError");
  },
  get setItem(): never {
    throw new DOMException("blocked", "SecurityError");
  },
};

test("storage round-trips", () => {
  const mem = new Map<string, string>();
  withStorage({ getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }, () => {
    assert.equal(readSprintSeconds(), SPRINT_DEFAULT_S);
    writeSprintSeconds(90);
    assert.equal(readSprintSeconds(), 90);
    writeScores({ "60": 7 });
    assert.deepEqual(readScores(), { "60": 7 });
    assert.equal(sprintRulesSeen(), false);
    markSprintRulesSeen();
    assert.equal(sprintRulesSeen(), true);
  });
});

test("a stored duration outside the allowed range falls back to the default", () => {
  for (const bad of ["5", "9999", "abc", "60.5", ""]) {
    withStorage({ getItem: () => bad, setItem: () => {} }, () => assert.equal(readSprintSeconds(), SPRINT_DEFAULT_S, bad));
  }
});

test("storage blocked: reads give defaults and writes do not throw", () => {
  withStorage(blocked, () => {
    assert.equal(readSprintSeconds(), SPRINT_DEFAULT_S);
    assert.deepEqual(readScores(), {});
    assert.equal(sprintRulesSeen(), false);
    assert.doesNotThrow(() => writeSprintSeconds(90));
    assert.doesNotThrow(() => writeScores({ "60": 1 }));
    assert.doesNotThrow(markSprintRulesSeen);
  });
});
