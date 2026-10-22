# Sprint 2 model report

Generated 2026-10-22 by `python -m ml.pipeline`. Numbers below are what the data gave; none are rounded up.

## Data

- Source: `jsonl`. Rows read: 15.
- Used for training: completed solves from real humans only, minus the 8 early test rows (ids 1-8). That left **7 solves from 1 player(s)**.
- Time-model label: **`solver_effort`**. This is the stand-in: the output is solver search steps, not time.
- Average solution-path length is about 30 cells, so a random pick of 3 cells hits the stuck cell about 10% of the time.


## Time model

- Label: `solver_effort`. Predictions are in solver steps, **not milliseconds**.
- Fitted on 30 rows. Human solves counted: 7 from 1 player(s).
- Why not human time: the rule is 30+ completed human solves; this run has 7. So the model learns "how hard will the solver find it" from the puzzle features, one row per puzzle. It has no player offsets (`players` is empty).
- Coefficients (raw scale, on `log` of the label):

  - `grid_size`: +0.5324
  - `n_dots`: +0.0153
  - `max_gap`: +0.0893
  - `mean_gap`: +1.9298
  - `turns`: +0.1005
  - `solver_steps`: +0.0000
  - intercept: -4.4000, residual std: 0.687 (log units)

### Evaluation (leave-one-player-out)

**Not run.** leave-one-player-out needs 2+ players, have 1.

No accuracy number is claimed. There is no "within 20%" or percent-error result for this model, and no comparison against the mean-time baseline.

## Stuck-point model

- **Not trained.** The rule is 30+ usable solves; this run has 7 (0 more were dropped because the stuck cell was missing or off the solution path).
- `model.json` keeps `stuck: {intercept: 0, coef: {}}`, which the app reads as "no stuck prediction". It shows no stuck cells until a model exists.

### Evaluation (leave-one-player-out, top 3 cells)

**Not run.** leave-one-player-out needs 2+ players, have 1.

No hit rate is claimed. The form target is 60%; we have no measurement against it and no comparison against the random-3-cells baseline.

## What this means

- The deployed model is the solver-effort fallback. The honest way to describe it is "predicts how hard it'll be", not "predicts your time".
- Both evaluations need real data we do not have yet: 30+ completed human solves from 2+ players (and for the time model, 30+ in each training fold). The code for both is written and unit-tested on synthetic data, and those synthetic tests are not results.
- Next: run `python -m ml.pipeline --source neon` once the live site has collected solves. It overwrites `web/public/model.json` and this file.
