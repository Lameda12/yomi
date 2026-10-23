"use client";

import { useCallback, useEffect, useState } from "react";
import { useLivePoll } from "@/lib/useLivePoll";
import type { TimeInfo } from "@/lib/predict";
import ZipGame, { type PublicPuzzle } from "./ZipGame";

const CACHE_KEY = "yomi_demo_stats"; // last totals this screen saw, so the counters survive a slow or dead database

interface Stats {
  solves: number | null;
  players: number | null;
  stale: boolean; // true = these are remembered numbers, not fresh ones
}

function readCache(): Stats {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (v && Number.isFinite(v.solves) && Number.isFinite(v.players)) return { solves: v.solves, players: v.players, stale: true };
  } catch {}
  return { solves: null, players: null, stale: true };
}

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-foreground/20 px-6 py-1">
      <span className="font-mono text-4xl font-bold tabular-nums" data-testid={`count-${label}`}>
        {value ?? "–"}
      </span>
      <span className="text-sm uppercase tracking-widest opacity-60">{label}</span>
    </div>
  );
}

/** Projector screen: live totals on top, the big game below. Works with no database: the game needs none. */
export default function DemoScreen({ puzzles, coreCount, prediction }: { puzzles: PublicPuzzle[]; coreCount: number; prediction: TimeInfo | null }) {
  const [stats, setStats] = useState<Stats>(readCache);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/stats", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ solves: number | null; players: number | null; stale: boolean }>;
      })
      .then((d) => {
        if (!alive) return;
        if (d.solves === null || d.players === null || d.stale) {
          // The server itself fell back, or has nothing: keep what we show, but say it is not live.
          setStats((cur) => ({ solves: d.solves ?? cur.solves, players: d.players ?? cur.players, stale: true }));
          return;
        }
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ solves: d.solves, players: d.players }));
        } catch {}
        setStats({ solves: d.solves, players: d.players, stale: false });
      })
      .catch(() => {
        if (alive) setStats((cur) => ({ ...cur, stale: true }));
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useLivePoll(refresh, 10_000);

  return (
    <main className="flex flex-1 flex-col items-center gap-2 px-4 py-3">
      <header className="flex w-full max-w-5xl flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Yomi <span className="text-orange-500">読み</span>
          <span className="ml-3 text-lg font-normal opacity-60">live</span>
        </h1>
        <div className="flex items-center gap-3">
          <Counter label="solves" value={stats.solves} />
          <Counter label="players" value={stats.players} />
        </div>
      </header>
      <p className="h-5 text-sm opacity-60" data-testid="stats-status" aria-live="polite">
        {stats.stale ? (stats.solves === null ? "Counters offline, waiting for the database…" : "Showing the last numbers we saw (database slow or offline).") : "Live · updates every 10 s"}
      </p>
      <ZipGame puzzles={puzzles} coreCount={coreCount} prediction={prediction} demo />
    </main>
  );
}
