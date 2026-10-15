import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PUZZLES } from "@/lib/puzzles";
import { allSolves, storageLabel, type SolveRow } from "@/lib/store";

export const metadata: Metadata = { title: "Yomi stats", robots: { index: false } };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)}s`);

export default function StatsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          Yomi <span className="text-orange-500">stats</span>
        </h1>
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← play
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm opacity-60">Loading solves…</p>}>
        <Stats />
      </Suspense>
    </main>
  );
}

async function Stats() {
  await connection(); // read solves fresh on every request
  const rows = await allSolves();
  const done = rows.filter((r) => r.completed);
  const players = new Set(rows.map((r) => r.player_id)).size;

  const byPuzzle = PUZZLES.map((p, i) => {
    const attempts = rows.filter((r) => r.puzzle_id === p.id);
    const solved = attempts.filter((r) => r.completed);
    return { p, num: i + 1, attempts, solved, median: median(solved.map((r) => r.solve_ms)) };
  }).filter((x) => x.attempts.length);

  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="solves" value={done.length} />
        <Tile label="skips" value={rows.length - done.length} />
        <Tile label="players" value={players} />
        <Tile label="median time" value={secs(median(done.map((r) => r.solve_ms)))} />
      </section>
      <p className="-mt-5 text-xs opacity-50">Source: {storageLabel()}</p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-current/20 p-6 text-center text-sm opacity-70">
          No solves yet. <Link href="/" className="underline">Play a puzzle</Link> and refresh.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Per puzzle</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 pr-4 font-normal">#</th>
                    <th className="py-1 pr-4 font-normal">puzzle</th>
                    <th className="py-1 pr-4 font-normal">attempts</th>
                    <th className="py-1 pr-4 font-normal">solved</th>
                    <th className="py-1 pr-4 font-normal">median time</th>
                    <th className="py-1 font-normal">mean backtracks</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {byPuzzle.map(({ p, num, attempts, solved, median: med }) => (
                    <tr key={p.id} className="border-t border-current/10">
                      <td className="py-1 pr-4">{num}</td>
                      <td className="py-1 pr-4 font-mono text-xs">{p.id}</td>
                      <td className="py-1 pr-4">{attempts.length}</td>
                      <td className="py-1 pr-4">{solved.length}</td>
                      <td className="py-1 pr-4">{secs(med)}</td>
                      <td className="py-1">
                        {(attempts.reduce((a, r) => a + r.backtracks, 0) / attempts.length).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Where people get stuck</h2>
            <p className="text-xs opacity-60">
              Darker cell = more often the path head during that attempt&apos;s longest pause. Numbers are dots.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {byPuzzle.map(({ p, num, attempts }) => (
                <Heatmap key={p.id} n={p.n} dots={p.dots} attempts={attempts} title={`#${num} · ${p.n}×${p.n}`} />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Backtracks vs time</h2>
            <Scatter rows={rows} />
          </section>
        </>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-current/15 p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs opacity-60">{label}</div>
    </div>
  );
}

function Heatmap({ n, dots, attempts, title }: { n: number; dots: number[][]; attempts: SolveRow[]; title: string }) {
  const counts = Array.from({ length: n * n }, () => 0);
  for (const r of attempts) {
    const c = r.stuck_cell;
    if (c && c[0] >= 0 && c[0] < n && c[1] >= 0 && c[1] < n) counts[c[0] * n + c[1]]++;
  }
  const max = Math.max(1, ...counts);
  const dotAt = new Map(dots.map(([r, c, v]) => [r * n + c, v]));
  return (
    <figure className="flex flex-col gap-1">
      <div className="grid gap-px rounded bg-current/10 p-px" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {counts.map((k, i) => (
          <div
            key={i}
            title={`${k} stuck`}
            className="flex aspect-square items-center justify-center bg-background text-[10px] font-bold"
            style={k ? { backgroundColor: `rgb(249 115 22 / ${0.15 + 0.85 * (k / max)})` } : undefined}
          >
            {dotAt.get(i) ?? ""}
          </div>
        ))}
      </div>
      <figcaption className="text-xs opacity-60">
        {title} · n={attempts.length}
      </figcaption>
    </figure>
  );
}

function Scatter({ rows }: { rows: SolveRow[] }) {
  const W = 560, H = 260, L = 44, B = 32, T = 10, R = 10;
  const maxX = Math.max(1, ...rows.map((r) => r.backtracks));
  const maxY = Math.max(1, ...rows.map((r) => r.solve_ms / 1000));
  const x = (v: number) => L + (v / maxX) * (W - L - R);
  const y = (v: number) => H - B - (v / maxY) * (H - B - T);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label="Backtracks against solve time">
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} className="stroke-current opacity-30" />
        <line x1={L} y1={T} x2={L} y2={H - B} className="stroke-current opacity-30" />
        <text x={L} y={H - B + 14} className="fill-current text-[10px] opacity-60">0</text>
        <text x={W - R} y={H - B + 14} textAnchor="end" className="fill-current text-[10px] opacity-60">{maxX}</text>
        <text x={(L + W) / 2} y={H - 4} textAnchor="middle" className="fill-current text-[11px] opacity-70">backtracks</text>
        <text x={L - 6} y={H - B} textAnchor="end" className="fill-current text-[10px] opacity-60">0s</text>
        <text x={L - 6} y={T + 8} textAnchor="end" className="fill-current text-[10px] opacity-60">{maxY.toFixed(0)}s</text>
        {rows.map((r) => (
          <circle
            key={r.id}
            cx={x(r.backtracks)}
            cy={y(r.solve_ms / 1000)}
            r={4}
            className={r.completed ? "fill-orange-500/70" : "fill-none stroke-current opacity-50"}
          >
            <title>{`${r.puzzle_id}: ${r.backtracks} backtracks, ${secs(r.solve_ms)}${r.completed ? "" : " (skipped)"}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex gap-4 text-xs opacity-60">
        <span><span className="inline-block size-2 rounded-full bg-orange-500/70" /> solved</span>
        <span><span className="inline-block size-2 rounded-full border border-current" /> skipped</span>
      </figcaption>
    </figure>
  );
}
