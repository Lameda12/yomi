import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EffectBars, Progress, PuzzleDiagram } from "@/components/LearnParts";
import { MIN_HUMAN_SOLVES, MIN_TRAIN_PLAYERS, dataStatus } from "@/lib/insights";
import { FEATURE_INFO, featureEffects, improvementVerdict, labelPlain, sameCoefficients, sketchPuzzle, type EvalEntry, type HistoryEntry } from "@/lib/learn";
import { loadHistory, loadModel, puzzleFeatureTable } from "@/lib/model";
import { PUZZLES } from "@/lib/puzzles";
import { PUZZLE_FEATURES } from "@/lib/predict";
import { allSolves } from "@/lib/store";

export const metadata: Metadata = {
  title: "How Yomi learns · Yomi",
  description: "What the model looks at, what it has learned so far, and how it is checked. No scores to beat, just what is known and what is not.",
};

export default function LearnPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            How Yomi <span className="text-orange-500">learns</span>
          </h1>
          <Link href="/" className="text-sm opacity-60 hover:opacity-100">
            ← play
          </Link>
        </div>
        <p className="text-sm">
          Yomi is an experiment in machine learning. Before each puzzle it guesses how hard the puzzle will be. You play, and your attempt becomes one more example for
          a later version of the model. This page shows where that loop stands today, including what is still unknown.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm opacity-60">Loading…</p>}>
        <Learn />
      </Suspense>
    </main>
  );
}

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Check({ e }: { e: EvalEntry }) {
  if (e.status === "not_run") {
    return (
      <>
        <b>Not run.</b> <span className="opacity-70">{e.reason}.</span>
      </>
    );
  }
  const m = e.metrics;
  return (
    <>
      Scored on {e.n_solves} held-out solves from {e.n_players} players.
      {m.median_abs_pct_err !== undefined && (
        <>
          {" "}
          Median error {pct(m.median_abs_pct_err)}
          {m.baseline_median_abs_pct_err !== undefined && <> against {pct(m.baseline_median_abs_pct_err)} for always guessing the average</>}.
        </>
      )}
    </>
  );
}

