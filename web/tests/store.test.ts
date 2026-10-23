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
const { allSolves, dropSnapshot, extremeWins, puzzleMedians, getNicknames, insertSolve, leaderboardSnapshot, predictedSolves, savePlayer, solveTotals, stuckHeat } = await import("../lib/store.ts");
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

test("prediction fields are stored with the solve, and older solves without them still work", async () => {
  const withPred = randomUUID();
  await insertSolve({ ...solve(withPred), pred_value: 39.5, pred_unit: "solver_steps", model_version: "v-test" });
  const row = (await allSolves()).find((r) => r.solve_id === withPred)!;
  assert.deepEqual([row.pred_value, row.pred_unit, row.model_version], [39.5, "solver_steps", "v-test"]);

  const without = randomUUID();
  await insertSolve(solve(without));
  const plain = (await allSolves()).find((r) => r.solve_id === without)!;
  assert.equal(plain.pred_value ?? null, null);
});

test("predictedSolves only returns completed solves with a millisecond prediction and no import tag", async () => {
  const keep = randomUUID();
  await insertSolve({ ...solve(keep), pred_value: 9000, pred_unit: "ms", model_version: "t" });
  await insertSolve({ ...solve(randomUUID()), pred_value: 70, pred_unit: "solver_steps", model_version: "t" }); // not a time
  await insertSolve({ ...solve(randomUUID()), completed: false, pred_value: 9000, pred_unit: "ms", model_version: "t" }); // skipped puzzle
  await insertSolve({ ...solve(randomUUID()), pred_value: 9000, pred_unit: "ms", model_version: "t", source: "local_import" });
  await insertSolve(solve(randomUUID())); // no prediction at all
  const got = await predictedSolves();
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].solve_ms, got[0].pred_value], [2000, 9000]);
  const row = (await allSolves()).find((r) => r.solve_id === keep)!;
  assert.equal(got[0].player_id, row.player_id);
});

test("solveTotals counts completed solves and distinct players", async () => {
  const all = await allSolves();
  const t = await solveTotals();
  assert.equal(t.solves, all.filter((r) => r.completed).length);
  assert.equal(t.players, new Set(all.map((r) => r.player_id)).size);
});

test("players: save, unique case-insensitively, per-player cooldown, clear back to anonymous", async () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  assert.equal((await getNicknames([a, b])).size, 0);
  assert.equal(await savePlayer(a, "Pathfinder"), "ok");
  assert.equal(await savePlayer(b, "pathFINDER"), "taken"); // same name, different case
  assert.equal(await savePlayer(b, "Zig"), "ok");
  assert.equal(await savePlayer(a, "Pathfinder 2"), "cooldown"); // a wrote a moment ago
  assert.equal(await savePlayer(a, "Pathfinder"), "cooldown"); // same-name resave is limited too
  const got = await getNicknames([a, b, c]);
  assert.deepEqual([got.get(a), got.get(b), got.has(c), got.size], ["Pathfinder", "Zig", false, 2]);
  assert.equal(await savePlayer(b, null), "ok"); // clearing is never blocked: back to anonymous
  assert.equal((await getNicknames([a, b])).has(b), false);
  assert.equal(await savePlayer(c, "Zig"), "ok"); // the freed name is available again
  assert.equal((await getNicknames([])).size, 0);
});

test("leaderboardSnapshot is shared for a few seconds and refreshed by a nickname change", async () => {
  dropSnapshot();
  const player = randomUUID();
  const before = await leaderboardSnapshot();
  assert.equal(await leaderboardSnapshot(), before, "second call inside 5 s returns the very same snapshot");
  const concurrent = await Promise.all([leaderboardSnapshot(), leaderboardSnapshot()]);
  assert.equal(concurrent[0], concurrent[1]);
  await insertSolve({ ...solve(randomUUID()), player_id: player, pred_value: 5000, pred_unit: "ms", model_version: "t" });
  assert.equal((await leaderboardSnapshot()).solves.length, before.solves.length, "new solves wait for the cache to expire");
  assert.equal(await savePlayer(player, "Snapshot Sam"), "ok");
  const fresh = await leaderboardSnapshot(); // the nickname write dropped the cache
  assert.equal(fresh.names.get(player), "Snapshot Sam");
  assert.equal(fresh.solves.length, before.solves.length + 1);
});

