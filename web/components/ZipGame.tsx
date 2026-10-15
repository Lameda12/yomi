"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findStuck, type GameEvent } from "@/lib/stuck";
import { flushQueue, submitSolve } from "@/lib/submit";
import { isSolved, type Cell, type Dot } from "@/lib/zip";

export interface PublicPuzzle {
  id: string;
  n: number;
  dots: Dot[];
}

type Status = "idle" | "playing" | "solved";
type Submit = "none" | "sending" | "saved" | "queued" | "failed";

const MAX_EVENTS = 5000;
const MIN_LOG_MS = 1_000; // the API rejects anything outside 1 s .. 30 min
const MAX_LOG_MS = 30 * 60_000;
const DONE_KEY = "yomi_done"; // solved puzzle ids
const SEEN_KEY = "yomi_seen"; // solved or skipped, drives which puzzle comes next
const PLAYER_KEY = "yomi_player";
const ZIP_BEFORE_KEY = "yomi_zip_before";

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

function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
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
function pickPuzzle(puzzles: PublicPuzzle[], coreCount: number, not?: string): PublicPuzzle {
  const seen = readList(SEEN_KEY);
  const core = puzzles.slice(0, coreCount).find((p) => !seen.includes(p.id));
  if (core) return core;
  const practice = puzzles.slice(coreCount).filter((p) => p.id !== not);
  const fresh = practice.filter((p) => !seen.includes(p.id));
  const pool = fresh.length ? fresh : practice;
  return pool[Math.floor(Math.random() * pool.length)];
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
});

