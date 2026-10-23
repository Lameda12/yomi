import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FEATURE_INFO, featureEffects, improvementVerdict, labelPlain, parseHistory, sameCoefficients, sketchPuzzle, type HistoryEntry } from "../lib/learn.ts";
import { PUZZLE_FEATURES, parseModel, puzzleFeatures, type Geometry } from "../lib/predict.ts";

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const model = parseModel(read("../public/model.json"))!;
const history = parseHistory(read("../public/model_history.json"));
const puzzles = read("../data/puzzles.json") as (Geometry & { id: string; features: { max_gap: number; turns: number } })[];

test("every feature has plain-English text, and no em dashes", () => {
  assert.deepEqual(Object.keys(FEATURE_INFO).sort(), [...PUZZLE_FEATURES].sort());
  for (const f of Object.values(FEATURE_INFO)) for (const t of [f.title, f.plain, f.idea]) assert.ok(t.length > 4 && !/[—–]/.test(t), t);
});

test("the label is described as a stand-in unless it is human time", () => {
  assert.match(labelPlain("solver_effort").long, /not how long you take/);
  assert.match(labelPlain("human_time").long, /how long a player takes/);
});

test("the committed history parses fully and ends with the deployed model", () => {
  assert.ok(model && history.length >= 3);
  assert.equal(history[history.length - 1].version, model.version);
  assert.equal(history.length, (read("../public/model_history.json") as unknown[]).length, "no entry was dropped as malformed");
});

test("versions fitted only on solver steps share the same coefficients; the verdict says nothing was checked", () => {
  assert.ok(sameCoefficients(history));
  const v = improvementVerdict(history);
  assert.equal(v.kind, "unchecked");
  assert.match(v.text, /None of them has been checked on held-out data/);
});

test("improvementVerdict compares only held-out scores, with one, two and zero scored versions", () => {
  const e = (median_abs_pct_err: number | null): HistoryEntry => ({
    ...history[0],
    time: { ...history[0].time, eval: median_abs_pct_err === null ? { status: "not_run", reason: "x" } : { status: "scored", n_solves: 40, n_players: 4, metrics: { median_abs_pct_err } } },
  });
  assert.equal(improvementVerdict([e(null), e(0.3)]).kind, "single");
  const better = improvementVerdict([e(0.4), e(null), e(0.3)]);
  assert.equal(better.kind, "compared");
  assert.match(better.text, /30% for the latest scored version and 40% for the one before: lower \(better\)/);
  assert.match(improvementVerdict([e(0.3), e(0.45)]).text, /higher \(worse\)/);
  assert.match(improvementVerdict([e(0.3), e(0.3)]).text, /the same/);
});

test("parseHistory drops entries that do not match and never repairs them", () => {
  const good = read("../public/model_history.json")[0];
  assert.equal(parseHistory([good, { ...good, label: "magic" }, { ...good, time: null }, 5, null]).length, 1);
  assert.deepEqual(parseHistory({ not: "a list" }), []);
  assert.deepEqual(parseHistory(null), []);
  const noReason = { ...good, time: { ...good.time, eval: { status: "not_run" } } };
  assert.equal(parseHistory([noReason]).length, 0);
});

test("featureEffects scales each coefficient by how much that feature varies across the puzzles", () => {
  const table = puzzles.map((p) => puzzleFeatures(p));
  const effects = featureEffects(model, table);
  assert.equal(effects.length, PUZZLE_FEATURES.length);
  for (let i = 1; i < effects.length; i++) assert.ok(Math.abs(effects[i - 1].logEffect) >= Math.abs(effects[i].logEffect), "sorted by effect size");
  const by = Object.fromEntries(effects.map((e) => [e.feature, e]));
  assert.equal(by.solver_steps.used, false, "the solver-steps stand-in label does not use the solver-steps feature");
  assert.equal(by.solver_steps.multiplier, 1);
  const mean = table.reduce((a, t) => a + t.grid_size, 0) / table.length;
  const sd = Math.sqrt(table.reduce((a, t) => a + (t.grid_size - mean) ** 2, 0) / table.length);
  assert.ok(Math.abs(by.grid_size.spread - sd) < 1e-12);
  assert.ok(Math.abs(by.grid_size.multiplier - Math.exp(model.time.coef.grid_size * sd)) < 1e-12);
  assert.deepEqual(featureEffects(model, []), []);
});

test("the puzzle sketch agrees with the features stored for all 30 puzzles", () => {
  assert.equal(puzzles.length, 30);
  for (const p of puzzles) {
    const s = sketchPuzzle(p);
    assert.equal(s.turns.length, p.features.turns, `${p.id} turns`);
    assert.equal(s.longestGap.steps, p.features.max_gap, `${p.id} longest gap`);
    assert.equal(s.longestGap.path.length, s.longestGap.steps + 1);
    assert.equal(s.dots.length, p.dots.length);
  }
});
