// Run with --conditions=react-server so `import "server-only"` resolves (see npm test).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  markTutorialSeen,
  tutorialMove,
  tutorialSeen,
  tutorialSkipUndo,
  tutorialSolved,
  tutorialStage,
  tutorialStart,
  tutorialUndo,
  type TutorialState,
} from "../lib/tutorial.ts";

// File mode store in a temp dir, as in store.test.ts: the tutorial must leave it empty.
const dir = mkdtempSync(path.join(tmpdir(), "yomi-tutorial-"));
const file = path.join(dir, "solves.jsonl");
delete process.env.DATABASE_URL;
process.env.SOLVES_JSONL = file;
const { allSolves, solveTotals } = await import("../lib/store.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

const play = (s: TutorialState, ...cells: [number, number][]) => cells.reduce(tutorialMove, s);

test("a full tutorial run creates zero DB rows and makes zero network calls", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: unknown) => {
    calls.push(String(input));
    return Promise.reject(new Error("the tutorial must not use the network"));
  }) as typeof fetch;
  try {
    const before = (await allSolves()).length;
    let s = tutorialStart();
    s = play(s, [0, 2]);
    s = tutorialUndo(s);
    s = play(s, [0, 2], [1, 2], [1, 0], [2, 0], [2, 2]);
    assert.equal(tutorialSolved(s), true);
    assert.equal(tutorialStage(s), 3);
    markTutorialSeen();
    assert.equal(calls.length, 0, "no fetch at all, so no POST /api/solves");
    assert.equal((await allSolves()).length, before);
    assert.equal((await allSolves()).length, 0);
    assert.equal((await solveTotals()).solves, 0);
    assert.equal(existsSync(file) ? readFileSync(file, "utf8").trim() : "", "", "nothing was written to the store");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("tutorial code does not import the network, queue, player or store modules", () => {
  const banned = /(submit|player|store|db|stats|leaderboard)(\.ts)?["']/;
  for (const f of ["../lib/tutorial.ts", "../components/Tutorial.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const line of src.split("\n").filter((l) => /^\s*import\b/.test(l) || /from\s+["']/.test(l))) {
      assert.doesNotMatch(line, banned, `${f}: ${line}`);
    }
    assert.doesNotMatch(src, /fetch\(|\/api\/|sendBeacon|XMLHttpRequest/, `${f} must not talk to the server`);
  }
});

test("stages follow the player: 1 to 2, undo, finish, done", () => {
  let s = tutorialStart();
  assert.equal(tutorialStage(s), 0);
  s = play(s, [0, 1]);
  assert.equal(tutorialStage(s), 0, "2 not reached yet");
  s = play(s, [0, 2]);
  assert.equal(tutorialStage(s), 1);
  s = play(s, [0, 1]); // drag back over the path
  assert.equal(s.undid, true);
  assert.equal(tutorialStage(s), 2);
});

test("an undo before reaching 2 does not count as the undo step", () => {
  let s = play(tutorialStart(), [0, 1]);
  s = tutorialUndo(s);
  assert.equal(s.undid, false);
  assert.equal(tutorialStage(s), 0);
});

test("the Undo button steps back one cell and stops at the start", () => {
  let s = play(tutorialStart(), [0, 2]);
  s = tutorialUndo(s);
  assert.deepEqual(s.path, [[0, 0], [0, 1]]);
  s = tutorialUndo(tutorialUndo(tutorialUndo(s)));
  assert.deepEqual(s.path, [[0, 0]]);
});

test("'Got it' skips the undo step only after 1 to 2 is connected", () => {
  assert.equal(tutorialSkipUndo(tutorialStart()).undid, false);
  assert.equal(tutorialStage(tutorialSkipUndo(play(tutorialStart(), [0, 2]))), 2);
});

test("dots must be hit in order and cells can't be skipped", () => {
  const s = play(tutorialStart(), [2, 0]);
  assert.deepEqual(s.path, [[0, 0], [1, 0]], "stops before 3");
  assert.equal(tutorialSolved(play(tutorialStart(), [0, 2], [1, 2])), false, "not every cell is filled");
});

test("a solved tutorial ignores further moves", () => {
  const solved = play(tutorialStart(), [0, 2], [1, 2], [1, 0], [2, 0], [2, 2]);
  assert.deepEqual(tutorialMove(solved, [2, 1]), solved);
  assert.deepEqual(tutorialUndo(solved), solved);
});

test("the seen flag works with storage blocked (no localStorage, or one that throws)", () => {
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    delete g.localStorage;
    assert.equal(tutorialSeen(), false);
    assert.doesNotThrow(markTutorialSeen);
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    assert.equal(tutorialSeen(), false);
    assert.doesNotThrow(markTutorialSeen);
  } finally {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: saved });
    if (saved === undefined) delete g.localStorage;
  }
});

test("the seen flag round-trips when storage works", () => {
  const mem = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
  });
  try {
    assert.equal(tutorialSeen(), false);
    markTutorialSeen();
    assert.equal(tutorialSeen(), true);
  } finally {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: saved });
    if (saved === undefined) delete g.localStorage;
  }
});
