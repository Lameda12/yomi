// Run with --conditions=react-server so `import "server-only"` resolves (see npm test).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { dedupeBySolveId } from "../lib/dedupe.ts";

// File mode: no database, JSONL in a temp dir. Set before importing the store.
const dir = mkdtempSync(path.join(tmpdir(), "yomi-store-"));
const file = path.join(dir, "solves.jsonl");
delete process.env.DATABASE_URL;
process.env.SOLVES_JSONL = file;
const { allSolves, insertSolve } = await import("../lib/store.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

const solve = (solve_id: string) => ({
  solve_id,
  player_id: randomUUID(),
  puzzle_id: "zip-5x5-01",
  grid_size: 5,
  n_dots: 13,
  device: "mouse" as const,
  started_at_ms: 1,
  ended_at_ms: 2001,
  solve_ms: 2000,
  completed: true,
  events: [[0, 1, 4, 2]] as [number, number, number, number][],
  backtracks: 0,
  max_pause_ms: null,
  stuck_cell: null,
  played_zip_before: null,
});

test("same solve_id twice is stored once", async () => {
  const id = randomUUID();
  assert.equal(await insertSolve(solve(id)), true);
  assert.equal(await insertSolve(solve(id)), false);
  assert.equal(await insertSolve(solve(randomUUID())), true);
  const rows = await allSolves();
  assert.equal(rows.filter((r) => r.solve_id === id).length, 1);
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 2);
});

test("duplicates already in the file (concurrent retries) are dropped on read", async () => {
  const [first] = await allSolves();
  appendFileSync(file, JSON.stringify({ ...first, id: 99 }) + "\n");
  const rows = await allSolves();
  assert.equal(rows.filter((r) => r.solve_id === first.solve_id).length, 1);
  assert.equal(rows.find((r) => r.solve_id === first.solve_id)!.id, first.id, "keeps the first copy");
});

test("rows without a solve_id (older data) are all kept", () => {
  const rows = [{ solve_id: null }, { solve_id: null }, { solve_id: "a" }, { solve_id: "a" }];
  assert.equal(dedupeBySolveId(rows).length, 3);
});
