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
const { allSolves, dropSnapshot, getNicknames, insertSolve, leaderboardSnapshot, predictedSolves, savePlayer, solveTotals } = await import("../lib/store.ts");
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

test("players: only 60 brand-new nicknames per minute overall", async () => {
  let busy = 0;
  for (let i = 0; i < 70; i++) if ((await savePlayer(randomUUID(), `Fresh ${i}`)) === "busy") busy++;
  assert.ok(busy >= 8, `expected the cap to kick in, got ${busy} refusals`); // 3 players already exist from the test above
});
