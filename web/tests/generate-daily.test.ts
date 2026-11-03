// Published daily puzzles never change. A stored solve under "daily-009" refers to that exact board, so the generator
// may only append new ids. These tests run the real script on temporary copies of the puzzle file (never the real one).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { appendDailies } from "../lib/dailyPool.ts";
import type { ZipPuzzle } from "../lib/zip.ts";

const SCRIPT = new URL("../scripts/generate-daily.ts", import.meta.url).pathname;
const committed = readFileSync(new URL("../data/puzzles.json", import.meta.url), "utf8");
const all = JSON.parse(committed) as ZipPuzzle[];
const dir = mkdtempSync(path.join(tmpdir(), "yomi-gen-daily-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function copyWith(entries: ZipPuzzle[]): string {
  const f = path.join(dir, `puzzles-${n++}.json`);
  writeFileSync(f, JSON.stringify(entries) + "\n");
  return f;
}
const run = (file: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, "--file", file, ...args], { encoding: "utf8", timeout: 120_000 });
const text = (f: string) => readFileSync(f, "utf8");

// --count 9 is the first nine days: 5x5 and 6x6 only, so these runs take well under a second each.

test("rerunning with the same options is a no-op: the published file is byte-identical", () => {
  const f = copyWith(all);
  const before = text(f);
  const r = run(f, "--count", "9");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /nothing to add/);
  assert.equal(text(f), before);
});

test("other options that would give published ids different boards are refused, and nothing is written", () => {
  const f = copyWith(all);
  const before = text(f);
  const r = run(f, "--no-7x7", "--count", "9"); // changes the size of day 9, so daily-009 would be a different board
  assert.notEqual(r.status, 0, "must refuse");
  assert.match(r.stderr, /daily-009 would change/);
  assert.equal(text(f), before, "the file is untouched");
});

test("--no-7x7 against the real 120-puzzle file is refused too (the run that used to rewrite 68 published boards)", () => {
  const f = copyWith(all);
  const r = run(f, "--no-7x7", "--count", "20");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /would change/);
  assert.equal(text(f), committed);
});

test("a larger --count appends new ids and leaves everything before them byte for byte as it was", () => {
  const f = copyWith(all.slice(0, 35)); // the 30 originals and daily-001..005
  const before = text(f);
  const r = run(f, "--count", "9");
  assert.equal(r.status, 0, r.stderr);
  const after = text(f);
  assert.ok(after.startsWith(before.slice(0, -2) + ","), "the old file is an exact prefix of the new one");
  const grown = JSON.parse(after) as ZipPuzzle[];
  assert.deepEqual(grown.slice(0, 35), all.slice(0, 35), "originals and published dailies untouched");
  assert.deepEqual(grown.map((p) => p.id).slice(35), ["daily-006", "daily-007", "daily-008", "daily-009"]);
  assert.deepEqual(grown, all.slice(0, 39), "and the new ones are exactly the committed ones: generation is stable as the pool grows");
});

test("a bad --count is rejected", () => {
  const f = copyWith(all);
  for (const bad of ["0", "-3", "x", "2.5"]) assert.notEqual(run(f, "--count", bad).status, 0, bad);
  assert.equal(text(f), committed);
});

// ---- the rule itself ------------------------------------------------------------------------------------------------

const p = (id: string, marker: number): ZipPuzzle => ({ id, n: 5, dots: [[0, 0, 1], [marker, 1, 2]], solution: [[0, 0]], features: { n_dots: 2, max_gap: 1, mean_gap: 1, turns: 0 } });
const orig = [p("zip-5x5-01", 0), p("zip-6x6-01", 0)];

test("appendDailies: same boards give the same list; extra generated ids are appended after everything", () => {
  const existing = [...orig, p("daily-001", 1), p("daily-002", 2)];
  assert.deepEqual(appendDailies(existing, [p("daily-001", 1), p("daily-002", 2)]), existing);
  assert.deepEqual(appendDailies(existing, [p("daily-001", 1), p("daily-002", 2), p("daily-003", 3)]), [...existing, p("daily-003", 3)]);
  assert.deepEqual(appendDailies(orig, [p("daily-001", 1)]), [...orig, p("daily-001", 1)]);
});

test("appendDailies: a smaller generated list adds nothing and drops nothing", () => {
  const existing = [...orig, p("daily-001", 1), p("daily-002", 2)];
  assert.deepEqual(appendDailies(existing, [p("daily-001", 1)]), existing);
});

test("appendDailies: a changed board under a published id throws, naming it", () => {
  const existing = [...orig, p("daily-001", 1), p("daily-002", 2)];
  assert.throws(() => appendDailies(existing, [p("daily-001", 1), p("daily-002", 9)]), /daily-002 would change/);
  assert.throws(() => appendDailies(existing, [p("daily-001", 7)]), /daily-001 would change/);
});

test("appendDailies: ids must run daily-001, daily-002, ... in a row", () => {
  assert.throws(() => appendDailies([...orig, p("daily-002", 2)], [p("daily-001", 1)]), /in a row/);
  assert.throws(() => appendDailies(orig, [p("daily-002", 2)]), /numbered daily-001 onwards/);
});
