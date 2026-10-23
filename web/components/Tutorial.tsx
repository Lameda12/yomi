"use client";

import { useEffect, useRef, useState } from "react";
import {
  TUTORIAL_DOTS,
  TUTORIAL_N,
  TUTORIAL_STEPS,
  tutorialMove,
  tutorialSkipUndo,
  tutorialStage,
  tutorialStart,
  tutorialUndo,
} from "@/lib/tutorial";
import Link from "next/link";
import type { Cell } from "@/lib/zip";
import PathLine from "./PathLine";

const n = TUTORIAL_N;

// A 3x3 practice board in an overlay. It has its own state and never touches the network or the solve queue,
// so playing it creates no solve row. Skip is always one tap away.
export default function Tutorial({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState(tutorialStart);
  const board = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const stage = tutorialStage(state);
  const step = TUTORIAL_STEPS[stage];
  const onPath = new Set(state.path.map(([r, c]) => r * n + c));
  // Pulse the dot the current step asks for (CSS only, and only when motion is allowed).
  const hint = stage === 0 ? 2 : stage === 2 ? 3 : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cellAt = (e: React.PointerEvent): Cell | null => {
    const rect = board.current!.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    return r >= 0 && r < n && c >= 0 && c < n ? [r, c] : null;
  };

  const onDown = (e: React.PointerEvent) => {
    const cell = cellAt(e);
    if (!cell) return;
    e.preventDefault();
    try {
      board.current!.setPointerCapture(e.pointerId);
    } catch {}
    dragging.current = true;
    setState((s) => tutorialMove(s, cell));
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const cell = cellAt(e);
    if (cell) setState((s) => tutorialMove(s, cell));
  };

  const onUp = () => {
    dragging.current = false;
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="How to play" className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-background p-4" data-testid="tutorial">
      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between font-mono text-xs">
          <span className="opacity-70">How to play · {stage + 1}/{TUTORIAL_STEPS.length}</span>
          {stage < 3 && (
            <button onClick={onClose} className="min-h-11 px-3 underline" data-testid="tutorial-skip">
              Skip
            </button>
          )}
        </div>

        <div className="min-h-20 text-center" aria-live="polite">
          <p className="text-lg font-bold">{step.title}</p>
          <p className="text-sm opacity-80">{step.text}</p>
        </div>

        <div
          ref={board}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl border-2 border-foreground/80 bg-background"
          style={{ WebkitTouchCallout: "none" }}
          data-testid="tutorial-board"
        >
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
            {Array.from({ length: n * n }, (_, i) => (
              <div key={i} className={`border border-foreground/15 ${onPath.has(i) ? "bg-orange-400/25" : ""}`} />
            ))}
          </div>
          <svg viewBox={`0 0 ${n} ${n}`} className="pointer-events-none absolute inset-0 h-full w-full">
            <PathLine path={state.path} stroke={stage === 3 ? "#16a34a" : "#f97316"} />
            {TUTORIAL_DOTS.map(([r, c, v]) => (
              <g key={v}>
                {v === hint && <circle cx={c + 0.5} cy={r + 0.5} r={0.42} fill="none" stroke="#f97316" strokeWidth={0.07} className="motion-safe:animate-pulse" />}
                <circle cx={c + 0.5} cy={r + 0.5} r={0.3} className="fill-foreground" />
                {/* dy, not dominant-baseline: Safari ignores dominant-baseline and draws the digits too high in the dot */}
                <text x={c + 0.5} y={r + 0.5} fontSize={0.32} fontWeight={700} className="fill-background" textAnchor="middle" dy=".35em">
                  {v}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {stage === 3 ? (
          <button onClick={onClose} autoFocus className="min-h-11 w-full rounded-lg bg-orange-500 px-6 py-2 text-lg font-semibold text-white" data-testid="tutorial-done">
            Play a real puzzle
          </button>
        ) : (
          <div className="flex w-full gap-2">
            <button
              onClick={() => setState(tutorialUndo)}
              disabled={state.path.length <= 1}
              className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-30"
            >
              Undo
            </button>
            {stage === 1 && (
              <button onClick={() => setState(tutorialSkipUndo)} className="min-h-11 flex-1 rounded-lg bg-foreground px-4 py-2 text-background">
                Got it
              </button>
            )}
          </div>
        )}
        <p className="text-center text-xs opacity-70">
          Yomi saves your moves anonymously.{" "}
          <Link href="/what-we-store" className="underline">
            What we store
          </Link>
        </p>
      </div>
    </div>
  );
}
