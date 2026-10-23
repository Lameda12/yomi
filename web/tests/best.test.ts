import assert from "node:assert/strict";
import { test } from "node:test";
import { bestKey, parseBest, readBest, recordBest, writeBest } from "../lib/best.ts";

test("the first solve sets the best but is not a new best", () => {
  const r = recordBest({}, bestKey(5, "regular"), 40_000);
  assert.deepEqual(r, { map: { "5x5:regular": 40_000 }, previous: null, isNew: false });
});

test("a faster solve is a new best and keeps the old time to show", () => {
  const r = recordBest({ "5x5:regular": 40_000 }, "5x5:regular", 31_000);
  assert.equal(r.isNew, true);
  assert.equal(r.previous, 40_000);
  assert.equal(r.map["5x5:regular"], 31_000);
});

test("a slower or equal solve keeps the best", () => {
  for (const ms of [40_000, 55_000]) {
    const r = recordBest({ "5x5:regular": 40_000 }, "5x5:regular", ms);
    assert.equal(r.isNew, false);
    assert.equal(r.map["5x5:regular"], 40_000);
  }
});

test("size and mode are separate bests", () => {
  const start = { "5x5:regular": 40_000 };
  const extreme = recordBest(start, bestKey(5, "extreme"), 90_000);
  assert.equal(extreme.isNew, false, "no earlier Extreme time to beat");
  assert.equal(extreme.map["5x5:regular"], 40_000);
  const six = recordBest(extreme.map, bestKey(6, "regular"), 120_000);
  assert.deepEqual(Object.keys(six.map).sort(), ["5x5:extreme", "5x5:regular", "6x6:regular"]);
});

test("bad times are ignored and never overwrite a best", () => {
  for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = recordBest({ "5x5:regular": 40_000 }, "5x5:regular", ms);
    assert.equal(r.isNew, false);
    assert.equal(r.map["5x5:regular"], 40_000);
  }
});

test("a corrupt stored value is treated as no best", () => {
  assert.equal(recordBest({ "5x5:regular": Number.NaN }, "5x5:regular", 40_000).previous, null);
  assert.deepEqual(parseBest("not json"), {});
  assert.deepEqual(parseBest("[1,2]"), {});
  assert.deepEqual(parseBest(null), {});
  assert.deepEqual(parseBest('{"a":100,"b":"x","c":-1,"d":null}'), { a: 100 });
});

test("storage blocked: read gives an empty map and write does not throw", () => {
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    assert.deepEqual(readBest(), {});
    assert.doesNotThrow(() => writeBest({ a: 1 }));
  } finally {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: saved });
    if (saved === undefined) delete g.localStorage;
  }
});

test("round-trips through storage", () => {
  const mem = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
  });
  try {
    writeBest({ "5x5:regular": 31_000 });
    assert.deepEqual(readBest(), { "5x5:regular": 31_000 });
  } finally {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: saved });
    if (saved === undefined) delete g.localStorage;
  }
});
