"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { peekPlayerId, retryPendingNickname } from "@/lib/player";
import { useLivePoll } from "@/lib/useLivePoll";
import ChangeName from "./ChangeName";


interface BoardRow {
  id: string;
  rank: number;
  name: string;
  avg_error_ms?: number; // "vs Yomi": average gap in ms
  ratio?: number; // "vs the crowd": typically x this far off the other players' time
  solves: number;
}
interface You {
  solves: number; // solves that count toward the score
  needed?: number; // "vs Yomi": more solves to qualify
  played?: number; // "vs the crowd": your regular solves so far
  rank: number | null;
  avg_error_ms?: number | null;
  ratio?: number | null;
  nickname: string | null;
}
interface Data {
  basis: "crowd" | "yomi"; // which board is live: switches to "yomi" by itself once the model predicts time
  mode: "open" | "waiting";
  board: BoardRow[];
  you: You | null;
  players: number;
  totals: { solves: number; players: number };
  progress: { players: number; need: number };
  rules: { min_solves: number; top: number; cap: string; open_players: number };
}

const times = (ratio: number) => `×${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}`;
const off = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

export default function Leaderboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  // Bumping `tick` refetches. The fetch lives in the effect so state is only set from its callbacks.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // The board is the cacheable GET; "you" is a separate POST that carries the player id in the body.
  useEffect(() => {
    let alive = true;
    const id = peekPlayerId();
    const board = fetch("/api/leaderboard", { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<Omit<Data, "you">>;
    });
    const you = id
      ? fetch("/api/leaderboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player_id: id }),
          cache: "no-store",
        })
          .then((res) => (res.ok ? (res.json() as Promise<{ you: Data["you"] }>) : null))
          .catch(() => null)
      : Promise.resolve(null);
    Promise.all([board, you])
      .then(([b, y]) => {
        if (!alive) return;
        setError(false);
        setData({ ...b, you: y?.you ?? null });
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // Live: refetch every 10 s while this tab is visible, and straight away when it becomes visible again.
  useLivePoll(refresh, 10_000);

  // Animate rank changes (FLIP): remember each row's offset, and after a refresh slide rows from where they were.
  const listRef = useRef<HTMLOListElement>(null);
  const seen = useRef(new Map<string, { top: number; rank: number }>());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { top: number; rank: number }>();
    for (const li of list.querySelectorAll<HTMLElement>("li[data-id]")) {
      const id = li.dataset.id!;
      const rank = Number(li.dataset.rank);
      const prev = seen.current.get(id);
      if (prev && !calm) {
        const dy = prev.top - li.offsetTop;
        if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
        if (prev.rank !== rank) li.animate([{ backgroundColor: "rgb(249 115 22 / 0.35)" }, { backgroundColor: "transparent" }], { duration: 900 });
      }
      next.set(id, { top: li.offsetTop, rank });
    }
    seen.current = next;
  }, [data?.board]);

  // A nickname typed while offline gets another try whenever the board is opened.
  useEffect(() => {
    void retryPendingNickname().then(refresh);
  }, [refresh]);

  if (error && !data) {
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
      <p className="flex items-center justify-center gap-2 text-xs opacity-60" data-testid="live">
        <span className="h-2 w-2 rounded-full bg-green-500 motion-safe:animate-pulse" aria-hidden />
        Live · refreshes every 10 s
      </p>
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-lg font-semibold" data-testid="board-title">
          Most Unpredictable ({data.basis === "crowd" ? "vs the crowd" : "vs Yomi"})
        </h2>
        <p className="text-sm opacity-70">
          {data.basis === "crowd"
            ? "Whose times are hardest to guess? Biggest gap from the typical time of other players on the same puzzle wins."
            : "Who does Yomi get most wrong? Biggest gap between its time guess and yours wins."}
        </p>
      </div>
      {data.mode === "waiting" ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-foreground/20 p-5 text-sm" data-testid="waiting">
          <p className="text-base font-semibold">
            Opens at {data.progress.need} players × {data.rules.min_solves} solves: <span data-testid="progress">{data.progress.players}/{data.progress.need}</span> players so far
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-label="Players with enough solves"
            aria-valuemin={0}
            aria-valuemax={data.progress.need}
            aria-valuenow={data.progress.players}
          >
            <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, (100 * data.progress.players) / data.progress.need)}%` }} />
          </div>
          <p className="opacity-70">
            {data.progress.players >= data.progress.need
              ? data.basis === "crowd"
                ? "Enough people have played, but a puzzle needs 2 other players' times before it can score anyone. Play the same puzzles as your friends."
                : "Enough people have played. Scores appear as soon as their solves have a time prediction."
              : `Play ${data.rules.min_solves} puzzles and tell a friend to do the same.`}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <ol ref={listRef} className="relative flex flex-col gap-1.5" aria-label="Most Unpredictable leaderboard">
            {data.board.map((r) => (
              <li
                key={r.id}
                data-id={r.id}
                data-rank={r.rank}
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                  you?.rank === r.rank ? "border-orange-500 bg-orange-500/10" : "border-foreground/15"
                }`}
              >
                <span className="w-6 font-mono tabular-nums opacity-60">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="font-mono tabular-nums" data-testid="score">
                  {r.ratio !== undefined ? `${times(r.ratio)} off` : `off by ${off(r.avg_error_ms ?? 0)}`}
                </span>
                <span className="w-12 text-right font-mono text-xs opacity-50">{r.solves}×</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {you && (
        <p className="rounded-xl bg-foreground/5 p-3 text-center text-sm" data-testid="you">
          {you.rank ? (
            <>
              You&apos;re <b>#{you.rank}</b> of {data.players},{" "}
              {you.ratio != null ? <>typically {times(you.ratio)} off the crowd.</> : <>off by {off(you.avg_error_ms ?? 0)} on average.</>}
            </>
          ) : data.basis === "crowd" ? (
            (you.played ?? 0) < data.rules.min_solves ? (
              <>
                <b>{data.rules.min_solves - (you.played ?? 0)}</b> more solve{data.rules.min_solves - (you.played ?? 0) === 1 ? "" : "s"} to qualify ({you.played ?? 0} of {data.rules.min_solves} so far).
              </>
            ) : (
              <>You&apos;ve played enough. {you.solves} of your solves have 2+ other players&apos; times to compare with; you need {data.rules.min_solves}.</>
            )
          ) : (you.needed ?? 0) > 0 ? (
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
        {data.basis === "crowd" ? (
          <>
            Each solve is scored by how far your time is from the typical time (median) of the other players on that puzzle, as a ratio, so a
            slow 5×5 and a slow 6×6 count the same. {data.rules.min_solves}+ solves to qualify, and each solve counts up to {data.rules.cap} off.
            Extreme runs and projector volunteers don&apos;t count.
          </>
        ) : (
          <>
            Ranked by average gap between Yomi&apos;s time guess and yours, {data.rules.min_solves}+ solves to qualify. Each solve counts up to{" "}
            {data.rules.cap} off, so walking away doesn&apos;t win.
          </>
        )}{" "}
        Anonymous: no names, emails or IPs.
      </p>
    </div>
  );
}
