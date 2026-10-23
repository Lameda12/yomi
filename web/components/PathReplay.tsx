"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClock, type Attempt, type MinePuzzle } from "@/lib/mine";
import { replay, type ReplayStep } from "@/lib/replay";

const CELL = 34;
const WATCH_MS = 10_000; // a long attempt is played faster so the whole replay takes at most about this long

/** Your own attempt, drawn again from the moves that were stored: press play or drag the slider. Nothing is sent anywhere. */
export default function PathReplay({ puzzle, attempt }: { puzzle: MinePuzzle; attempt: Attempt }) {
  const steps = useMemo(() => {
    const out: ReplayStep[] = [];
    return replay(puzzle.n, puzzle.dots, attempt.events, out) ? out : null;
  }, [puzzle, attempt.events]);
  const total = steps ? steps[steps.length - 1].t : 0;
  const [at, setAt] = useState(total); // start at the end: the finished path
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing || !steps) return;
    const rate = Math.max(1, total / WATCH_MS);
    let last = performance.now();
    let pos = at >= total ? 0 : at;
    const frame = (now: number) => {
      pos = Math.min(total, pos + (now - last) * rate);
      last = now;
      setAt(pos);
      if (pos >= total) setPlaying(false);
      else raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
    // `at` is read once when playback starts; later frames carry their own position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, steps, total]);

  if (!steps || total <= 0) return <p className="text-xs opacity-70">This attempt has too few moves to replay.</p>;

  const step = [...steps].reverse().find((s) => s.t <= at) ?? steps[0];
  const { n, dots } = puzzle;
  const size = n * CELL;
  const mid = ([r, c]: [number, number]) => `${c * CELL + CELL / 2},${r * CELL + CELL / 2}`;
  const stuck = attempt.stuck_cell;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox={`-3 -3 ${size + 6} ${size + 6}`} className="w-full max-w-[14rem]" role="img" aria-label={`Replay of your attempt at ${fmtClock(at)} of ${fmtClock(total)}`}>
        <rect x="0" y="0" width={size} height={size} rx="5" className="fill-none stroke-foreground/25" />
        {Array.from({ length: n - 1 }, (_, i) => (
          <g key={i} className="stroke-foreground/10">
            <line x1={(i + 1) * CELL} y1="0" x2={(i + 1) * CELL} y2={size} />
            <line x1="0" y1={(i + 1) * CELL} x2={size} y2={(i + 1) * CELL} />
          </g>
        ))}
        <polyline points={step.path.map(mid).join(" ")} fill="none" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" className="stroke-orange-500" />
        {stuck && (
          <circle cx={stuck[1] * CELL + CELL / 2} cy={stuck[0] * CELL + CELL / 2} r="14" fill="none" strokeWidth="2" strokeDasharray="4 3" className="stroke-rose-500" />
        )}
        {dots.map(([r, c, v]) => (
          <g key={v}>
            <circle cx={c * CELL + CELL / 2} cy={r * CELL + CELL / 2} r="10" className="fill-foreground" />
            <text x={c * CELL + CELL / 2} y={r * CELL + CELL / 2} dy=".35em" textAnchor="middle" fontSize="11" fontWeight="700" className="fill-background">
              {v}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex w-full max-w-[14rem] items-center gap-2">
        <button onClick={() => setPlaying((p) => !p)} className="min-h-11 min-w-16 rounded-lg border border-foreground/30 px-3 text-sm">
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={50}
          value={Math.min(at, total)}
          onChange={(e) => {
            setPlaying(false);
            setAt(Number(e.target.value));
          }}
          aria-label="Replay position"
          className="min-h-11 flex-1"
        />
      </div>
      <p className="text-xs opacity-70">
        {fmtClock(at)} of {fmtClock(total)}
        {stuck && <> · dashed ring: where you paused longest</>}
      </p>
    </div>
  );
}