export default function ZipGame({ puzzles, coreCount }: { puzzles: PublicPuzzle[]; coreCount: number }) {
  const [zipBefore, setZipBefore] = useState<boolean | null>(readZipBefore);
  const [done, setDone] = useState<string[]>(() => readList(DONE_KEY));
  const [puzzle, setPuzzle] = useState<PublicPuzzle>(() => pickPuzzle(puzzles, coreCount));
  const [path, setPath] = useState<Cell[]>(() => [startCell(puzzle)]);
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [backtracks, setBacktracks] = useState(0);
  const [submit, setSubmit] = useState<Submit>("none");
  const [stuck, setStuck] = useState<Cell | null>(null);
  const [copied, setCopied] = useState(false);

  const attempt = useRef<Attempt>(newAttempt(puzzle));
  const dragging = useRef(false);
  const board = useRef<HTMLDivElement>(null);

  const { n, dots } = puzzle;
  const number = puzzles.findIndex((p) => p.id === puzzle.id) + 1;
  const isCore = number <= coreCount;
  const labelAt = useMemo(() => new Map(dots.map(([r, c, v]) => [r * n + c, v])), [dots, n]);

  // Resend solves that could not be saved on an earlier visit.
  useEffect(() => {
    void flushQueue();
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
        player_id: playerId(),
        puzzle_id: puzzle.id,
        grid_size: puzzle.n,
        device: a.device,
        started_at_ms: a.startedAtMs,
        events: a.events,
        played_zip_before: readZipBefore(),
      });
      if (completed) setSubmit(result);
    },
    [puzzle.id, puzzle.n],
  );

  // Apply a new path and record what changed.
  const commit = useCallback(
    (next: Cell[], kind: "extend" | "undo" | "clear") => {
      const a = attempt.current;
      const now = performance.now();
      if (a.t0 === null) {
        a.t0 = now;
        a.startedAtMs = Date.now();
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
        setElapsed(ms);
        setStatus("solved");
        setStuck(findStuck(a.events).cell);
        dragging.current = false;
        addToList(SEEN_KEY, puzzle.id);
        setDone(addToList(DONE_KEY, puzzle.id));
        void send(true, ms);
      }
    },
    [dots, n, puzzle.id, send],
  );

  // Try to move the path head to `target`: undo if it is on the path already,
  // otherwise extend one cell at a time along a straight line (fast drags skip cells).
  const moveTo = useCallback(
    (target: Cell) => {
      const cur = attempt.current.path;
      const at = cur.findIndex(([r, c]) => r === target[0] && c === target[1]);
      if (at >= 0) {
        if (at < cur.length - 1) commit(cur.slice(0, at + 1), "undo");
        return;
      }
      const [hr, hc] = cur[cur.length - 1];
      if (hr !== target[0] && hc !== target[1]) return; // diagonal: wait for a clear direction
      const dr = Math.sign(target[0] - hr), dc = Math.sign(target[1] - hc);
      const visited = new Set(cur.map(([r, c]) => r * n + c));
      let nextLabel = 1 + cur.filter(([r, c]) => labelAt.has(r * n + c)).length;
      const next = cur.slice();
      let r = hr, c = hc;
      while (r !== target[0] || c !== target[1]) {
        r += dr;
        c += dc;
        const key = r * n + c;
        const label = labelAt.get(key);
        if (visited.has(key) || (label !== undefined && label !== nextLabel)) break;
        if (label !== undefined) nextLabel++;
        visited.add(key);
        next.push([r, c]);
      }
      if (next.length > cur.length) commit(next, "extend");
    },
    [commit, labelAt, n],
  );

  const cellAt = (e: React.PointerEvent): Cell | null => {
    const rect = board.current!.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    return r >= 0 && r < n && c >= 0 && c < n ? [r, c] : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (status === "solved") return;
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
    if (status === "solved" || attempt.current.path.length <= 1) return;
    commit([startCell(puzzle)], "clear");
  };

  const next = () => {
    const a = attempt.current;
    if (status !== "solved") {
      // Log abandoned attempts too: giving up is a difficulty signal.
      if (a.t0 !== null) void send(false, performance.now() - a.t0);
      addToList(SEEN_KEY, puzzle.id);
    }
    const p = pickPuzzle(puzzles, coreCount, puzzle.id);
    attempt.current = newAttempt(p);
    dragging.current = false;
    setPuzzle(p);
    setPath([startCell(p)]);
    setStatus("idle");
    setElapsed(0);
    setBacktracks(0);
    setSubmit("none");
    setStuck(null);
    setCopied(false);
  };

  const answerZipBefore = (yes: boolean) => {
    try {
      localStorage.setItem(ZIP_BEFORE_KEY, yes ? "yes" : "no");
    } catch {}
    setZipBefore(yes);
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

  if (zipBefore === null) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-foreground/20 p-6 text-center">
        <p className="text-lg font-semibold">One quick question first</p>
        <p className="text-sm opacity-70">Have you played a Zip-style path puzzle before?</p>
        <div className="flex gap-3">
          <button onClick={() => answerZipBefore(true)} className="rounded-lg bg-foreground px-6 py-2 text-background">
            Yes
          </button>
          <button onClick={() => answerZipBefore(false)} className="rounded-lg border border-foreground/30 px-6 py-2">
            No, first time
          </button>
        </div>
      </div>
    );
  }

  const points = path.map(([r, c]) => `${c + 0.5},${r + 0.5}`).join(" ");
  const onPath = new Set(path.map(([r, c]) => r * n + c));

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <div className="flex w-full items-baseline justify-between font-mono text-sm">
        <span>
          {isCore ? `Yomi #${number} of ${coreCount}` : `Practice #${number}`} · {n}×{n}
        </span>
        <span className="text-2xl tabular-nums">{clock(elapsed)}</span>
        <span className="opacity-60">{done.length} solved</span>
      </div>

      <div
        ref={board}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl border-2 border-foreground/80 bg-background"
        style={{ WebkitTouchCallout: "none" }}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {Array.from({ length: n * n }, (_, i) => (
            <div
              key={i}
              className={`border border-foreground/15 ${onPath.has(i) ? "bg-orange-400/25" : ""}`}
            />
          ))}
        </div>
        <svg viewBox={`0 0 ${n} ${n}`} className="pointer-events-none absolute inset-0 h-full w-full">
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
            disabled={status === "solved" || path.length <= 1}
            className="rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-30"
          >
            Clear
          </button>
          <button onClick={next} className="rounded-lg bg-foreground px-4 py-2 text-background">
            {status === "solved" ? "Next puzzle" : "Skip"}
          </button>
        </div>
      </div>

      <div className="min-h-24 w-full text-center text-sm" aria-live="polite">
        {status === "idle" && <p>Start at 1. Connect the dots in order and fill every cell.</p>}
        {status === "solved" && (
          <div className="flex flex-col items-center gap-2">
            <p>
              Solved in <b>{clock(elapsed)}</b> with <b>{backtracks}</b> backtrack{backtracks === 1 ? "" : "s"}.
              {stuck && (
                <>
                  {" "}
                  <span className="text-rose-600">You got stuck at the dashed cell.</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <code className="select-all rounded-md bg-foreground/10 px-3 py-1.5">{shareLine}</code>
              <button onClick={copyShare} className="rounded-md border border-foreground/30 px-3 py-1.5">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-xs opacity-60">
              {submit === "sending" && "Saving…"}
              {submit === "saved" && "Solve logged. Thank you."}
              {submit === "queued" && "Couldn't reach the server just now. This solve is saved here and will be sent on your next visit."}
              {submit === "failed" && "This solve could not be logged."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