test("stuckHeat counts where completed solves of one puzzle got stuck, and nothing else", async () => {
  const puzzle = "zip-6x6-heat";
  const mk = (cell: [number, number] | null, completed = true, pid = puzzle) => ({
    ...solve(randomUUID()), puzzle_id: pid, stuck_cell: cell, completed,
  });
  await insertSolve(mk([2, 3]));
  await insertSolve(mk([2, 3]));
  await insertSolve(mk([0, 1]));
  await insertSolve(mk([4, 4], false)); // skipped puzzle: not a stuck signal
  await insertSolve(mk(null)); // no pause recorded
  await insertSolve(mk([2, 3], true, "zip-other")); // another puzzle
  const heat = await stuckHeat(puzzle);
  assert.equal(heat.total, 3);
  assert.deepEqual([...heat.cells].sort((a, b) => b.n - a.n)[0], { r: 2, c: 3, n: 2 });
  assert.equal(heat.cells.length, 2);
  assert.deepEqual(await stuckHeat("zip-never-played"), { cells: [], total: 0 });
});

test("mode and the extreme clock are stored; older rows without them count as regular", async () => {
  const id = randomUUID();
  await insertSolve({ ...solve(id), mode: "extreme", extreme_limit_ms: 30_000 });
  const row = (await allSolves()).find((r) => r.solve_id === id)!;
  assert.deepEqual([row.mode, row.extreme_limit_ms], ["extreme", 30_000]);
  const plain = randomUUID();
  await insertSolve(solve(plain));
  assert.equal((await allSolves()).find((r) => r.solve_id === plain)!.mode ?? "regular", "regular");
});

test("extremeWins: only completed extreme solves that beat their clock, live-site only", async () => {
  const before = (await extremeWins()).length;
  const win = randomUUID();
  await insertSolve({ ...solve(win), solve_ms: 12_000, mode: "extreme", extreme_limit_ms: 20_000 }); // margin 8 s
  await insertSolve({ ...solve(randomUUID()), solve_ms: 25_000, mode: "extreme", extreme_limit_ms: 20_000 }); // over the clock
  await insertSolve({ ...solve(randomUUID()), completed: false, mode: "extreme", extreme_limit_ms: 20_000 }); // timed out
  await insertSolve({ ...solve(randomUUID()), mode: "extreme", extreme_limit_ms: null }); // no clock recorded
  await insertSolve({ ...solve(randomUUID()), mode: "regular", extreme_limit_ms: 20_000 }); // regular never counts
  await insertSolve({ ...solve(randomUUID()), solve_ms: 1_000, mode: "extreme", extreme_limit_ms: 20_000, source: "demo" });
  const wins = await extremeWins();
  assert.equal(wins.length, before + 1);
  const row = (await allSolves()).find((r) => r.solve_id === win)!;
  assert.deepEqual(wins.find((w) => w.player_id === row.player_id), { player_id: row.player_id, margin_ms: 8_000 });
});

test("puzzleMedians: regular completed solves only, and only with 3+ solves", async () => {
  const mk = (puzzle_id: string, solve_ms: number, extra: object = {}) => ({ ...solve(randomUUID()), puzzle_id, solve_ms, ...extra });
  for (const ms of [10_000, 30_000, 20_000]) await insertSolve(mk("zip-median-a", ms));
  await insertSolve(mk("zip-median-a", 1_000, { mode: "extreme", extreme_limit_ms: 9_000 })); // extreme: ignored
  await insertSolve(mk("zip-median-a", 99_000, { completed: false })); // skipped: ignored
  for (const ms of [5_000, 6_000]) await insertSolve(mk("zip-median-b", ms)); // only 2: no crowd yet
  const m = await puzzleMedians();
  assert.deepEqual(m["zip-median-a"], { median_ms: 20_000, n: 3 });
  assert.equal(m["zip-median-b"], undefined);
});

test("players: only 60 brand-new nicknames per minute overall", async () => {
  let busy = 0;
  for (let i = 0; i < 70; i++) if ((await savePlayer(randomUUID(), `Fresh ${i}`)) === "busy") busy++;
  assert.ok(busy >= 8, `expected the cap to kick in, got ${busy} refusals`); // 3 players already exist from the test above
});
