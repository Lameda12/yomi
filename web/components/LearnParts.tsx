// Small server components for the "How Yomi learns" page. Each one draws something that exists in the data; none of them
// invents a number. They take plain values so they can be tested and reused.
import type { Effect, PuzzleSketch } from "@/lib/learn";
import { FEATURE_INFO } from "@/lib/learn";

/** A thin labelled progress bar: "have of need". */
export function Progress({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = Math.min(100, Math.round((100 * have) / need));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span>{label}</span>
        <span className="font-mono tabular-nums">
          {have} of {need}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(have, need)}>
        <div className="h-full bg-orange-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** One real puzzle, drawn so the feature names have something to point at. */
export function PuzzleDiagram({ sketch, n }: { sketch: PuzzleSketch; n: number }) {
  const cell = 36;
  const size = n * cell;
  const mid = (r: number, c: number) => [c * cell + cell / 2, r * cell + cell / 2] as const;
  const line = (cells: [number, number][]) => cells.map(([r, c]) => mid(r, c).join(",")).join(" ");
  return (
    <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} className="w-full max-w-[16rem]" role="img" aria-label={`Puzzle 1, a ${n} by ${n} grid with ${sketch.dots.length} dots and ${sketch.turns.length} turns in its answer path. The longest gap, ${sketch.longestGap.steps} steps, is between dots ${sketch.longestGap.from} and ${sketch.longestGap.to}.`}>
      <rect x="0" y="0" width={size} height={size} rx="6" className="fill-none stroke-foreground/25" />
      {Array.from({ length: n - 1 }, (_, i) => (
        <g key={i} className="stroke-foreground/10">
          <line x1={(i + 1) * cell} y1="0" x2={(i + 1) * cell} y2={size} />
          <line x1="0" y1={(i + 1) * cell} x2={size} y2={(i + 1) * cell} />
        </g>
      ))}
      <polyline points={line(sketch.path)} fill="none" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" className="stroke-foreground/25" />
      <polyline points={line(sketch.longestGap.path)} fill="none" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" className="stroke-orange-500" />
      {sketch.turns.map(([r, c]) => {
        const [x, y] = mid(r, c);
        return <circle key={`${r}-${c}`} cx={x} cy={y} r="8" fill="none" strokeWidth="1.5" className="stroke-foreground/60" />;
      })}
      {sketch.dots.map((d) => {
        const [x, y] = mid(d.r, d.c);
        return (
          <g key={d.label}>
            <circle cx={x} cy={y} r="11" className="fill-foreground" />
            <text x={x} y={y} dy=".35em" textAnchor="middle" fontSize="12" fontWeight="700" className="fill-background">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** How far each feature moves the guess across the real puzzles: bars for the ones the model uses, a note for the rest. */
export function EffectBars({ effects }: { effects: Effect[] }) {
  const max = Math.max(...effects.map((e) => Math.abs(e.logEffect)), 1e-9);
  return (
    <ul className="flex flex-col gap-3">
      {effects.map((e) => {
        const info = FEATURE_INFO[e.feature];
        return (
          <li key={e.feature} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{info.title}</span>
              {e.used ? (
                <span className="font-mono text-xs tabular-nums">
                  {e.logEffect >= 0 ? "×" : "÷"}
                  {(e.logEffect >= 0 ? e.multiplier : 1 / e.multiplier).toFixed(2)}
                </span>
              ) : (
                <span className="text-xs opacity-60">not used</span>
              )}
            </div>
            <div className="h-2 w-full rounded-full bg-foreground/10" aria-hidden>
              {e.used && <div className={`h-full rounded-full ${e.logEffect >= 0 ? "bg-orange-500" : "bg-foreground/60"}`} style={{ width: `${Math.max(2, (100 * Math.abs(e.logEffect)) / max)}%` }} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
