// Run with --conditions=react-server so `import "server-only"` resolves (see npm test).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { clockLine, isShareId, predictionLine, resultLine, sharePath, shareMessage, toShared, type SharedSolve } from "../lib/share.ts";

const dir = mkdtempSync(path.join(tmpdir(), "yomi-share-"));
delete process.env.DATABASE_URL;
process.env.SOLVES_JSONL = path.join(dir, "solves.jsonl");
const { getSharedSolve, insertSolve, savePlayer } = await import("../lib/store.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

const base = (over: Partial<Parameters<typeof insertSolve>[0]> = {}) => ({
  solve_id: randomUUID(),
  player_id: randomUUID(),
  puzzle_id: "zip-5x5-01",
  grid_size: 5,
  n_dots: 13,
  device: "touch" as const,
  started_at_ms: 1,
  ended_at_ms: 3001,
  solve_ms: 3000,
  completed: true,
  events: [[0, 1, 4, 2]] as [number, number, number, number][],
  backtracks: 1,
  max_pause_ms: null,
  stuck_cell: null,
  played_zip_before: null,
  ...over,
});

const shared = (over: Partial<SharedSolve> = {}): SharedSolve => ({
  solve_id: randomUUID(),
  puzzle_id: "zip-5x5-01",
  grid_size: 5,
  solve_ms: 3000,
  backtracks: 1,
  mode: "regular",
  extreme_limit_ms: null,
  pred: null,
  name: "Anon 3f2a",
  ...over,
});

test("share ids must be UUIDs, and the path is /r/<id>", () => {
  const id = randomUUID();
  assert.equal(isShareId(id), true);
  assert.equal(sharePath(id), `/r/${id}`);
  for (const bad of ["", "abc", "../../etc/passwd", `${id}x`, `${id}/..`, "1234", id.replace(/-/g, "")]) assert.equal(isShareId(bad), false, bad);
});

test("toShared keeps only public fields", () => {
  const row = { ...base(), pred_value: 42_000, pred_unit: "ms" as const };
  const s = toShared(row, "Ada")!;
  assert.deepEqual(Object.keys(s).sort(), ["backtracks", "extreme_limit_ms", "grid_size", "mode", "name", "pred", "puzzle_id", "solve_id", "solve_ms"]);
  assert.equal(s.name, "Ada");
  assert.equal(JSON.stringify(s).includes(row.player_id), false, "no player id");
});

test("unfinished, id-less or zero-time solves are not shareable", () => {
  assert.equal(toShared({ ...base(), completed: false }, "x"), null);
  assert.equal(toShared({ ...base(), solve_id: null }, "x"), null);
  assert.equal(toShared({ ...base(), solve_ms: 0 }, "x"), null);
});

test("result line", () => {
  assert.equal(resultLine(shared()), "Anon 3f2a solved a 5×5 in 0:03 with 1 backtrack.");
  assert.equal(resultLine(shared({ backtracks: 0, mode: "extreme", grid_size: 6, solve_ms: 65_000 })), "Anon 3f2a solved a 6×6 on Extreme in 1:05 with 0 backtracks.");
});

test("prediction line: only a time prediction is compared with a time", () => {
  assert.equal(predictionLine(shared({ pred: { value: 72, unit: "solver_steps" } })), null, "solver steps are not a time");
  assert.equal(predictionLine(shared()), null);
  assert.equal(predictionLine(shared({ pred: { value: 10_000, unit: "ms" } })), "Yomi predicted 0:10. Beat it by 7s.");
  assert.equal(predictionLine(shared({ pred: { value: 1_000, unit: "ms" } })), "Yomi predicted 0:01. It was ahead by 2s.");
  assert.equal(predictionLine(shared({ pred: { value: 3_200, unit: "ms" } })), "Yomi predicted 0:03. Dead on.");
});

test("clock line only for an Extreme solve that beat its clock", () => {
  assert.equal(clockLine(shared()), null);
  assert.equal(clockLine(shared({ mode: "extreme", extreme_limit_ms: 60_000 })), "Beat the clock (1:00) by 0:57.");
  assert.equal(clockLine(shared({ mode: "extreme", extreme_limit_ms: null })), null);
});

test("share message has the link and no em dash", () => {
  const url = `https://yomi.example/r/${randomUUID()}`;
  const m = shareMessage("Yomi #2", 3000, 0, url);
  assert.ok(m.startsWith("Yomi #2: 0:03, 0 backtracks. Can you beat it? https://"));
  assert.ok(m.endsWith(url));
  assert.doesNotMatch(m, /[—–]/);
});

test("getSharedSolve returns a stored solve with an anonymous label, never the player id", async () => {
  const row = base({ pred_value: 42_000, pred_unit: "ms", model_version: "v" });
  assert.equal(await insertSolve(row), true);
  const s = (await getSharedSolve(row.solve_id))!;
  assert.equal(s.solve_ms, 3000);
  assert.equal(s.backtracks, 1);
  assert.match(s.name, /^Anon [0-9a-f]{4}$/);
  assert.equal(JSON.stringify(s).includes(row.player_id), false);
});

test("a nickname shows once the player set one", async () => {
  const row = base();
  await insertSolve(row);
  assert.equal(await savePlayer(row.player_id, "Ada"), "ok");
  assert.equal((await getSharedSolve(row.solve_id))!.name, "Ada");
});

test("unknown ids, malformed ids and unfinished solves give null", async () => {
  assert.equal(await getSharedSolve(randomUUID()), null);
  assert.equal(await getSharedSolve("not-a-uuid"), null);
  const abandoned = base({ completed: false });
  await insertSolve(abandoned);
  assert.equal(await getSharedSolve(abandoned.solve_id), null);
});
