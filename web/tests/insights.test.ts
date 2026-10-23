import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EXCLUDED_ROW_ID_MAX, MIN_ATTEMPTS, MIN_HEAT_SOLVES, MIN_HUMAN_SOLVES, MIN_PLAYERS,
  dataStatus, feltVsModel, isTrainable, liveEvaluation, median, puzzleHeat,
} from "../lib/insights.ts";
import type { SolveRow } from "../lib/store.ts";

let nextId = 100;
const row = (o: Partial<SolveRow> = {}): SolveRow => ({
  id: nextId++, solve_id: `s${nextId}`, created_at: "2026-10-23T00:00:00Z", player_id: "p1", puzzle_id: "zip-5x5-01", grid_size: 5, n_dots: 13,
  device: "mouse", started_at_ms: 0, ended_at_ms: 20_000, solve_ms: 20_000, completed: true, events: [], backtracks: 0, max_pause_ms: null,
  stuck_cell: null, played_zip_before: null, ...o,
});
const IDS = new Set(["zip-5x5-01", "zip-5x5-02", "zip-6x6-01"]);

test("the thresholds mirror the Python training script", () => {
  const py = readFileSync(new URL("../../ml/train_time.py", import.meta.url), "utf8");
  assert.equal(Number(py.match(/^MIN_HUMAN_SOLVES = (\d+)/m)?.[1]), MIN_HUMAN_SOLVES);
  assert.match(py, new RegExp(`EXCLUDED_ROW_IDS = frozenset\\(str\\(i\\) for i in range\\(1, ${EXCLUDED_ROW_ID_MAX + 1}\\)\\)`));
});

test("isTrainable follows the training filter: finished, timed, regular, known puzzle, not an early test row", () => {
  assert.ok(isTrainable(row(), IDS));
  assert.ok(isTrainable(row({ mode: undefined }), IDS), "rows without a mode are regular");
  assert.ok(!isTrainable(row({ completed: false }), IDS));
  assert.ok(!isTrainable(row({ solve_ms: 0 }), IDS));
  assert.ok(!isTrainable(row({ solve_ms: NaN }), IDS));
  assert.ok(!isTrainable(row({ mode: "extreme" }), IDS));
  assert.ok(!isTrainable(row({ puzzle_id: "zip-unknown" }), IDS));
  assert.ok(!isTrainable(row({ id: 8 }), IDS));
  assert.ok(isTrainable(row({ id: 9 }), IDS));
  assert.ok(isTrainable(row({ source: "demo" }), IDS), "demo volunteers are real people and training keeps them");
});

test("dataStatus counts what the next training run would use and what is still short", () => {
  const rows = [row({ player_id: "a" }), row({ player_id: "a" }), row({ completed: false, player_id: "b" }), row({ mode: "extreme", player_id: "c" })];
  const s = dataStatus(rows, IDS);
  assert.deepEqual(
    [s.attempts, s.finished, s.players, s.trainable, s.trainablePlayers, s.needed, s.neededPlayers],
    [4, 3, 3, 2, 1, MIN_HUMAN_SOLVES - 2, 1],
  );
  assert.equal(dataStatus([], IDS).needed, MIN_HUMAN_SOLVES);
  const enough = Array.from({ length: 40 }, (_, i) => row({ player_id: `p${i % 4}` }));
  assert.deepEqual([dataStatus(enough, IDS).needed, dataStatus(enough, IDS).neededPlayers], [0, 0]);
});

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

const predicted = (player: number, puzzle: number, actual: number, pred: number, o: Partial<SolveRow> = {}) =>
  row({ player_id: `p${player}`, puzzle_id: `zip-${puzzle}`, solve_ms: actual, pred_value: pred, pred_unit: "ms", model_version: "v2", ...o });

test("liveEvaluation: a solver-steps model has no times to check, so nothing is ready", () => {
  const rows = Array.from({ length: 40 }, (_, i) => row({ player_id: `p${i % 8}`, puzzle_id: `zip-${i}`, pred_value: 70, pred_unit: "solver_steps", model_version: "v1" }));
  const e = liveEvaluation(rows, "v1");
  assert.equal(e.attempts, 0);
  assert.equal(e.ready, false);
  assert.equal(e.points.length, 0);
  assert.equal(e.overall, null);
});

test("liveEvaluation: below the thresholds it lists what is missing and returns no points", () => {
  const rows = Array.from({ length: 7 }, (_, i) => predicted(1, i, 20_000, 25_000));
  const e = liveEvaluation(rows, "v2");
  assert.equal(e.ready, false);
  assert.deepEqual(e.missing, [`${MIN_PLAYERS - 1} more players (1 so far)`, `${MIN_ATTEMPTS - 7} more first tries (7 so far)`]);
  assert.deepEqual([e.points.length, e.byGrid.length, e.overall], [0, 0, null]);
});

