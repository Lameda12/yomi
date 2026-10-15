import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CELL_FEATURES,
  PUZZLE_FEATURES,
  baseLogTime,
  cellFeatures,
  parseModel,
  predictTime,
  puzzleFeatures,
  solverSteps,
  stuckScores,
  stuckTop,
} from "../lib/predict.ts";

const TOL = 1e-6;
const vectors = JSON.parse(readFileSync(new URL("../../ml/test_vectors.json", import.meta.url), "utf8"));
const shipped = JSON.parse(readFileSync(new URL("../public/model.json", import.meta.url), "utf8"));

const close = (got: number, want: number, what: string) =>
  assert.ok(Math.abs(got - want) <= TOL, `${what}: got ${got}, want ${want}`);

test("test vector header matches the contract", () => {
  assert.deepEqual(vectors.puzzle_features, [...PUZZLE_FEATURES]);
  assert.deepEqual(vectors.cell_features, [...CELL_FEATURES]);
  assert.equal(vectors.vectors.length, 5);
});

const model = parseModel(vectors.model);

test("the test-vector model parses", () => {
  assert.ok(model);
  assert.ok(model.stuck);
});

for (const v of vectors.vectors) {
  test(`features match Python within 1e-6: ${v.id}`, () => {
    const pf = puzzleFeatures(v);
    for (const k of PUZZLE_FEATURES) close(pf[k], v.puzzle_features[k], `${v.id} ${k}`);
    const cells = cellFeatures(v);
    assert.deepEqual(cells.map((c) => c.cell), v.cells.map((c: { cell: number[] }) => c.cell));
    cells.forEach(({ features }, i) => {
      for (const k of CELL_FEATURES) close(features[k], v.cells[i].features[k], `${v.id} cell ${i} ${k}`);
    });
  });

  test(`predictions match Python within 1e-6: ${v.id}`, () => {
    close(baseLogTime(model!, puzzleFeatures(v)), v.time.log_value, `${v.id} log_value`);
    close(predictTime(model!, v), v.time.value, `${v.id} value`);
    close(predictTime(model!, v, vectors.player_id), v.time.value_for_player, `${v.id} value_for_player`);
    close(predictTime(model!, v, "someone-unknown"), v.time.value, `${v.id} unknown player gets no offset`);
    const scores = stuckScores(model!, v);
    assert.equal(scores.length, v.stuck.scores.length);
    scores.forEach(({ score }, i) => close(score, v.stuck.scores[i], `${v.id} stuck score ${i}`));
    assert.deepEqual(stuckTop(model!, v), v.stuck.top3);
  });
}

test("solver steps on the hand-traced 2x2 board (same as ml/test_features.py)", () => {
  assert.equal(solverSteps(2, [[0, 0, 1], [1, 0, 2]]), 7);
});

test("the shipped model.json parses; an empty stuck block means no stuck prediction", () => {
  const m = parseModel(shipped);
  assert.ok(m, "web/public/model.json does not follow the contract");
  if (Object.keys(shipped.stuck.coef).length === 0) {
    assert.equal(m.stuck, null);
    assert.deepEqual(stuckTop(m, vectors.vectors[0]), []);
  }
});

test("off-contract model.json is rejected instead of half-used", () => {
  assert.equal(parseModel(null), null);
  assert.equal(parseModel("nope"), null);
  assert.equal(parseModel({ ...vectors.model, trained_on: { human_solves: 0, label: "ms" } }), null);
  assert.equal(parseModel({ ...vectors.model, puzzle_features: [...PUZZLE_FEATURES].reverse() }), null);
  const partial = { ...vectors.model.time.coef };
  delete partial.grid_size;
  assert.equal(parseModel({ ...vectors.model, time: { ...vectors.model.time, coef: partial } }), null);
  assert.equal(parseModel({ ...vectors.model, stuck: { intercept: 0, coef: { is_edge: 1 } } }), null);
});
