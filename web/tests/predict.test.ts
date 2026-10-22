import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CELL_FEATURES,
  PUZZLE_FEATURES,
  cellFeatures,
  parseModel,
  puzzleFeatures,
  stuckScores,
  timeInfo,
  timeLog,
  timeValue,
  topStuck,
  type Model,
} from "../lib/predict.ts";
import type { Cell, Dot } from "../lib/zip.ts";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const V = read("../../ml/test_vectors.json");
const TOL = 1e-6;

interface Vector {
  id: string;
  n: number;
  dots: Dot[];
  solution: Cell[];
  puzzle_features: Record<string, number>;
  cells: { cell: Cell; features: Record<string, number> }[];
  predictions: { time_log: number; time_value: number; time_value_with_player: number; stuck_scores: number[]; stuck_top3: Cell[] };
}
const vectors: Vector[] = V.vectors;
const model = parseModel(V.parity_model) as Model;

const close = (got: number, want: number, what: string) =>
  assert.ok(Math.abs(got - want) <= TOL * Math.max(1, Math.abs(want)), `${what}: got ${got}, want ${want}`);

test("the parity fixture itself is a valid model", () => {
  assert.ok(model);
  assert.equal(vectors.length, 5);
});

test("puzzle features match Python within 1e-6 (incl. solver_steps from the TS solver)", () => {
  for (const v of vectors) {
    const got = puzzleFeatures(v);
    for (const f of PUZZLE_FEATURES) close(got[f], v.puzzle_features[f], `${v.id} ${f}`);
  }
});

test("cell features match Python within 1e-6, in solution order", () => {
  for (const v of vectors) {
    const rows = cellFeatures(v);
    assert.equal(rows.length, v.cells.length);
    rows.forEach((row, i) => {
      assert.deepEqual(row.cell, v.cells[i].cell);
      for (const f of CELL_FEATURES) close(row.features[f], v.cells[i].features[f], `${v.id} cell ${i} ${f}`);
    });
  }
});

test("time predictions match Python: log scale, no player, and with a player offset", () => {
  for (const v of vectors) {
    const z = timeLog(model, puzzleFeatures(v));
    close(z, v.predictions.time_log, `${v.id} time_log`);
    close(timeValue(z, model.players), v.predictions.time_value, `${v.id} time_value`);
    close(timeValue(z, model.players, "parity-player"), v.predictions.time_value_with_player, `${v.id} with player`);
    close(timeValue(z, model.players, "someone-new"), v.predictions.time_value, `${v.id} unseen player gets offset 0`);
  }
});

test("stuck scores and top 3 match Python", () => {
  for (const v of vectors) {
    const rows = cellFeatures(v);
    const scores = stuckScores(model, rows);
    assert.equal(scores.length, v.predictions.stuck_scores.length);
    scores.forEach((s, i) => close(s, v.predictions.stuck_scores[i], `${v.id} score ${i}`));
    assert.deepEqual(topStuck(model, rows), v.predictions.stuck_top3);
  }
});

test("an untrained stuck model (empty coef) predicts no cells instead of all-zero scores", () => {
  const untrained = parseModel({ ...V.parity_model, stuck: { intercept: 0, coef: {} } }) as Model;
  assert.ok(untrained);
  const rows = cellFeatures(vectors[0]);
  assert.deepEqual(stuckScores(untrained, rows), []);
  assert.deepEqual(topStuck(untrained, rows), []);
});

test("parseModel rejects anything that does not follow the contract", () => {
  const ok = V.parity_model;
  const bad: [string, unknown][] = [
    ["not an object", 42],
    ["null", null],
    ["missing version", { ...ok, version: undefined }],
    ["unknown label", { ...ok, trained_on: { human_solves: 1, label: "vibes" } }],
    ["feature order changed", { ...ok, puzzle_features: [...ok.puzzle_features].reverse() }],
    ["cell features changed", { ...ok, cell_features: ["is_edge"] }],
    ["missing time coef", { ...ok, time: { ...ok.time, coef: { grid_size: 1 } } }],
    ["non-finite time coef", { ...ok, time: { ...ok.time, coef: { ...ok.time.coef, turns: null } } }],
    ["non-numeric player offset", { ...ok, players: { a: "x" } }],
    ["partial stuck coef", { ...ok, stuck: { intercept: 0, coef: { is_edge: 1 } } }],
  ];
  for (const [name, raw] of bad) assert.equal(parseModel(raw), null, name);
});

test("the shipped web/public/model.json parses, and is honest about its label", () => {
  const shipped = parseModel(read("../public/model.json")) as Model;
  assert.ok(shipped, "model.json must satisfy the contract");
  if (shipped.trained_on.label === "solver_effort") assert.deepEqual(shipped.players, {});
});

test("timeInfo gives one log prediction per puzzle", () => {
  const info = timeInfo(model, vectors.map((v) => ({ id: v.id, n: v.n, dots: v.dots, solution: v.solution })));
  assert.deepEqual(Object.keys(info.logByPuzzle), vectors.map((v) => v.id));
  assert.equal(info.label, "human_time");
});
