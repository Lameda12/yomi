// Charts for "What the data shows". Both take already-aggregated values (no player ids) and draw only what they are
// given; the page decides whether there is enough data to show them at all.
import type { LivePoint, PuzzleHeat } from "@/lib/insights";

/** Where finished solves of one puzzle had their longest pause. Darker cell = more of them. Numbers are the dots. */
export function Heatmap({ n, dots, heat, title }: { n: number; dots: number[][]; heat: PuzzleHeat; title: string }) {
  const counts = Array.from({ length: n * n }, () => 0);
  for (const c of heat.cells) if (c.r >= 0 && c.r < n && c.c >= 0 && c.c < n) counts[c.r * n + c.c] = c.n;
  const max = Math.max(1, ...counts);
  const dotAt = new Map(dots.map(([r, c, v]) => [r * n + c, v]));
  return (
    <figure className="flex flex-col gap-1">
      <div className="grid gap-px rounded bg-foreground/10 p-px" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {counts.map((k, i) => (
          <div
            key={i}
            title={`${k} stuck here`}
            className="flex aspect-square items-center justify-center bg-background text-[10px] font-bold"
            style={k ? { backgroundColor: `rgb(249 115 22 / ${0.15 + 0.85 * (k / max)})` } : undefined}
          >
            {dotAt.get(i) ?? ""}
          </div>
        ))}
      </div>
      <figcaption className="text-xs opacity-70">
        {title} · {heat.n} solves, {heat.players} {heat.players === 1 ? "player" : "players"}
      </figcaption>
    </figure>
  );
}

const TICKS = [5, 10, 20, 30, 60, 120, 300, 600, 1200];
const clock = (s: number) => (s >= 60 ? `${s / 60}m` : `${s}s`);

/** The model's guess against the time people took, one dot per first try, on log axes so a 2x miss looks the same either way. */
export function PredictionScatter({ points }: { points: LivePoint[] }) {
  const W = 360, H = 300, L = 40, B = 34, T = 10, R = 12;
  const secs = points.flatMap((p) => [p.predicted_ms / 1000, p.actual_ms / 1000]);
  const lo = Math.min(...secs) * 0.8, hi = Math.max(...secs) * 1.25;
  const lg = (v: number) => (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  const x = (v: number) => L + lg(v) * (W - L - R);
  const y = (v: number) => H - B - lg(v) * (H - B - T);
  const ticks = TICKS.filter((t) => t >= lo && t <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label={`Predicted time against actual time for ${points.length} first tries. Dots on the diagonal line are perfect guesses.`}>
      {ticks.map((t) => (
        <g key={t} className="stroke-foreground/10">
          <line x1={x(t)} y1={T} x2={x(t)} y2={H - B} />
          <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} />
        </g>
      ))}
      <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} strokeDasharray="4 4" className="stroke-foreground/50" />
      {ticks.map((t) => (
        <g key={`l${t}`} className="fill-foreground text-[10px] opacity-60">
          <text x={x(t)} y={H - B + 13} textAnchor="middle">{clock(t)}</text>
          <text x={L - 5} y={y(t)} dy=".35em" textAnchor="end">{clock(t)}</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="fill-foreground text-[11px] opacity-70">what the model guessed</text>
      <text x={11} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 11 ${(T + H - B) / 2})`} className="fill-foreground text-[11px] opacity-70">what happened</text>
      {points.map((p, i) => (
        <circle key={i} cx={x(p.predicted_ms / 1000)} cy={y(p.actual_ms / 1000)} r="4" className="fill-orange-500/70" />
      ))}
    </svg>
  );
}
