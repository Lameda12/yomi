"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { peekPlayerId } from "@/lib/player";
import { exportJson, fmtClock, guessLine, sizeSummaries, tryNumbers, vsGuess, type Attempt, type Mine } from "@/lib/mine";
import PathReplay from "./PathReplay";

type State = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ok"; mine: Mine };

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function YourAttempts() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    const id = peekPlayerId();
    if (!id) {
      void Promise.resolve().then(() => alive && setState({ kind: "none" }));
      return () => {
        alive = false;
      };
    }
    fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ player_id: id }), cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Mine>;
      })
      .then((mine) => alive && setState(mine.total === 0 ? { kind: "none" } : { kind: "ok", mine }))
      .catch(() => alive && setState({ kind: "error" }));
    return () => {
      alive = false;
    };
  }, [tick]);

  if (state.kind === "loading") return <p className="text-sm opacity-60">Loading your attempts…</p>;
  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground/20 p-6 text-center text-sm">
        <p>Couldn&apos;t load your attempts.</p>
        <button onClick={retry} className="min-h-11 rounded-lg bg-foreground px-5 py-2 text-background">
          Try again
        </button>
      </div>
    );
  }
  if (state.kind === "none") {
    return (
      <p className="rounded-xl border border-dashed border-foreground/25 p-4 text-sm">
        Nothing here yet. Your attempts are tied to an anonymous ID kept in this browser, so play a puzzle first, and note that clearing site data or switching browsers starts you
        afresh. <Link href="/" className="underline">Play a puzzle</Link>
      </p>
    );
  }
  return <Loaded mine={state.mine} />;
}

function download(mine: Mine) {
  const blob = new Blob([exportJson(mine, new Date().toISOString())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-yomi-attempts.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Loaded({ mine }: { mine: Mine }) {
  const sizes = sizeSummaries(mine.attempts);
  const tries = tryNumbers(mine.attempts);
  const [open, setOpen] = useState<Attempt | null>(null);
  const anyGuess = mine.attempts.some((a) => vsGuess(a) !== null);
  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="sizes">
        <h2 id="sizes" className="text-lg font-semibold">
          By board size
        </h2>
        {sizes.length === 0 ? (
          <p className="text-sm opacity-70">No finished Regular solves yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sizes.map((s) => (
              <div key={s.grid} className="rounded-xl border border-foreground/15 p-3">
                <p className="text-sm font-semibold">
                  {s.grid}×{s.grid}
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {s.count} finished, best <b className="font-mono">{fmtClock(s.best)}</b>, typical <b className="font-mono">{fmtClock(s.median)}</b>
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs opacity-70">Sizes are kept apart because a 6×6 is not a slower 5×5. Sprint runs are not counted: they are played against a clock.</p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="list">
        <h2 id="list" className="text-lg font-semibold">
          Your attempts
        </h2>
        {mine.total > mine.attempts.length && <p className="text-xs opacity-70">Showing your latest {mine.attempts.length} of {mine.total}.</p>}
        <ul className="flex flex-col gap-2">
          {mine.attempts.map((a, i) => {
            const puzzle = mine.puzzles[a.puzzle_id];
            const line = vsGuess(a) ? guessLine(a) : null;
            const isOpen = open === a;
            return (
              <li key={a.solve_id ?? i} className="rounded-xl border border-foreground/15 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    Puzzle {a.puzzle_number ?? "?"} · {a.grid_size}×{a.grid_size}
                    {a.mode === "extreme" && <span className="ml-2 rounded bg-orange-500/20 px-1.5 text-xs font-medium">sprint</span>}
                  </span>
                  <span className="text-xs opacity-60">{when(a.created_at)}</span>
                </div>
                <p className="mt-1">
                  {a.completed ? (
                    <>
                      <span className="font-mono font-semibold">{fmtClock(a.solve_ms)}</span>
                      {a.backtracks > 0 ? `, ${a.backtracks} ${a.backtracks === 1 ? "backtrack" : "backtracks"}` : ", no backtracks"}
                      {a.max_pause_ms ? `, longest pause ${Math.round(a.max_pause_ms / 1000)} s` : ""}
                    </>
                  ) : (
                    "Skipped or not finished"
                  )}
                  <span className="text-xs opacity-60"> · try {tries.get(a)}{(tries.get(a) ?? 1) > 1 ? " at this puzzle" : ""}</span>
                </p>
                {line && <p className="mt-1 text-xs opacity-80">{line}</p>}
                {puzzle && a.events.length > 1 && (
                  <>
                    <button onClick={() => setOpen(isOpen ? null : a)} aria-expanded={isOpen} className="mt-2 min-h-11 rounded-lg border border-foreground/30 px-3 text-xs">
                      {isOpen ? "Hide replay" : "Replay"}
                    </button>
                    {isOpen && (
                      <div className="mt-2">
                        <PathReplay puzzle={puzzle} attempt={a} />
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {!anyGuess && <p className="text-xs opacity-70">There is no guess-versus-time comparison yet: so far Yomi guesses in solver steps, which is not a time.</p>}
        <p className="text-xs opacity-70">
          &ldquo;Try 2&rdquo; means your second go at the same puzzle. Repeat tries are usually faster because you remember the route, so the accuracy check on What the data shows counts only first tries.
        </p>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="mine">
        <h2 id="mine" className="text-lg font-semibold">
          Your data
        </h2>
        <p className="text-sm">
          This page reads your own attempts from the server using the anonymous ID in this browser. Nobody else&apos;s attempts are shown. You can download exactly what is shown
          (your moves included).
        </p>
        <button onClick={() => download(mine)} className="min-h-11 self-start rounded-lg bg-foreground px-5 py-2 text-sm text-background">
          Download my attempts
        </button>
        <p className="text-xs opacity-70">
          <Link href="/what-we-store" className="underline">What we store</Link> lists every field. There is no button yet to delete saved attempts.
        </p>
      </section>
    </>
  );
}