test("liveEvaluation: only a player's first try at a puzzle counts, and only the named version", () => {
  const rows = [
    predicted(1, 1, 30_000, 25_000, { id: 1000 }),
    predicted(1, 1, 10_000, 25_000, { id: 1001 }), // second try: practice, left out
    predicted(2, 1, 20_000, 25_000, { model_version: "v1" }), // other version
    predicted(3, 1, 20_000, 25_000, { completed: false }),
    predicted(4, 1, 20_000, 25_000, { mode: "extreme" }),
  ];
  const e = liveEvaluation(rows, "v2", 1, 1);
  assert.deepEqual([e.attempts, e.players, e.otherVersions], [1, 1, 1]);
  assert.equal(e.points[0].actual_ms, 30_000);
});

test("liveEvaluation: when ready, errors are medians against an always-guess-the-typical-time baseline", () => {
  const rows: SolveRow[] = [];
  for (let p = 0; p < MIN_PLAYERS; p++) for (let q = 0; q < 4; q++) rows.push(predicted(p, q, 20_000 + q * 10_000, 20_000 + q * 10_000)); // perfect guesses
  const e = liveEvaluation(rows, "v2");
  assert.ok(e.ready && e.missing.length === 0);
  assert.equal(e.points.length, 20);
  assert.equal(e.overall!.modelErr, 0);
  assert.equal(e.overall!.within20, 1);
  assert.ok(e.overall!.baselineErr > 0.2, "the typical-time guess misses the very short and very long puzzles");
  assert.deepEqual(e.byGrid.map((g) => [g.grid, g.n]), [[5, 20]]);
  assert.ok(!JSON.stringify(e).includes('"p0"'), "no player id in the result");
});

test("liveEvaluation: a grid size with too few attempts is not broken out", () => {
  const rows: SolveRow[] = [];
  for (let p = 0; p < MIN_PLAYERS; p++) for (let q = 0; q < 4; q++) rows.push(predicted(p, q, 20_000, 22_000, { grid_size: q === 0 && p < 2 ? 6 : 5 }));
  const e = liveEvaluation(rows, "v2");
  assert.deepEqual(e.byGrid.map((g) => g.grid), [5], "only 2 attempts on 6x6");
});

test("puzzleHeat: counts finished Regular solves with a recorded pause, and is ready only from MIN_HEAT_SOLVES", () => {
  const rows = [
    row({ stuck_cell: [2, 3], player_id: "a" }), row({ stuck_cell: [2, 3], player_id: "b" }), row({ stuck_cell: [0, 1], player_id: "b" }),
    row({ stuck_cell: [1, 1], completed: false }), row({ stuck_cell: null }), row({ stuck_cell: [4, 4], mode: "extreme" }),
    row({ stuck_cell: [2, 3], puzzle_id: "zip-other" }),
  ];
  const h = puzzleHeat(rows, "zip-5x5-01");
  assert.deepEqual([h.n, h.players, h.ready, h.cells.length], [3, 2, false, 2]);
  assert.deepEqual(h.cells.find((c) => c.r === 2 && c.c === 3), { r: 2, c: 3, n: 2 });
  const more = [...rows, ...Array.from({ length: MIN_HEAT_SOLVES }, () => row({ stuck_cell: [1, 2] }))];
  assert.equal(puzzleHeat(more, "zip-5x5-01").ready, true);
  assert.ok(!JSON.stringify(h).includes('"a"') && !JSON.stringify(h).includes('"b"'), "no player id in the result");
});

test("feltVsModel: needs enough players and answers, and returns no rows until then", () => {
  const scores = { "zip-a": 1, "zip-b": 2, "zip-c": 3 };
  const few = [row({ puzzle_id: "zip-a", perceived_difficulty: "easy" }), row({ puzzle_id: "zip-b", perceived_difficulty: "hard" })];
  const f = feltVsModel(few, scores);
  assert.equal(f.ready, false);
  assert.deepEqual(f.rows, []);
  assert.equal(f.answers, 2);
  assert.match(f.missing.join(" "), /more players/);
});

test("feltVsModel: percentile of the puzzles given each answer, first tries only, ignoring skipped answers and sprints", () => {
  const scores = { "zip-a": 10, "zip-b": 20, "zip-c": 30 }; // a easiest, c hardest
  const rows = [];
  for (let p = 0; p < 6; p++) {
    rows.push(row({ player_id: `p${p}`, puzzle_id: "zip-a", perceived_difficulty: "easy" }));
    rows.push(row({ player_id: `p${p}`, puzzle_id: "zip-c", perceived_difficulty: "hard" }));
    rows.push(row({ player_id: `p${p}`, puzzle_id: "zip-b", perceived_difficulty: "medium" }));
  }
  rows.push(row({ player_id: "p0", puzzle_id: "zip-a", perceived_difficulty: "hard" })); // a second try: ignored
  rows.push(row({ player_id: "p1", puzzle_id: "zip-c", perceived_difficulty: null }));
  rows.push(row({ player_id: "p9", puzzle_id: "zip-c", perceived_difficulty: "easy", mode: "extreme" }));
  rows.push(row({ player_id: "p9", puzzle_id: "zip-unknown", perceived_difficulty: "easy" }));
  const f = feltVsModel(rows, scores, 5, 18);
  assert.equal(f.ready, true);
  assert.deepEqual(f.rows.map((r) => [r.rating, r.n, r.meanPercentile]), [["easy", 6, 0], ["medium", 6, 50], ["hard", 6, 100]]);
  assert.ok(!JSON.stringify(f).includes('"p0"'));
});
