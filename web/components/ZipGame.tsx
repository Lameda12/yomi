"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findStuck, type GameEvent } from "@/lib/stuck";
import { extremeBase, extremeFactor, extremeLimit } from "@/lib/extreme";
import { getPlayerId, retryPendingNickname, startDone } from "@/lib/player";
import { timeValue, type TimeInfo } from "@/lib/predict";
import { addDay, daysBefore, streakState } from "@/lib/streak";
import { flushQueue, submitSolve } from "@/lib/submit";
import { isSolved, planMove, type Cell, type Dot } from "@/lib/zip";
import GameBackground, { type BgEvent } from "./GameBackground";
import NameForm from "./NameForm";

export interface PublicPuzzle {
  id: string;
  n: number;
  dots: Dot[];
}

type Status = "idle" | "playing" | "solved" | "timeout"; // timeout: extreme mode, the clock ran out
type Mode = "regular" | "extreme";
type Submit = "none" | "sending" | "saved" | "queued" | "failed";

const MAX_EVENTS = 5000;
const MIN_LOG_MS = 1_000; // the API rejects anything outside 1 s .. 30 min
const MAX_LOG_MS = 30 * 60_000;
const DONE_KEY = "yomi_done"; // solved puzzle ids
const SEEN_KEY = "yomi_seen"; // solved or skipped, drives which puzzle comes next
const ZIP_BEFORE_KEY = "yomi_zip_before";
const STREAK_KEY = "yomi_streak_days"; // local calendar days with at least one solve
const MODE_KEY = "yomi_mode"; // regular (default) or extreme
const WINS_KEY = "yomi_extreme_wins"; // consecutive extreme wins; each one tightens the clock

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function addToList(key: string, id: string): string[] {
  const next = Array.from(new Set([...readList(key), id]));
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  return next;
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "extreme" ? "extreme" : "regular";
  } catch {
    return "regular";
  }
}

