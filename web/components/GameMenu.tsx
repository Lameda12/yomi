"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import ChangeName from "./ChangeName";

export interface MenuProps {
  onClose: () => void;
  puzzleLabel: string;
  solved: number;
  streak: { count: number; atRisk: boolean };
  mode: "regular" | "extreme";
  canChangeMode: boolean; // only before the first move
  onMode: (m: "regular" | "extreme") => void;
  onSkip: () => void;
  skipLabel: string;
  canSkip?: boolean; // not between sprint runs, when there is nothing to skip
  canHowTo: boolean; // not while a clock is running
  onHowTo: () => void;
}

// Everything that is not the grid, the prediction, the timer or undo/reset lives here, one tap away.
export default function GameMenu(p: MenuProps) {
  const close = useRef<HTMLButtonElement>(null);
  const { onClose } = p;

  useEffect(() => close.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = "flex min-h-11 w-full items-center justify-center rounded-lg border border-foreground/30 px-4 py-2 text-sm disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-background/80 p-4" onClick={p.onClose} data-testid="menu-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-foreground/20 bg-background p-4"
        data-testid="menu"
      >
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs opacity-70">
            {p.puzzleLabel} · {p.solved} solved
          </p>
          <button ref={close} onClick={p.onClose} className="min-h-11 px-3 underline">
            Close
          </button>
        </div>

        {p.streak.count > 0 && (
          <p className="rounded-full bg-orange-500/15 px-3 py-1 text-center font-mono text-xs text-orange-700 dark:text-orange-300">
            🔥 {p.streak.count}-day streak{p.streak.atRisk ? ". Solve one today to keep it" : ""}
          </p>
        )}

        <div role="group" aria-label="Game mode" className="flex w-full rounded-xl border border-foreground/20 p-1" data-testid="mode-toggle">
          {(["regular", "extreme"] as const).map((m) => (
            <button
              key={m}
              onClick={() => p.onMode(m)}
              aria-pressed={p.mode === m}
              disabled={!p.canChangeMode && p.mode !== m}
              className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize disabled:opacity-40 ${
                p.mode === m ? (m === "extreme" ? "bg-orange-500 text-white" : "bg-foreground text-background") : ""
              }`}
            >
              {m === "extreme" ? "Extreme ⚡" : "Regular"}
            </button>
          ))}
        </div>
        {!p.canChangeMode && <p className="text-center text-xs opacity-70">Mode can change before your first move, or after a run.</p>}

        {p.canSkip !== false && (
          <button onClick={p.onSkip} className={row}>
            {p.skipLabel}
          </button>
        )}
        <button onClick={p.onHowTo} disabled={!p.canHowTo} className={row}>
          How to play
        </button>
        <Link href="/you" className={row}>
          Your attempts
        </Link>
        <Link href="/stats" className={row}>
          What the data shows
        </Link>
        <Link href="/learn" className={row}>
          How Yomi learns
        </Link>
        <Link href="/what-we-store" className={row}>
          What we store
        </Link>
        <div className="flex justify-center">
          <ChangeName />
        </div>

        <p className="text-center text-xs opacity-70">
          Solves are logged anonymously (time and moves, no personal data) for a student ML project.
        </p>
      </div>
    </div>
  );
}
