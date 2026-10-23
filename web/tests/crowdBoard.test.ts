import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP_LN, buildCrowdBoard, type CrowdSolve } from "../lib/crowdBoard.ts";

const s = (player_id: string, puzzle_id: string, solve_ms: number): CrowdSolve => ({ player_id, puzzle_id, solve_ms });
const none = new Map<string, string>();

/** 5 players on 3 puzzles. Everyone is near 10 s except "wild", who is 4x slower, 4x faster, then 4x slower. */
function crowd(): CrowdSolve[] {
  const rows: CrowdSolve[] = [];
  for (const p of ["a", "b", "c", "d"]) for (const pz of ["x", "y", "z"]) rows.push(s(p, pz, 10_000));
  rows.push(s("wild", "x", 40_000), s("wild", "y", 2_500), s("wild", "z", 40_000));
  return rows;
}

test("score is the mean |ln(actual / median of OTHER players)|; the biggest miss ranks first", () => {
  const { board } = buildCrowdBoard(crowd(), none);
  assert.equal(board[0].rank, 1);
  assert.ok(Math.abs(board[0].ratio - 4) < 1e-9, `wild is x4 off the crowd, got ${board[0].ratio}`);
  // the others sit at the crowd median except for being compared with a crowd that includes "wild": their median stays 10 s
  for (const r of board.slice(1)) assert.ok(Math.abs(r.ratio - 1) < 1e-9);
  assert.equal(board.length, 5);
});

test("the median is taken over other players only, never the player's own time", () => {
  // d's own 100 s must not drag the median it is judged against
  const rows = [s("a", "x", 10_000), s("b", "x", 10_000), s("c", "x", 10_000), s("d", "x", 100_000)];
  const more = ["y", "z"].flatMap((pz) => rows.map((r) => ({ ...r, puzzle_id: pz })));
  const board = buildCrowdBoard([...rows, ...more], none).board;
  const d = board.find((r) => r.ratio > 5)!;
  assert.ok(Math.abs(d.ratio - 10) < 1e-9, `d should be exactly x10 off, got ${d.ratio}`); // capped at ln(10) too
});

test("a puzzle needs 2+ other players' solves before it counts; players need 3 qualifying solves", () => {
  // 3 players on 3 puzzles: each solve has 2 others (a median of 2 is fine), so everyone qualifies: 3 players x 3 solves
  const three = ["x", "y", "z"].flatMap((pz) => ["a", "b", "c"].map((p) => s(p, pz, 10_000)));
  const r = buildCrowdBoard(three, none);
  assert.equal(r.board.length, 3);
  assert.deepEqual(r.progress, { players: 3, need: 3 });
  // only 2 players: each solve has just 1 other player, so nothing counts yet
  const two = ["x", "y", "z"].flatMap((pz) => ["a", "b"].map((p) => s(p, pz, 10_000)));
  const w = buildCrowdBoard(two, none);
  assert.equal(w.board.length, 0);
  assert.equal(w.progress.players, 2);
  // 3 players but only 2 puzzles: 2 qualifying solves each, below the 3 needed
  const short = ["x", "y"].flatMap((pz) => ["a", "b", "c"].map((p) => s(p, pz, 10_000)));
  assert.equal(buildCrowdBoard(short, none).board.length, 0);
});

test("the median of two other players is their average", () => {
  const rows = ["x", "y", "z"].flatMap((pz) => [s("a", pz, 10_000), s("b", pz, 30_000), s("me", pz, 20_000)]);
  // a is judged against median(30 s, 20 s) = 25 s -> x2.5; b against median(10 s, 20 s) = 15 s -> x2; me against 20 s -> x1
  const ratios = buildCrowdBoard(rows, none).board.map((r) => Math.round(r.ratio * 100) / 100);
  assert.deepEqual(ratios, [2.5, 2, 1]);
});

test("each solve counts at most x10 off, so walking away cannot buy the top spot", () => {
  const rows = crowd().filter((r) => r.player_id !== "wild");
  for (const pz of ["x", "y", "z"]) rows.push(s("afk", pz, 1_500_000));
  const board = buildCrowdBoard(rows, none).board;
  assert.ok(Math.abs(Math.log(board[0].ratio) - CAP_LN) < 1e-9);
});

test("bad numbers are ignored", () => {
  const rows = [...crowd(), s("wild", "x", 0), s("wild", "x", NaN), s("wild", "x", -5)];
  assert.equal(buildCrowdBoard(rows, none).board[0].solves, 3);
});

test("top 10 only, names are nickname or anonymous tag, no player_id leaks", () => {
  const rows: CrowdSolve[] = [];
  for (let p = 0; p < 14; p++) for (const pz of ["x", "y", "z"]) rows.push(s(`player-${p}`, pz, 10_000 + p * 1000));
  const { board } = buildCrowdBoard(rows, new Map([["player-13", "Nova"]]));
  assert.equal(board.length, 10);
  assert.ok(board.every((r) => /^Anon [0-9a-f]{4}$/.test(r.name) || r.name === "Nova"));
  for (const r of board) assert.deepEqual(Object.keys(r).sort(), ["id", "name", "rank", "ratio", "solves"]);
  assert.ok(!JSON.stringify(board).includes("player-"));
});

test("you: rank when qualified, played vs qualifying counts when not", () => {
  const rows = crowd();
  assert.deepEqual(
    (({ played, solves, rank }) => ({ played, solves, rank }))(buildCrowdBoard(rows, none, "wild").you!),
    { played: 3, solves: 3, rank: 1 },
  );
  const lonely = buildCrowdBoard([...rows, s("new", "q", 9_000)], none, "new").you!;
  assert.deepEqual([lonely.played, lonely.solves, lonely.rank, lonely.ratio], [1, 0, null, null]);
  assert.equal(buildCrowdBoard(rows, none).you, null);
});

test("progress counts players with 3+ solves, capped at 3", () => {
  assert.deepEqual(buildCrowdBoard([s("a", "x", 1000), s("a", "y", 1000)], none).progress, { players: 0, need: 3 });
  assert.equal(buildCrowdBoard(crowd(), none).progress.players, 3);
});