function readWins(): number {
  try {
    const n = Number(localStorage.getItem(WINS_KEY));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function readZipBefore(): boolean | null {
  try {
    const v = localStorage.getItem(ZIP_BEFORE_KEY);
    return v === "yes" ? true : v === "no" ? false : null;
  } catch {
    return null;
  }
}

// The first `coreCount` puzzles come in order for everyone; after that, random practice.
function pickPuzzle(puzzles: PublicPuzzle[], coreCount: number, not?: string, demo = false): PublicPuzzle {
  const seen = readList(SEEN_KEY);
  if (demo) {
    // Presenter screen: any puzzle, preferring ones this screen has not shown yet. No fixed core order.
    const pool = puzzles.filter((p) => p.id !== not);
    const fresh = pool.filter((p) => !seen.includes(p.id));
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(Math.random() * from.length)];
  }
  const core = puzzles.slice(0, coreCount).find((p) => !seen.includes(p.id));
  if (core) return core;
  const practice = puzzles.slice(coreCount).filter((p) => p.id !== not);
  const fresh = practice.filter((p) => !seen.includes(p.id));
  const pool = fresh.length ? fresh : practice;
  return pool[Math.floor(Math.random() * pool.length)];
}

// A time model predicts milliseconds. The solver-effort stand-in predicts search steps, which are not a time.
function showPrediction(info: TimeInfo, value: number): string {
  return info.label === "human_time" ? clock(value) : `about ${Math.round(value)} solver steps`;
}

// Where this puzzle's prediction sits among all of them, so "steps" still means something to a player.
function difficultyWord(info: TimeInfo, puzzleId: string): string {
  const all = Object.values(info.logByPuzzle).sort((a, b) => a - b);
  const mine = info.logByPuzzle[puzzleId];
  const below = all.filter((v) => v < mine).length / Math.max(1, all.length - 1);
  return below < 1 / 3 ? "on the easier side" : below > 2 / 3 ? "on the harder side" : "middle of the pack";
}

function startCell(p: PublicPuzzle): Cell {
  const d = p.dots.find((x) => x[2] === 1)!;
  return [d[0], d[1]];
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Mutable per-attempt state. Pointer events fire faster than renders, so the
// source of truth lives in a ref and `path` state mirrors it for drawing.
interface Attempt {
  solveId: string; // sent with the solve so retries are stored once
  path: Cell[];
  t0: number | null; // performance.now() at first move
  startedAtMs: number | null; // wall clock at first move
  backtracks: number; // undo episodes
  events: GameEvent[];
  lastWasUndo: boolean;
  device: "mouse" | "touch" | null;
  mode: Mode; // locked at the first move, so the toggle cannot change an attempt in progress
  limitMs: number | null; // extreme mode: the clock this attempt plays against, locked at the first move
}

const newAttempt = (p: PublicPuzzle): Attempt => ({
  solveId: crypto.randomUUID(),
  path: [startCell(p)],
  t0: null,
  startedAtMs: null,
  backtracks: 0,
  events: [],
  lastWasUndo: false,
  device: null,
  mode: "regular",
  limitMs: null,
});

export default function ZipGame({ puzzles, coreCount, prediction, demo = false }: { puzzles: PublicPuzzle[]; coreCount: number; prediction: TimeInfo | null; demo?: boolean }) {
  // First visit on this device: a start screen (nickname or skip) comes before the puzzle, once.
  const [started, setStarted] = useState(() => demo || startDone());
  const [done, setDone] = useState<string[]>(() => readList(DONE_KEY));
  const [streakDays, setStreakDays] = useState<string[]>(() => readList(STREAK_KEY));
  const [puzzle, setPuzzle] = useState<PublicPuzzle>(() => pickPuzzle(puzzles, coreCount, undefined, demo));
  const [path, setPath] = useState<Cell[]>(() => [startCell(puzzle)]);
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [backtracks, setBacktracks] = useState(0);
  const [submit, setSubmit] = useState<Submit>("none");
  const [stuck, setStuck] = useState<Cell | null>(null);
  const [copied, setCopied] = useState(false);
  // Predicted stuck cells arrive only after the solve ends, tagged with their puzzle so a late reply is ignored.
  const [predStuck, setPredStuck] = useState<{ id: string; cells: Cell[] } | null>(null);
  // Demo screen only: each volunteer is a fresh anonymous player (so one person at the keyboard is not one "player"
  // for every volunteer), and the stuck heatmap of earlier solvers is revealed after the solve.
  const [volunteer, setVolunteer] = useState(() => crypto.randomUUID());
  // Extreme mode: Regular stays the default. Wins in a row tighten the clock; "medians" is the crowd's typical time.
  const [mode, setMode] = useState<Mode>(() => (demo ? "regular" : readMode()));
  const [extremeWins, setExtremeWins] = useState(readWins);
  const [medians, setMedians] = useState<Record<string, { median_ms: number; n: number }> | null>(null);
  const [extremeWin, setExtremeWin] = useState<{ marginMs: number; limitMs: number } | null>(null);
  const [bgEvent, setBgEvent] = useState<BgEvent | null>(null); // a win or a timeout, for the background to react to
  const [lockedLimit, setLockedLimit] = useState<number | null>(null); // the running attempt's clock, fixed at the first move
  const [heat, setHeat] = useState<{ id: string; cells: { r: number; c: number; n: number }[]; total: number } | null>(null);

  const attempt = useRef<Attempt>(newAttempt(puzzle));
  const dragging = useRef(false);
  const board = useRef<HTMLDivElement>(null);

  // Null when there is no model, no entry for this puzzle, or a bad number: the game then shows no prediction.
  const predicted = useMemo(() => {
    const z = prediction?.logByPuzzle[puzzle.id];
    if (!prediction || z === undefined) return null;
    const value = timeValue(z, prediction.players, demo ? volunteer : getPlayerId());
    if (!Number.isFinite(value) || value <= 0) return null;
    return { value, unit: prediction.label === "human_time" ? ("ms" as const) : ("solver_steps" as const), version: prediction.version };
  }, [prediction, puzzle.id, demo, volunteer]);

  // Only needed (and only fetched) in extreme mode, when the model cannot give a time in milliseconds.
  useEffect(() => {
    if (mode !== "extreme" || medians) return;
    let alive = true;
    fetch("/api/medians")
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, { median_ms: number; n: number }>>) : {}))
      .catch(() => ({}))
      .then((m) => {
        if (alive) setMedians(m);
      });
    return () => {
      alive = false;
    };
  }, [mode, medians]);

  // The clock for this puzzle: 80% (less after each consecutive win, floor 50%) of the model's time for this player,
  // else of the puzzle's crowd median, else 60 s to start.
  const limitInfo = useMemo(() => {
    if (mode !== "extreme") return null;
    const crowd = medians?.[puzzle.id];
    const modelMs = prediction?.label === "human_time" && predicted?.unit === "ms" ? predicted.value : null;
    const base = extremeBase({ modelMs, crowdMedianMs: crowd?.median_ms ?? null });
    // ready: the model or the crowd data has arrived, so the clock will not change under the player's hands.
    return { ms: extremeLimit(base.ms, extremeWins), source: base.source, factor: extremeFactor(extremeWins), crowdN: crowd?.n ?? 0, ready: modelMs !== null || medians !== null };
  }, [mode, prediction, predicted, medians, puzzle.id, extremeWins]);

  const { n, dots } = puzzle;
  const number = puzzles.findIndex((p) => p.id === puzzle.id) + 1;
  const isCore = number <= coreCount;
  const labelAt = useMemo(() => new Map(dots.map(([r, c, v]) => [r * n + c, v])), [dots, n]);

  // Resend solves that could not be saved on an earlier visit.
  useEffect(() => {
    void flushQueue();
    void retryPendingNickname(); // a nickname that could not be saved last time
  }, []);

  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => {
      const t0 = attempt.current.t0;
      if (t0 !== null) setElapsed(performance.now() - t0);
    }, 100);
    return () => clearInterval(id);
  }, [status]);

  const send = useCallback(
    async (completed: boolean, solveMs: number) => {
      const a = attempt.current;
      const ms = Math.round(solveMs);
      if (a.startedAtMs === null || ms < MIN_LOG_MS || ms > MAX_LOG_MS) {
        if (completed) setSubmit("failed");
        return;
      }
      if (completed) setSubmit("sending");
      const result = await submitSolve({
        solve_id: a.solveId,
        player_id: demo ? volunteer : getPlayerId(),
        ...(demo ? { source: "demo" as const } : {}),
        puzzle_id: puzzle.id,
        grid_size: puzzle.n,
        device: a.device,
        started_at_ms: a.startedAtMs,
        events: a.events,
        played_zip_before: readZipBefore(),
        mode: a.mode,
        extreme_limit_ms: a.mode === "extreme" ? a.limitMs : null,
        prediction: predicted ? { value: predicted.value, unit: predicted.unit, model_version: predicted.version } : null,
      });
      if (completed) setSubmit(result);
    },
    [puzzle.id, puzzle.n, predicted, demo, volunteer],
  );

  // Extreme mode: the clock ran out. Log the attempt, reset the grid, and offer an instant Retry.
  const timeUp = useCallback(() => {
    const a = attempt.current;
    if (a.t0 === null || a.limitMs === null) return;
    dragging.current = false;
    void send(false, a.limitMs);
    a.path = [startCell(puzzle)];
    setPath(a.path);
    setElapsed(a.limitMs);
    setStatus("timeout");
    setBgEvent({ kind: "timeout", id: Date.now() });
    setExtremeWins(0);
    writeLocal(WINS_KEY, "0");
  }, [send, puzzle]);

  // Ask for the predicted stuck cells once the solve is over. Any failure just means no overlay.
  const fetchStuck = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/stuck?puzzle_id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body: unknown = await res.json();
      const raw = (body as { cells?: unknown }).cells;
      if (!Array.isArray(raw)) return;
      const cells = raw.filter((c): c is Cell => Array.isArray(c) && c.length === 2 && c.every((v) => Number.isInteger(v)));
      if (cells.length) setPredStuck({ id, cells });
    } catch {}
  }, []);

  // Demo: where earlier solvers got stuck on this puzzle. Any failure just means no heatmap.
  const fetchHeat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/heatmap?puzzle_id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { cells?: { r: number; c: number; n: number }[]; total?: number };
      if (Array.isArray(body.cells) && body.cells.length) setHeat({ id, cells: body.cells, total: Number(body.total) || 0 });
    } catch {}
  }, []);

  // Apply a new path and record what changed.
  const commit = useCallback(
    (next: Cell[], kind: "extend" | "undo" | "clear") => {
      const a = attempt.current;
      const now = performance.now();
      if (a.t0 === null) {
        a.t0 = now;
        a.startedAtMs = Date.now();
        a.mode = limitInfo ? "extreme" : "regular";
        a.limitMs = limitInfo?.ms ?? null;
        setLockedLimit(a.limitMs);
        setStatus("playing");
      }
      if (kind !== "extend" && !a.lastWasUndo) {
        a.backtracks++;
        setBacktracks(a.backtracks);
      }
      a.lastWasUndo = kind !== "extend";
      a.path = next;
      const head = next[next.length - 1];
      if (a.events.length < MAX_EVENTS) {
        a.events.push([Math.round(now - a.t0), head[0], head[1], next.length]);
      }
      setPath(next);

      if (kind === "extend" && isSolved(n, dots, next)) {
        const ms = now - a.t0;
        if (a.mode === "extreme" && a.limitMs !== null && ms > a.limitMs) {
          timeUp(); // finished, but after the clock: not a win
          return;
        }
        if (a.mode === "extreme" && a.limitMs !== null) {
          setExtremeWin({ marginMs: a.limitMs - ms, limitMs: a.limitMs });
          setExtremeWins((w) => {
            writeLocal(WINS_KEY, String(w + 1));
            return w + 1;
          });
        }
        setElapsed(ms);
        setStatus("solved");
        setBgEvent({ kind: "win", id: Date.now() });
        setStuck(findStuck(a.events).cell);
        dragging.current = false;
        addToList(SEEN_KEY, puzzle.id);
        setDone(addToList(DONE_KEY, puzzle.id));
        const days = addDay(readList(STREAK_KEY), new Date());
        try {
          localStorage.setItem(STREAK_KEY, JSON.stringify(days));
        } catch {}
        setStreakDays(days);
        void send(true, ms);
        void fetchStuck(puzzle.id);
        if (demo) void fetchHeat(puzzle.id);
      }
    },
    [dots, n, puzzle.id, send, fetchStuck, fetchHeat, demo, limitInfo, timeUp],
  );

  // Drag the path head onto `target`: see planMove in lib/zip.ts.
  const moveTo = useCallback(
    (target: Cell) => {
      const move = planMove(n, labelAt, attempt.current.path, target);
      if (move) commit(move.path, move.kind);
    },
    [commit, labelAt, n],
  );

  // The countdown: check the clock every 100 ms while an extreme attempt is running.
  useEffect(() => {
    if (status !== "playing" || attempt.current.mode !== "extreme") return;
    const id = setInterval(() => {
      const a = attempt.current;
      if (a.t0 !== null && a.limitMs !== null && performance.now() - a.t0 >= a.limitMs) timeUp();
    }, 100);
    return () => clearInterval(id);
  }, [status, timeUp]);

  const cellAt = (e: React.PointerEvent): Cell | null => {
    const rect = board.current!.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    return r >= 0 && r < n && c >= 0 && c < n ? [r, c] : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (status === "solved" || status === "timeout") return;
    if (limitInfo && !limitInfo.ready) return; // extreme: wait for the clock to load (a moment) so it cannot change mid-play
    const cell = cellAt(e);
    if (!cell) return;
    e.preventDefault();
    try {
      board.current!.setPointerCapture(e.pointerId);
    } catch {}
    attempt.current.device = e.pointerType === "mouse" ? "mouse" : "touch"; // pen counts as touch
    dragging.current = true;
    moveTo(cell);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const cell = cellAt(e);
    if (cell) moveTo(cell);
  };

  const onUp = () => {
    dragging.current = false;
  };

  const clear = () => {
    if (status === "solved" || status === "timeout" || attempt.current.path.length <= 1) return;
    commit([startCell(puzzle)], "clear");
  };

  const next = () => {
    const a = attempt.current;
    if (status !== "solved") {
      // Log abandoned attempts too: giving up is a difficulty signal. (A timeout was already logged.)
      if (a.t0 !== null && status !== "timeout") void send(false, performance.now() - a.t0);
      addToList(SEEN_KEY, puzzle.id);
      if (a.mode === "extreme" && status === "playing") {
        setExtremeWins(0); // skipping mid-clock is a loss
        writeLocal(WINS_KEY, "0");
      }
    }
    const p = pickPuzzle(puzzles, coreCount, puzzle.id, demo);
    if (demo) {
      setVolunteer(crypto.randomUUID());
      setHeat(null);
    }
    attempt.current = newAttempt(p);
    dragging.current = false;
    setPuzzle(p);
    setPath([startCell(p)]);
    setStatus("idle");
    setElapsed(0);
    setBacktracks(0);
    setSubmit("none");
    setStuck(null);
    setPredStuck(null);
    setExtremeWin(null);
    setLockedLimit(null);
    setCopied(false);
  };

  // Instant retry after a timeout: same puzzle, fresh attempt, clock waits for the first move again.
  const retry = useCallback(() => {
    attempt.current = newAttempt(puzzle);
    dragging.current = false;
    setPath([startCell(puzzle)]);
    setStatus("idle");
    setElapsed(0);
    setBacktracks(0);
    setSubmit("none");
    setStuck(null);
    setLockedLimit(null);
  }, [puzzle]);

  // Enter retries too (one key). preventDefault stops a focused Retry button from also firing its own click.
  useEffect(() => {
    if (status !== "timeout") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      retry();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [status, retry]);

  const chooseMode = (m: Mode) => {
    if (m === mode || status !== "idle") return;
    setMode(m);
    writeLocal(MODE_KEY, m);
  };

  const shareLine = `Yomi #${number}: ${clock(elapsed)}, ${backtracks} backtrack${backtracks === 1 ? "" : "s"}`;
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(`${shareLine} ${window.location.origin}`);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the line is still selectable on screen
    }
  };

  if (!started) return <NameForm variant="start" onDone={() => setStarted(true)} />;

  const today = new Date();
  const streak = streakState(streakDays, today);
  const dayLetter = (back: number) => "SMTWTFS"[new Date(daysBefore(today, back) + "T12:00").getDay()];

  const limit = lockedLimit ?? limitInfo?.ms ?? 0;
  const remaining = status === "playing" ? Math.max(0, limit - elapsed) : status === "timeout" ? 0 : limit;
  const basis =
    limitInfo?.source === "model"
      ? `${Math.round(limitInfo.factor * 100)}% of Yomi's time for you`
      : limitInfo?.source === "crowd"
        ? `${Math.round(limitInfo.factor * 100)}% of the typical time (${limitInfo.crowdN} solves)`
        : limitInfo
          ? `no data on this puzzle yet, so ${clock(limitInfo.ms)} to start`
          : "";

  const points = path.map(([r, c]) => `${c + 0.5},${r + 0.5}`).join(" ");
  const onPath = new Set(path.map(([r, c]) => r * n + c));

  // Extreme only: how much of the clock is gone, 0 to 1. It drives the pulse and the warning colour.
  const urgency = mode === "extreme" && status === "playing" && limit > 0 ? Math.min(1, elapsed / limit) : 0;

  return (
    <>
    <GameBackground extreme={mode === "extreme"} urgency={urgency} event={bgEvent} />
    <div
      className={demo ? "flex flex-col items-center gap-3 text-lg" : "flex w-full max-w-md flex-col items-center gap-4"}
      style={demo ? { width: "min(94vw, 52vh)" } : undefined}
    >
      {!demo && streak.count > 0 && (
        <p className="rounded-full bg-orange-500/15 px-3 py-1 font-mono text-xs text-orange-700 dark:text-orange-300">
          🔥 {streak.count}-day streak
        </p>
      )}
      <div className={`flex w-full items-baseline justify-between font-mono ${demo ? "text-lg" : "text-sm"}`}>
        <span>
          {isCore ? `Yomi #${number} of ${coreCount}` : `Practice #${number}`} · {n}×{n}
        </span>
        <span className={`tabular-nums ${demo ? "text-5xl" : "text-2xl"}`}>{clock(elapsed)}</span>
        <span className="opacity-70">{done.length} solved</span>
      </div>

      {!demo && (
        <div role="group" aria-label="Game mode" className="flex w-full rounded-xl border border-foreground/20 p-1" data-testid="mode-toggle">
          {(["regular", "extreme"] as const).map((m) => (
            <button
              key={m}
              onClick={() => chooseMode(m)}
              aria-pressed={mode === m}
              disabled={status !== "idle" && mode !== m}
              className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize disabled:opacity-40 ${
                mode === m ? (m === "extreme" ? "bg-orange-500 text-white" : "bg-foreground text-background") : ""
              }`}
            >
              {m === "extreme" ? "Extreme ⚡" : "Regular"}
            </button>
          ))}
        </div>
      )}

      {prediction && predicted && status !== "solved" && (
        <p className={demo ? "text-center text-xl leading-snug" : "text-center text-xs"} data-testid="prediction">
          {prediction.label === "human_time" ? (
            <>Yomi predicts <b>{showPrediction(prediction, predicted.value)}</b>. Can you beat it?</>
          ) : (
            <>
              Yomi&apos;s read: <b>{difficultyWord(prediction, puzzle.id)}</b> ({showPrediction(prediction, predicted.value)} for a computer,
              not your time)
            </>
          )}
        </p>
      )}

      {limitInfo && (
        <div className="flex w-full flex-col gap-1" data-testid="countdown">
          <div className="flex items-baseline justify-between font-mono text-xs">
            <span>{!limitInfo.ready ? "Loading the clock…" : status === "solved" && extremeWin ? "Clock stopped" : `Beat Yomi's clock: ${clock(limit)}`}</span>
            <span className={remaining < limit * 0.25 && status === "playing" ? "text-rose-600" : ""} data-testid="remaining">
              {limitInfo.ready ? `${(remaining / 1000).toFixed(1)}s left` : "–"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Time left on the clock"
            aria-valuemin={0}
            aria-valuemax={Math.round(limit / 1000)}
            aria-valuenow={Math.round(remaining / 1000)}
            className="h-3 w-full overflow-hidden rounded-full bg-foreground/10"
          >
            <div
              className={`h-full ${remaining < limit * 0.25 ? "bg-rose-500" : "bg-orange-500"}`}
              style={{ width: `${limit > 0 ? Math.min(100, (100 * remaining) / limit) : 0}%` }}
            />
          </div>
          <p className="text-[11px] opacity-70">{limitInfo.ready ? `${basis}. Clock starts on your first move.` : "One moment."}</p>
        </div>
      )}

      <div
        ref={board}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={`relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl border-2 border-foreground/80 bg-background ${status === "timeout" ? "yomi-shake" : ""}`}
        style={{ WebkitTouchCallout: "none" }}
      >
        {status === "timeout" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 p-4 text-center" data-testid="timeout">
            <p className="text-2xl font-bold">Time&apos;s up</p>
            <p className="text-sm opacity-70">The clock was {clock(lockedLimit ?? limit)}. The grid is reset.</p>
            <button onClick={retry} autoFocus className="min-h-11 rounded-lg bg-orange-500 px-8 py-2 text-lg font-semibold text-white">
              Retry
            </button>
            <p className="text-xs opacity-70">Press Enter</p>
          </div>
        )}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {Array.from({ length: n * n }, (_, i) => (
            <div
              key={i}
              className={`border border-foreground/15 ${onPath.has(i) ? "bg-orange-400/25" : ""}`}
            />
          ))}
        </div>
        <svg viewBox={`0 0 ${n} ${n}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {status === "solved" && heat?.id === puzzle.id && heat.cells.map(({ r, c, n: count }) => (
            <rect
              key={`h${r}-${c}`}
              x={c}
              y={r}
              width={1}
              height={1}
              fill="#f97316"
              opacity={0.18 + (0.6 * count) / Math.max(...heat.cells.map((x) => x.n))}
              data-heat={count}
            />
          ))}
          <polyline
            points={points}
            fill="none"
            stroke={status === "solved" ? "#16a34a" : "#f97316"}
            strokeWidth={0.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {dots.map(([r, c, v]) => (
            <g key={v}>
              <circle cx={c + 0.5} cy={r + 0.5} r={0.3} className="fill-foreground" />
              <text
                x={c + 0.5}
                y={r + 0.5}
                fontSize={0.32}
                fontWeight={700}
                className="fill-background"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {v}
              </text>
            </g>
          ))}
          {status === "solved" && predStuck?.id === puzzle.id && predStuck.cells.map(([r, c]) => (
            <rect
              key={`p${r}-${c}`}
              x={c + 0.14}
              y={r + 0.14}
              width={0.72}
              height={0.72}
              rx={0.1}
              fill="none"
              stroke="#2563eb"
              strokeWidth={0.07}
              strokeDasharray="0.05 0.1"
              strokeLinecap="round"
            />
          ))}
          {stuck && (
            <rect
              x={stuck[1] + 0.06}
              y={stuck[0] + 0.06}
              width={0.88}
              height={0.88}
              rx={0.12}
              fill="none"
              stroke="#e11d48"
              strokeWidth={0.09}
              strokeDasharray="0.16 0.1"
            />
          )}
        </svg>
      </div>

      <div className="flex w-full items-center justify-between text-sm">
        <span className="font-mono opacity-70">backtracks: {backtracks}</span>
        <div className="flex gap-2">
          <button
            onClick={clear}
            disabled={status === "solved" || status === "timeout" || path.length <= 1}
            className={`rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-30 ${demo ? "min-h-14 text-lg" : "min-h-11"}`}
          >
            Clear
          </button>
          <button onClick={next} className={`rounded-lg bg-foreground px-4 py-2 text-background ${demo ? "min-h-14 text-lg" : "min-h-11"}`}>
            {status === "solved" ? (demo ? "Next volunteer" : "Next puzzle") : "Skip"}
          </button>
        </div>
      </div>

      <div className={`w-full text-center ${demo ? "min-h-20 text-lg" : "min-h-24 text-sm"}`} aria-live="polite">
        {status === "idle" && (
          <div className="flex flex-col gap-1">
            <p>Start at 1. Connect the dots in order and fill every cell.{mode === "extreme" && " The clock starts on your first move."}</p>
            {!demo && streak.atRisk && (
              <p className="text-orange-600">
                Solve one today to keep your {streak.count}-day streak 🔥
              </p>
            )}
          </div>
        )}
        {status === "solved" && (
          <div className="flex flex-col items-center gap-2">
            {extremeWin && (
              <p className="text-xl font-bold text-green-600" data-testid="extreme-win">
                {extremeWin.marginMs < 1000 ? "Beat Yomi's clock by less than a second" : `Beat Yomi's clock by ${clock(extremeWin.marginMs)}`}
                {extremeWins > 1 && <span className="block text-sm font-normal opacity-80">{extremeWins} in a row. Next clock: {Math.round(extremeFactor(extremeWins) * 100)}%.</span>}
              </p>
            )}
            <p>
              Solved in <b>{clock(elapsed)}</b> with <b>{backtracks}</b> backtrack{backtracks === 1 ? "" : "s"}.
              {stuck && (
                <>
                  {" "}
                  <span className="text-rose-600">You got stuck at the dashed cell.</span>
                </>
              )}
            </p>
            {prediction && predicted && (
              <p className={demo ? "text-xl" : "text-sm"} data-testid="pred-vs-actual">
                {prediction.label === "human_time" ? (
                  <>
                    Yomi predicted <b>{clock(predicted.value)}</b>. You: <b>{clock(elapsed)}</b>.{" "}
                    {elapsed <= predicted.value
                      ? `You beat it by ${Math.max(1, Math.round((predicted.value - elapsed) / 1000))}s.`
                      : `It was ahead by ${Math.max(1, Math.round((elapsed - predicted.value) / 1000))}s.`}
                  </>
                ) : (
                  <>
                    Yomi predicted <b>{showPrediction(prediction, predicted.value)}</b> for a computer (not a time). You: <b>{clock(elapsed)}</b>.
                  </>
                )}
              </p>
            )}
            {predStuck?.id === puzzle.id && (
              <p className="text-xs text-blue-600 dark:text-blue-300">Blue dots: where Yomi expected you to get stuck.</p>
            )}
            {demo && heat?.id === puzzle.id && heat.total > 0 && (
              <p className="text-base text-orange-600" data-testid="heat-caption">
                Orange: where {heat.total} earlier solver{heat.total === 1 ? "" : "s"} got stuck on this puzzle.
              </p>
            )}
            {!demo && (<>
            <div className="flex items-center gap-2">
              <code className="select-all rounded-md bg-foreground/10 px-3 py-1.5">{shareLine}</code>
              <button onClick={copyShare} className="rounded-md border border-foreground/30 px-3 py-1.5">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex flex-col items-center gap-1" aria-label={`Solved ${streak.week.filter(Boolean).length} of the last 7 days`}>
              <div className="flex gap-1.5">
                {streak.week.map((hit, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <span
                      className={`h-5 w-5 rounded-full border ${hit ? "border-orange-500 bg-orange-500" : "border-foreground/25"} ${i === 6 ? "ring-2 ring-orange-300" : ""}`}
                    />
                    <span className="font-mono text-[10px] opacity-70">{dayLetter(6 - i)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs">
                {streak.count === 1 ? "Day 1. Come back tomorrow to start a streak." : `${streak.count} days in a row 🔥 Come back tomorrow to keep it.`}
              </p>
            </div>
            </>)}
            <p className="text-xs opacity-70">
              {submit === "sending" && "Saving…"}
              {submit === "saved" && "Solve logged. Thank you."}
              {submit === "queued" && "Couldn't reach the server just now. This solve is saved here and will be sent on your next visit."}
              {submit === "failed" && "This solve could not be logged."}
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
