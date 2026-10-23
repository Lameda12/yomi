"use client";

import { useCallback, useEffect, useState } from "react";
import { peekPlayerId, retryPendingNickname } from "@/lib/player";
import ChangeName from "./ChangeName";

const SOLVES_FOR_MODEL = 30; // human solves the time model needs before it predicts milliseconds

interface BoardRow {
  rank: number;
  name: string;
  avg_error_ms: number;
  solves: number;
}
interface Data {
  mode: "open" | "warming";
  board: BoardRow[];
  you: { solves: number; needed: number; rank: number | null; avg_error_ms: number | null; nickname: string | null } | null;
  players: number;
  totals: { solves: number; players: number };
  rules: { min_solves: number; top: number; cap_ms: number };
}

const off = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

export default function Leaderboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  // Bumping `tick` refetches. The fetch lives in the effect so state is only set from its callbacks.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    const id = peekPlayerId();
    fetch("/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { player_id: id } : {}),
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Data>;
      })
      .then((d) => {
        if (!alive) return;
        setError(false);
        setData(d);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // A nickname typed while offline gets another try whenever the board is opened.
  useEffect(() => {
    void retryPendingNickname().then(refresh);
  }, [refresh]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground/20 p-6 text-center text-sm">
        <p>Couldn&apos;t load the leaderboard.</p>
        <button onClick={refresh} className="min-h-11 rounded-lg bg-foreground px-5 py-2 text-background">
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-center text-sm opacity-60">Loading…</p>;

  const you = data.you;
  return (
    <div className="flex w-full flex-col gap-5">
      {data.mode === "warming" ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-foreground/20 p-5 text-sm">
          <p className="text-base font-semibold">Not open yet 👀</p>
          <p>
            This board ranks how far Yomi&apos;s <b>time</b> guess is from yours. Right now Yomi only predicts how hard a puzzle is (in
            solver steps), not a time, so there&apos;s nothing to compare. It opens once the time model has been trained on{" "}
            {SOLVES_FOR_MODEL}+ real solves.
          </p>
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={SOLVES_FOR_MODEL}
              aria-valuenow={Math.min(SOLVES_FOR_MODEL, data.totals.solves)}
            >
              <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, (100 * data.totals.solves) / SOLVES_FOR_MODEL)}%` }} />
            </div>
            <p className="mt-1 font-mono text-xs opacity-70">
              {data.totals.solves} of {SOLVES_FOR_MODEL} solves from {data.totals.players} player{data.totals.players === 1 ? "" : "s"}
            </p>
          </div>
          <p className="opacity-70">Every solve you play gets it closer. Play a few.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          {data.board.length === 0 ? (
            <p className="rounded-xl border border-dashed border-foreground/25 p-5 text-center text-sm opacity-80">
              Nobody&apos;s qualified yet. Solve {data.rules.min_solves} puzzles and you could be first.
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5" aria-label="Most Unpredictable leaderboard">
              {data.board.map((r) => (
                <li
                  key={r.rank}
                  className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                    you?.rank === r.rank ? "border-orange-500 bg-orange-500/10" : "border-foreground/15"
                  }`}
                >
                  <span className="w-6 font-mono tabular-nums opacity-60">{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="font-mono tabular-nums">off by {off(r.avg_error_ms)}</span>
                  <span className="w-12 text-right font-mono text-xs opacity-50">{r.solves}×</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {you && (
        <p className="rounded-xl bg-foreground/5 p-3 text-center text-sm" data-testid="you">
          {data.mode === "warming" ? (
            <>Your solves will count once Yomi predicts time.</>
          ) : you.rank ? (
            <>
              You&apos;re <b>#{you.rank}</b> of {data.players}, off by {off(you.avg_error_ms ?? 0)} on average.
            </>
          ) : you.needed > 0 ? (
            <>
              <b>{you.needed}</b> more solve{you.needed === 1 ? "" : "s"} to qualify ({you.solves} of {data.rules.min_solves} so far).
            </>
          ) : (
            <>You&apos;re qualified. Refresh to see your rank.</>
          )}
        </p>
      )}

      <div className="flex flex-col items-center text-xs">
        <p className="opacity-60" data-testid="shown-as">
          {you?.nickname ? (
            <>
              You show up as <b>{you.nickname}</b>.
            </>
          ) : (
            <>Anonymous by default: you show up as &quot;Anon xxxx&quot;.</>
          )}
        </p>
        <ChangeName onSaved={refresh} />
      </div>

      <p className="text-center text-xs opacity-50">
        Ranked by average gap between Yomi&apos;s time guess and yours, {data.rules.min_solves}+ solves to qualify. Each solve counts up to{" "}
        {data.rules.cap_ms / 60_000} min off, so walking away doesn&apos;t win. Anonymous: no names, emails or IPs.
      </p>
    </div>
  );
}
