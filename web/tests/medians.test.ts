// Run with --conditions=react-server so `import "server-only"` resolves (see npm test).
// The crowd median must come from real people only: test rows must not unlock a crowd target or move a median.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "yomi-medians-"));
delete process.env.DATABASE_URL;
process.env.SOLVES_JSONL = path.join(dir, "solves.jsonl"); // a fresh file: its first 8 rows get ids 1 to 8
const { insertSolve, puzzleMedians } = await import("../lib/store.ts");
const { MIN_CROWD } = await import("../lib/extreme.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

const mk = (puzzle_id: string, solve_ms: number, extra: object = {}) => ({
  solve_id: randomUUID(), player_id: randomUUID(), puzzle_id, grid_size: 5, n_dots: 13, device: "touch" as const, started_at_ms: 1, ended_at_ms: 1 + solve_ms, solve_ms,
  completed: true, events: [[0, 1, 4, 2]] as [number, number, number, number][], backtracks: 0, max_pause_ms: null, stuck_cell: null, played_zip_before: null, ...extra,
});

// Rows 1 to 8 of the file are the early test plays (before migration 007 marks them source = 'test', they are excluded by id).
test("the early test rows (ids 1 to 8) do not count towards a crowd median, before migration 007 is applied", async () => {
  for (const ms of [1_000, 2_000, 3_000, 4_000, 5_000]) await insertSolve(mk("zip-early", ms)); // ids 1 to 5
  for (let i = 0; i < 3; i++) await insertSolve(mk("zip-filler", 9_000 + i)); // ids 6 to 8
  assert.equal((await puzzleMedians())["zip-early"], undefined, "five early rows are not a crowd");
  assert.equal((await puzzleMedians())["zip-filler"], undefined, "ids 6 to 8 are early rows too");
  await insertSolve(mk("zip-early", 40_000)); // id 9: the first real row
  await insertSolve(mk("zip-early", 60_000)); // id 10
  assert.equal((await puzzleMedians())["zip-early"], undefined, "two real solves are still below the crowd size");
  await insertSolve(mk("zip-early", 50_000)); // id 11
  assert.deepEqual((await puzzleMedians())["zip-early"], { median_ms: 50_000, n: 3 }, "three real solves are a crowd, and the early rows do not move the median");
});

test("two real solves plus one test solve do not unlock a three-solve crowd target", async () => {
  assert.equal(MIN_CROWD, 3);
  await insertSolve(mk("zip-test-a", 30_000));
  await insertSolve(mk("zip-test-a", 32_000));
  await insertSolve(mk("zip-test-a", 1_000, { source: "test" }));
  assert.equal((await puzzleMedians())["zip-test-a"], undefined);
  await insertSolve(mk("zip-test-a", 34_000)); // a third real one
  assert.deepEqual((await puzzleMedians())["zip-test-a"], { median_ms: 32_000, n: 3 }, "the test solve is in neither the median nor the count");
});

test("demo and imported rows are real people and still count", async () => {
  await insertSolve(mk("zip-demo", 10_000, { source: "demo" }));
  await insertSolve(mk("zip-demo", 20_000, { source: "local_import" }));
  await insertSolve(mk("zip-demo", 30_000));
  assert.deepEqual((await puzzleMedians())["zip-demo"], { median_ms: 20_000, n: 3 });
});

test("the Neon query makes the same exclusions as the file path", () => {
  const src = readFileSync(new URL("../lib/store.ts", import.meta.url), "utf8");
  const sql = src.slice(src.indexOf("export async function puzzleMedians"), src.indexOf("// ---------- live totals"));
  assert.match(sql, /source is distinct from 'test'/, "rows marked source = 'test' (migration 007)");
  assert.match(sql, /id > \$\{EXCLUDED_ROW_ID_MAX\}/, "ids 1 to 8, until 007 is applied");
  assert.match(sql, /mode = 'regular'/);
});