async function Learn() {
  await connection(); // counts are read fresh on every request
  const model = loadModel();
  const history = loadHistory();
  const table = puzzleFeatureTable();
  const rows = await allSolves();
  const ids = new Set(PUZZLES.map((p) => p.id));
  const data = dataStatus(rows, ids);
  const latest: HistoryEntry | undefined = history[history.length - 1];
  const label = model ? labelPlain(model.trained_on.label) : null;
  const effects = model && table ? featureEffects(model, table) : [];
  const first = PUZZLES[0];
  const sketch = first ? sketchPuzzle(first) : null;
  const sizes = [...new Set(PUZZLES.map((p) => p.n))].sort((a, b) => a - b);
  const verdict = improvementVerdict(history);

  return (
    <>
      <section className="flex flex-col gap-4" aria-labelledby="loop">
        <h2 id="loop" className="text-lg font-semibold">
          The loop, in four steps
        </h2>
        <ol className="flex flex-col gap-3">
          <li className="rounded-2xl border border-foreground/15 p-4">
            <p className="font-semibold">
              <span className="mr-2 font-mono text-orange-500">1</span>You play a puzzle
            </p>
            <p className="mt-1 text-sm">
              The server records your path and when each move happened, and works out your time, backtracks and longest pause itself. It does not record who you are.{" "}
              <Link href="/what-we-store" className="underline">
                Exactly what is stored
              </Link>
              .
            </p>
          </li>
          <li className="flex flex-col gap-3 rounded-2xl border border-foreground/15 p-4">
            <p className="font-semibold">
              <span className="mr-2 font-mono text-orange-500">2</span>Attempts are collected
            </p>
            <p className="text-sm">
              Right now {data.attempts === 0 ? "nothing is stored yet" : `${data.finished} finished ${data.finished === 1 ? "attempt is" : "attempts are"} stored from ${data.players} ${data.players === 1 ? "player" : "players"}`}.{" "}
              {data.trainable} {data.trainable === 1 ? "is" : "are"} usable for training: finished, in Regular mode, and not one of the early test plays. Learning from solve{" "}
              <i>time</i> starts once there are {MIN_HUMAN_SOLVES} usable solves from at least {MIN_TRAIN_PLAYERS} players.
            </p>
            <Progress label="Usable solves" have={data.trainable} need={MIN_HUMAN_SOLVES} />
            <Progress label="Players among them" have={data.trainablePlayers} need={MIN_TRAIN_PLAYERS} />
          </li>
          <li className="rounded-2xl border border-foreground/15 p-4">
            <p className="font-semibold">
              <span className="mr-2 font-mono text-orange-500">3</span>A person retrains the model, in a batch
            </p>
            <p className="mt-1 text-sm">
              Training is a manual step: someone runs a script on the stored solves. The model does <b>not</b> change while you play, and your solve is not used until the next
              run.
              {latest && (
                <>
                  {" "}
                  The last run was {fmtDate(latest.trained_at)} (version <code className="font-mono text-xs">{latest.version}</code>).
                </>
              )}
            </p>
          </li>
          <li className="rounded-2xl border border-foreground/15 p-4">
            <p className="font-semibold">
              <span className="mr-2 font-mono text-orange-500">4</span>We check what it got wrong
            </p>
            <p className="mt-1 text-sm">
              The check uses solves the model was not trained on, and compares its guesses with a plain baseline: always guessing the average. Without that comparison a number
              like &ldquo;off by 20%&rdquo; would mean nothing. Status of the last run: {latest ? <Check e={latest.time.eval} /> : <b>no run recorded.</b>}
            </p>
            <p className="mt-2 text-sm">
              Once there is enough data, <Link href="/stats" className="underline">What the data shows</Link> compares the live guesses with what happened.
            </p>
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="now">
        <h2 id="now" className="text-lg font-semibold">
          The model today
        </h2>
        {model && label ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-foreground/15 p-4 text-sm">
            <p>
              <b>{label.short}.</b> {label.long}
            </p>
            {model.trained_on.label === "solver_effort" ? (
              <p>
                It was fitted on the {PUZZLES.length} puzzles themselves (one example each), so <b>no one&apos;s solving time has shaped it yet</b>. More players will change
                the counts above, not this model, until it is retrained on enough real solves.
              </p>
            ) : (
              <p>
                It was trained on {model.trained_on.human_solves} real solves{latest ? ` from ${latest.players} players` : ""}.
              </p>
            )}
            <p className="text-xs opacity-70">Version {model.version}.</p>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-foreground/25 p-4 text-sm">The model file could not be read, so Yomi is not making predictions right now. The game still works.</p>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="features">
        <h2 id="features" className="text-lg font-semibold">
          What it looks at
        </h2>
        <p className="text-sm">
          The model never sees you, only the puzzle. It gets six numbers about the board. Here is puzzle 1
          {sketch && <>: {sketch.dots.length} dots, a longest gap of {sketch.longestGap.steps} steps (orange), and {sketch.turns.length} turns (rings)</>}.
        </p>
        {sketch && first && (
          <div className="flex justify-center">
            <PuzzleDiagram sketch={sketch} n={first.n} />
          </div>
        )}
        <dl className="flex flex-col gap-3">
          {PUZZLE_FEATURES.map((f) => (
            <div key={f} className="rounded-xl border border-foreground/15 p-3">
              <dt className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{FEATURE_INFO[f].title}</span>
                <code className="font-mono text-xs opacity-60">{f}</code>
              </dt>
              <dd className="mt-1 text-sm">{FEATURE_INFO[f].plain}</dd>
              <dd className="mt-1 text-xs opacity-70">The idea: {FEATURE_INFO[f].idea}</dd>
            </div>
          ))}
        </dl>
      </section>

      {model && effects.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="leans">
          <h2 id="leans" className="text-lg font-semibold">
            What it leans on
          </h2>
          <p className="text-sm">
            Each bar shows how much a typical difference between two of our puzzles in that feature moves the model&apos;s guess. &ldquo;×1.30&rdquo; means a 30% larger guess.
          </p>
          <EffectBars effects={effects} />
          <p className="rounded-xl bg-foreground/5 p-3 text-xs">
            Read this as &ldquo;what the model leans on&rdquo;, not &ldquo;what makes a puzzle hard&rdquo;. The features move together (in our puzzles, bigger boards have more turns and longer gaps), and the
            model was fitted on only {PUZZLES.length} puzzles, so it cannot tell them apart reliably.
            {model.trained_on.label === "solver_effort" && " The solver-effort feature is switched off while the label is solver steps, because it would be the answer itself."}
          </p>
          <details className="rounded-xl border border-foreground/15 p-3 text-sm">
            <summary className="cursor-pointer font-medium">The exact numbers</summary>
            <p className="mt-2 text-xs">
              A ridge regression (a straight-line fit with a small penalty so no number runs away) on the logarithm of the label. The guess is{" "}
              <code className="font-mono">exp(intercept + Σ coefficient × feature)</code>.
            </p>
            <table className="mt-2 w-full text-left text-xs tabular-nums">
              <thead className="opacity-60">
                <tr>
                  <th className="py-1 pr-3 font-normal">feature</th>
                  <th className="py-1 pr-3 font-normal">coefficient</th>
                  <th className="py-1 font-normal">spread across puzzles</th>
                </tr>
              </thead>
              <tbody>
                {effects.map((e) => (
                  <tr key={e.feature} className="border-t border-foreground/10">
                    <td className="py-1 pr-3 font-mono">{e.feature}</td>
                    <td className="py-1 pr-3">{e.coef.toFixed(4)}</td>
                    <td className="py-1">{e.spread.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs">
              Intercept {model.time.intercept.toFixed(4)}. Residual spread {model.time.residual_std.toFixed(3)} (in log units; it describes the fit on its own training data, so it
              says nothing about new puzzles).
            </p>
          </details>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="limits">
        <h2 id="limits" className="text-lg font-semibold">
          What it does not know yet
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {latest?.time.eval.status !== "scored" && <li>How accurate it is. No held-out check has been run, so there is no accuracy to report.</li>}
          {model?.trained_on.label === "solver_effort" && <li>How long people take. It predicts solver steps, so Yomi shows a relative read and not a time.</li>}
          <li>
            Puzzles beyond what it has seen: all {PUZZLES.length} are {sizes.map((n) => `${n}×${n}`).join(" or ")} boards.
          </li>
          {model && Object.keys(model.players).length === 0 && <li>Anything about individual players. It has no per-player adjustment yet.</li>}
          {latest && !latest.stuck.trained && (
            <li>
              Where you will get stuck. That model is not trained: it needs {MIN_HUMAN_SOLVES} usable solves and had {latest.stuck.solves ?? "none"}. Until then Yomi shows no stuck spots.
            </li>
          )}
          <li>
            Whether seeing the guess changes how people play. You see Yomi&apos;s guess before you start and may try to beat it. We do not measure how much that matters.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="versions">
        <h2 id="versions" className="text-lg font-semibold">
          Versions so far
        </h2>
        {history.length === 0 ? (
          <p className="text-sm opacity-70">No model versions are recorded.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 pr-4 font-normal">Date</th>
                    <th className="py-1 pr-4 font-normal">Learned from</th>
                    <th className="py-1 font-normal">Held-out check</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h) => (
                    <tr key={`${h.version}-${h.trained_at}`} className="border-t border-foreground/10 align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(h.trained_at)}</td>
                      <td className="py-2 pr-4">
                        {h.label === "human_time" ? "Solve times" : "Solver steps"}
                        <span className="block text-xs opacity-60">
                          {h.human_solves} human {h.human_solves === 1 ? "solve" : "solves"}, {h.players} {h.players === 1 ? "player" : "players"}
                        </span>
                      </td>
                      <td className="py-2 text-xs">
                        <Check e={h.time.eval} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm">{verdict.text}</p>
            {sameCoefficients(history) && (
              <p className="text-xs opacity-80">
                All {history.length} versions have the same coefficients. While the model learns from solver steps, which depend only on the puzzles, extra human solves change the
                counts above and not the model. That will change when it switches to solve times.
              </p>
            )}
            {history.some((h) => h.note) && (
              <details className="text-xs">
                <summary className="cursor-pointer opacity-80">Notes on each version</summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  {[...history].reverse().map((h) => (
                    <li key={h.version}>
                      <code className="font-mono">{h.version}</code>: {h.note || "No note."}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <p className="text-xs opacity-60">
        Questions about your own data: <Link href="/what-we-store" className="underline">what we store</Link>. Your own attempts: <Link href="/you" className="underline">Your attempts</Link>.
      </p>
    </>
  );
}
