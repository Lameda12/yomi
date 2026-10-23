import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Heatmap, PredictionScatter } from "@/components/StatsParts";
import { RATING_LABEL } from "@/lib/difficulty";
import { MIN_ATTEMPTS, MIN_HEAT_SOLVES, MIN_PLAYERS, dataStatus, feltVsModel, liveEvaluation, puzzleHeat } from "@/lib/insights";
import { loadModel, loadTimeInfo } from "@/lib/model";
import { PUZZLES } from "@/lib/puzzles";
import { allSolves, storageLabel } from "@/lib/store";

export const metadata: Metadata = {
  title: "What the data shows · Yomi",
  description: "Patterns across everyone's attempts, and how the model's guesses compare with what happened. Charts appear only when there is enough data.",
  robots: { index: false },
};

export default function StatsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            What the data <span className="text-orange-500">shows</span>
          </h1>
          <Link href="/" className="text-sm opacity-60 hover:opacity-100">
            ← play
          </Link>
        </div>
        <p className="text-sm">
          Patterns across everyone&apos;s attempts, with no names or IDs. A chart only appears when enough attempts stand behind it, and each one says how many that is. For
          your own attempts see <Link href="/you" className="underline">Your attempts</Link>; for how the model works see <Link href="/learn" className="underline">How Yomi learns</Link>.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm opacity-60">Loading…</p>}>
        <Stats />
      </Suspense>
    </main>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function Stats() {
  await connection(); // read solves fresh on every request
  const rows = await allSolves();
  const model = loadModel();
  const ids = new Set(PUZZLES.map((p) => p.id));
  const data = dataStatus(rows, ids);
  const steps = rows.filter((r) => r.pred_unit === "solver_steps").length;

  const heats = PUZZLES.map((p, i) => ({ p, num: i + 1, heat: puzzleHeat(rows, p.id) }));
  const ready = heats.filter((h) => h.heat.ready);
  const early = heats.filter((h) => h.heat.n > 0 && !h.heat.ready);
  const ev = model ? liveEvaluation(rows, model.version) : null;
  const scores = loadTimeInfo()?.logByPuzzle ?? null;
  const felt = scores ? feltVsModel(rows, scores) : null;

  return (
    <>
      <p className="text-sm">
        {data.attempts === 0 ? (
          <>
            Nothing is stored yet. <Link href="/" className="underline">Play a puzzle</Link> and come back.
          </>
        ) : (
          <>
            <b>{data.finished}</b> finished attempts from <b>{data.players}</b> {data.players === 1 ? "player" : "players"}, and <b>{data.attempts - data.finished}</b> skipped. Source:{" "}
            {storageLabel()}.
          </>
        )}
      </p>

      <section className="flex flex-col gap-3" aria-labelledby="stuck">
        <h2 id="stuck" className="text-lg font-semibold">
          Where players slow down
        </h2>
        <p className="text-sm">
          For each finished solve, Yomi notes the cell where the path was when the longest pause happened. A darker cell means more solves paused there. A puzzle needs {MIN_HEAT_SOLVES}{" "}
          finished solves before it is drawn, because with fewer a single dark cell is one person, not a pattern.
        </p>
        {ready.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {ready.map(({ p, num, heat }) => (
              <Heatmap key={p.id} n={p.n} dots={p.dots} heat={heat} title={`Puzzle ${num} · ${p.n}×${p.n}`} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-foreground/25 p-4 text-sm">No puzzle has {MIN_HEAT_SOLVES} finished solves yet, so there is no pattern to show.</p>
        )}
        {early.length > 0 && (
          <p className="text-xs opacity-70">
            Not enough yet: {early.map((h) => `puzzle ${h.num} (${h.heat.n})`).join(", ")}.
          </p>
        )}
        <p className="text-xs opacity-70">
          The stuck-spot model that would predict these is not trained yet, so there is nothing to compare the pattern with. When it exists, this is where the comparison goes.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="guess">
        <h2 id="guess" className="text-lg font-semibold">
          The model&apos;s guesses against what happened
        </h2>
        {!model || !ev ? (
          <p className="text-sm">The model file could not be read, so there are no guesses to compare.</p>
        ) : model.trained_on.label === "solver_effort" ? (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-foreground/25 p-4 text-sm">
            <p>
              <b>Nothing to compare yet.</b> The model in use predicts solver steps, which is not a time, so it cannot be set against how long people took.
              {steps > 0 && <> {steps} stored attempts carry such a guess.</>}
            </p>
            <p>
              This section switches on when a model that predicts time is in use. After that it needs {MIN_PLAYERS} players and {MIN_ATTEMPTS} first tries on that model version, and then
              shows each guess against the real time, with an &ldquo;always guess the typical time&rdquo; baseline next to it.
            </p>
          </div>
        ) : !ev.ready ? (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-foreground/25 p-4 text-sm">
            <p>
              <b>Not enough yet.</b> This model version has {ev.attempts} first tries from {ev.players} {ev.players === 1 ? "player" : "players"}. The chart appears with {ev.missing.join(" and ")}.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm">
              Each dot is one player&apos;s first try at a puzzle: the time Yomi guessed before they started, against the time they took. Dots near the dashed line were good guesses.
              Based on <b>{ev.attempts}</b> first tries from <b>{ev.players}</b> players, all guessed by version <code className="font-mono text-xs">{ev.version}</code>.
            </p>
            <PredictionScatter points={ev.points} />
            {ev.overall && (
              <table className="w-full max-w-md text-left text-sm tabular-nums">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 pr-3 font-normal"></th>
                    <th className="py-1 pr-3 font-normal">Median miss</th>
                    <th className="py-1 font-normal">Within 20%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-foreground/10">
                    <td className="py-1 pr-3">Yomi&apos;s guess</td>
                    <td className="py-1 pr-3">{pct(ev.overall.modelErr)}</td>
                    <td className="py-1">{pct(ev.overall.within20)}</td>
                  </tr>
                  <tr className="border-t border-foreground/10">
                    <td className="py-1 pr-3">Always the typical time</td>
                    <td className="py-1 pr-3">{pct(ev.overall.baselineErr)}</td>
                    <td className="py-1 opacity-60">n/a</td>
                  </tr>
                </tbody>
              </table>
            )}
            {ev.byGrid.length > 0 && (
              <>
                <h3 className="mt-2 text-sm font-semibold">Does it miss more on some board sizes?</h3>
                <table className="w-full max-w-md text-left text-sm tabular-nums">
                  <thead className="opacity-60">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Board</th>
                      <th className="py-1 pr-3 font-normal">First tries</th>
                      <th className="py-1 pr-3 font-normal">Median miss</th>
                      <th className="py-1 font-normal">Typical-time guess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ev.byGrid.map((g) => (
                      <tr key={g.grid} className="border-t border-foreground/10">
                        <td className="py-1 pr-3">{g.grid}×{g.grid}</td>
                        <td className="py-1 pr-3">{g.n}</td>
                        <td className="py-1 pr-3">{pct(g.modelErr)}</td>
                        <td className="py-1">{pct(g.baselineErr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs opacity-80">
              <li>These guesses were made before each solve, by a model that had not seen that solve, so this is a fair check of that version.</li>
              <li>Players saw the guess and may have tried to beat it, which can pull their times away from it. {ev.players} players is a small crowd: treat the shape as a hint.</li>
              <li>Only first tries count, because a second try at the same puzzle is practice.{ev.otherVersions > 0 && ` ${ev.otherVersions} first tries guessed by other versions are left out.`}</li>
              <li>The typical-time baseline uses the median of these same solves, which slightly favours the baseline.</li>
            </ul>
          </>
        )}
      </section>

      {felt && (
        <section className="flex flex-col gap-3" aria-labelledby="felt">
          <h2 id="felt" className="text-lg font-semibold">
            Does a hard puzzle feel hard?
          </h2>
          <p className="text-sm">
            After a finished solve, Yomi can ask &ldquo;How difficult did that puzzle feel?&rdquo; (easy, medium or hard). Here, each answer is set against how hard the model
            thinks the puzzles are. This is exploratory, and it does not train the model.
          </p>
          {felt.ready ? (
            <>
              <ul className="flex flex-col gap-3" aria-label="Average model difficulty of the puzzles given each answer">
                {felt.rows.map((r) => (
                  <li key={r.rating} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">Felt {RATING_LABEL[r.rating].toLowerCase()}</span>
                      <span className="text-xs opacity-70">{r.n} answers</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-foreground/10" aria-hidden>
                      <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, Math.round(r.meanPercentile))}%` }} />
                    </div>
                    <p className="text-xs opacity-70">On average these puzzles sit at the {Math.round(r.meanPercentile)}th percentile of the model&apos;s difficulty ranking (0 = easiest it knows, 100 = hardest).</p>
                  </li>
                ))}
              </ul>
              <p className="text-xs opacity-80">
                Based on {felt.answers} first tries from {felt.players} players. An answer is given after the solve, so it is shaped by how that solve went, and few players can
                make this look more or less aligned than it is.
              </p>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-foreground/25 p-4 text-sm">
              <b>Not enough answers yet.</b> {felt.answers} so far from {felt.players} {felt.players === 1 ? "player" : "players"}. This appears with {felt.missing.join(" and ")}.
            </p>
          )}
        </section>
      )}
    </>
  );
}
