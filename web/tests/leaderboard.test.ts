import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP_MS, MIN_SOLVES, TOP_N, anonName, buildBoard, rankPlayers, type ScoredSolve } from "../lib/leaderboard.ts";

const s = (player_id: string, solve_ms: number, pred_value: number): ScoredSolve => ({ player_id, solve_ms, pred_value });
const none = new Map<string, string>();

test("score is the average absolute error, biggest miss ranks first", () => {
  const rows: ScoredSolve[] = [
    s("calm", 10_000, 10_500), s("calm", 20_000, 19_000), s("calm", 15_000, 15_500), // 500, 1000, 500 -> 667
    s("wild", 30_000, 10_000), s("wild", 5_000, 12_000), s("wild", 9_000, 9_000), //   20000, 7000, 0 -> 9000
  ];
  const r = rankPlayers(rows, none);
  assert.deepEqual(r.map((x) => [x.player_id, x.avg_error_ms, x.solves, x.rank]), [
    ["wild", 9000, 3, 1],
    ["calm", 667, 3, 2],
  ]);
});

test("players need at least 3 counted solves", () => {
  assert.equal(MIN_SOLVES, 3);
  const two = [s("a", 1000, 5000), s("a", 1000, 5000)];
  assert.deepEqual(rankPlayers(two, none), []);
  assert.equal(rankPlayers([...two, s("a", 1000, 5000)], none).length, 1);
});

test("each solve counts at most CAP_MS off, so walking away cannot buy the top spot", () => {
  const r = rankPlayers([s("afk", 1_500_000, 10_000), s("afk", 1_500_000, 10_000), s("afk", 1_500_000, 10_000)], none);
  assert.equal(r[0].avg_error_ms, CAP_MS);
});

test("bad numbers are ignored instead of poisoning the average", () => {
  const rows = [s("a", 1000, 0), s("a", NaN, 1000), s("a", 1000, -5), s("a", 2000, 1000), s("a", 2000, 1000), s("a", 2000, 1000)];
  const r = rankPlayers(rows, none);
  assert.deepEqual([r[0].solves, r[0].avg_error_ms], [3, 1000]);
});

test("top 10 only, and the board never exposes a player_id", () => {
  const rows: ScoredSolve[] = [];
  for (let p = 0; p < 14; p++) for (let i = 0; i < 3; i++) rows.push(s(`player-${p}`, 10_000 + p * 1000, 10_000));
  const { board } = buildBoard(rows, none);
  assert.equal(board.length, TOP_N);
  assert.deepEqual(board.map((b) => b.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const b of board) assert.deepEqual(Object.keys(b).sort(), ["avg_error_ms", "id", "name", "rank", "solves"]);
  assert.ok(!JSON.stringify(board).includes("player-"));
  assert.equal(new Set(board.map((b) => b.id)).size, TOP_N); // ids are unique and stable
  assert.equal(buildBoard(rows, none).board[0].id, board[0].id);
});

test("names: nickname when set, a stable anonymous tag otherwise", () => {
  const rows = [s("p1", 9000, 1000), s("p1", 9000, 1000), s("p1", 9000, 1000), s("p2", 2000, 1000), s("p2", 2000, 1000), s("p2", 2000, 1000)];
  const { board } = buildBoard(rows, new Map([["p1", "Pathfinder"]]));
  assert.equal(board[0].name, "Pathfinder");
  assert.equal(board[1].name, anonName("p2"));
  assert.match(anonName("p2"), /^Anon [0-9a-f]{4}$/);
  assert.equal(anonName("p2"), anonName("p2"));
});

test("you: rank when qualified, how many more solves when not (rank counts everyone, not just the top 10)", () => {
  const rows: ScoredSolve[] = [];
  for (let p = 0; p < 12; p++) for (let i = 0; i < 3; i++) rows.push(s(`player-${p}`, 10_000 + p * 1000, 10_000));
  const { you } = buildBoard(rows, none, "player-0"); // smallest error of 12 players
  assert.equal(you?.rank, 12);
  assert.equal(you?.needed, 0);
  const newbie = buildBoard([...rows, s("new", 5000, 1000)], none, "new").you;
  assert.deepEqual([newbie?.rank, newbie?.solves, newbie?.needed], [null, 1, 2]);
  assert.equal(buildBoard(rows, none).you, null);
});
