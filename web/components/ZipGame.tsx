"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bestKey, readBest, recordBest, writeBest } from "@/lib/best";
import { clock } from "@/lib/clock";
import { explainGap, gapParts, objectiveLine, targetCopy, type GapInput } from "@/lib/explain";
import { finishKind } from "@/lib/finish";
import { sharePath, shareMessage } from "@/lib/share";
import { findStuck, type GameEvent } from "@/lib/stuck";
import { getPlayerId, markStartDone, retryPendingNickname, savedNickname, startDone } from "@/lib/player";
import { timeValue, type TimeInfo } from "@/lib/predict";
import { addDay, daysBefore, streakState } from "@/lib/streak";
import {
  durationLabel, formatRemaining, markSprintRulesSeen, readScores, readSprintSeconds, recordScore, shareScoreMessage, sprintOrder, sprintRulesSeen,
  writeScores, writeSprintSeconds,
} from "@/lib/sprint";
import { flushQueue, submitSolve } from "@/lib/submit";
import { markTutorialSeen, tutorialSeen } from "@/lib/tutorial";
import { isSolved, planMove, type Cell, type Dot } from "@/lib/zip";
import GameBackground, { type BgEvent } from "./GameBackground";
import FinishEffect, { type FinishEvent } from "./FinishEffect";
import GameMenu from "./GameMenu";
import PathLine from "./PathLine";
import { SprintOver, SprintReady, SprintRules } from "./SprintPanels";
import StreakChip from "./StreakChip";
import NameForm from "./NameForm";
import Tutorial from "./Tutorial";

export interface PublicPuzzle {
  id: string;
  n: number;
  dots: Dot[];
}

type Status = "idle" | "playing" | "solved";
type Mode = "regular" | "extreme";
type Submit = "none" | "sending" | "saved" | "queued" | "failed";

// Extreme mode is a sprint: as many puzzles as you can before the clock runs out.
type Run =
  | { phase: "ready" } // grid blurred, picking a time
  | { phase: "running"; startMs: number; durationMs: number; index: number; score: number } // index: which puzzle of the fixed order is on screen
  | { phase: "over"; durationMs: number; score: number; previousBest: number | null; newBest: boolean; cleared: boolean };

const MAX_EVENTS = 5000;
const MIN_LOG_MS = 1_000; // the API rejects anything outside 1 s .. 30 min
const MAX_LOG_MS = 30 * 60_000;
const DONE_KEY = "yomi_done"; // solved puzzle ids
const SEEN_KEY = "yomi_seen"; // solved or skipped, drives which puzzle comes next
const ZIP_BEFORE_KEY = "yomi_zip_before";
const STREAK_KEY = "yomi_streak_days"; // local calendar days with at least one solve
const MODE_KEY = "yomi_mode"; // regular (default) or extreme

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
  finished: boolean; // solved, so it is not logged again as unfinished when a sprint ends
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
  finished: false,
});

export default function ZipGame({ puzzles, coreCount, prediction, demo = false }: { puzzles: PublicPuzzle[]; coreCount: number; prediction: TimeInfo | null; demo?: boolean }) {
  // A new player lands on a puzzle with the tutorial on top, skippable with one tap. People who already played
  // (a solve, or the old start screen answered) never see it unless they open "How to play".
  const [tutorial, setTutorial] = useState(() => !demo && !tutorialSeen() && !startDone() && readList(DONE_KEY).length === 0);
  // The optional nickname prompt on the first result card. Answered (skipped or saved) once, never blocks play.
  const [nameAsked, setNameAsked] = useState(() => demo || startDone() || savedNickname() !== "");
  const [nameOpen, setNameOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [done, setDone] = useState<string[]>(() => readList(DONE_KEY));
  const [streakDays, setStreakDays] = useState<string[]>(() => readList(STREAK_KEY));
  // Regular is the default. Extreme is the sprint; the presenter screen is always Regular.
  const [mode, setMode] = useState<Mode>(() => (demo ? "regular" : readMode()));
  const sprintPuzzles = useMemo(() => sprintOrder(puzzles), [puzzles]);
  const [puzzle, setPuzzle] = useState<PublicPuzzle>(() => (mode === "extreme" ? sprintPuzzles[0] : pickPuzzle(puzzles, coreCount, undefined, demo)));
  const [path, setPath] = useState<Cell[]>(() => [startCell(puzzle)]);
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [backtracks, setBacktracks] = useState(0);
  const [submit, setSubmit] = useState<Submit>("none");
  const [stuck, setStuck] = useState<Cell | null>(null);
  // Facts about the solve that just ended, for the result card. Cleared with the next attempt.
  const [solveInfo, setSolveInfo] = useState<{ solveId: string; pauseMs: number | null; firstSolve: boolean; mode: Mode; bestMs: number | null; previousBest: number | null; newBest: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null); // the message, shown when neither share sheet nor clipboard worked
  // Predicted stuck cells arrive only after the solve ends, tagged with their puzzle so a late reply is ignored.
  const [predStuck, setPredStuck] = useState<{ id: string; cells: Cell[] } | null>(null);
  // Demo screen only: each volunteer is a fresh anonymous player (so one person at the keyboard is not one "player"
  // for every volunteer), and the stuck heatmap of earlier solvers is revealed after the solve.
  const [volunteer, setVolunteer] = useState(() => crypto.randomUUID());
  // The sprint run. The ref mirrors the state so timers and handlers always see the latest run.
  const [run, setRunState] = useState<Run | null>(() => (mode === "extreme" ? { phase: "ready" } : null));
  const runRef = useRef<Run | null>(run);
  const setRun = useCallback((r: Run | null) => {
    runRef.current = r;
    setRunState(r);
  }, []);
  const [sprintSecs, setSprintSecs] = useState(readSprintSeconds); // the chosen run length
  const [rulesSeen, setRulesSeen] = useState(sprintRulesSeen);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tick, setTick] = useState(0); // performance.now() at the last clock tick, so the countdown re-renders
  const [finish, setFinish] = useState<FinishEvent | null>(null); // the spark burst over the board
  const [bgEvent, setBgEvent] = useState<BgEvent | null>(null); // a win or a timeout, for the background to react to
  const [heat, setHeat] = useState<{ id: string; cells: { r: number; c: number; n: number }[]; total: number } | null>(null);

  // Board input is locked after a solve, and in a sprint unless the clock is running (blurred before Start, frozen after).
  const locked = status === "solved" || (mode === "extreme" && run?.phase !== "running");
  const canChangeMode = run?.phase === "running" ? false : mode === "extreme" || status === "idle";

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
        extreme_limit_ms: null, // a sprint has one clock for the whole run, not one per puzzle
        prediction: predicted ? { value: predicted.value, unit: predicted.unit, model_version: predicted.version } : null,
      });
      if (completed) setSubmit(result);
    },
    [puzzle.id, puzzle.n, predicted, demo, volunteer],
  );

  // Show a puzzle with a fresh attempt: the shared reset for "next puzzle", sprint advances and mode switches.
  const loadPuzzle = useCallback((p: PublicPuzzle) => {
    attempt.current = newAttempt(p);
    dragging.current = false;
    setPuzzle(p);
    setPath([startCell(p)]);
    setStatus("idle");
    setElapsed(0);
    setBacktracks(0);
    setSubmit("none");
    setStuck(null);
    setSolveInfo(null);
    setFinish(null);
    setPredStuck(null);
    setCopied(false);
    setShareFallback(null);
  }, []);

  // The run is over: the clock ran out, or every puzzle was solved. The puzzle in progress does not count, but it is
  // still logged as unfinished (giving up is a difficulty signal). The best score for this length stays on this device.
  const endRun = useCallback(
    (cleared = false) => {
      const r = runRef.current;
      if (!r || r.phase !== "running") return;
      const a = attempt.current;
      if (a.t0 !== null && !a.finished) void send(false, performance.now() - a.t0);
      dragging.current = false;
      const rec = recordScore(readScores(), Math.round(r.durationMs / 1000), r.score);
      writeScores(rec.map);
      setRun({ phase: "over", durationMs: r.durationMs, score: r.score, previousBest: rec.previous, newBest: rec.isNew, cleared });
      setBgEvent({ kind: "timeout", id: Date.now() });
    },
    [send, setRun],
  );

  // The next puzzle of the fixed order, or the end of the run when there are no more.
  const advanceSprint = useCallback(() => {
    const r = runRef.current;
    if (!r || r.phase !== "running") return;
    const p = sprintPuzzles[r.index];
    if (!p) endRun(true);
    else loadPuzzle(p);
  }, [sprintPuzzles, loadPuzzle, endRun]);

  const startRun = () => {
    const startMs = performance.now();
    setTick(startMs);
    setRun({ phase: "running", startMs, durationMs: sprintSecs * 1000, index: 0, score: 0 });
  };

  const playAgain = () => {
    loadPuzzle(sprintPuzzles[0]);
    setRun({ phase: "ready" });
  };

  // Skip the puzzle on screen: no score, and the next one comes up. The clock keeps running.
  const skipSprint = () => {
    const r = runRef.current;
    if (!r || r.phase !== "running" || status === "solved") return;
    const a = attempt.current;
    if (a.t0 !== null && !a.finished) void send(false, performance.now() - a.t0);
    setRun({ ...r, index: r.index + 1 });
    const p = sprintPuzzles[r.index + 1];
    if (!p) endRun(true);
    else loadPuzzle(p);
  };

  // The run clock: tick every 100 ms and end the run when the time is gone.
  useEffect(() => {
    if (run?.phase !== "running") return;
    const id = setInterval(() => {
      const now = performance.now();
      setTick(now);
      if (now - run.startMs >= run.durationMs) endRun();
    }, 100);
    return () => clearInterval(id);
  }, [run, endRun]);

  // A solved puzzle shows its spark for a moment, then the next one appears.
  useEffect(() => {
    if (mode !== "extreme" || status !== "solved" || run?.phase !== "running") return;
    const id = setTimeout(advanceSprint, 450);
    return () => clearTimeout(id);
  }, [mode, status, run, advanceSprint]);

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
        a.mode = mode === "extreme" ? "extreme" : "regular";
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
        const r = runRef.current;
        if (a.mode === "extreme" && (!r || r.phase !== "running" || now - r.startMs >= r.durationMs)) {
          endRun(); // finished after the clock ran out: it does not count
          return;
        }
        setElapsed(ms);
        setStatus("solved");
        setBgEvent({ kind: "win", id: Date.now() });
        setFinish({ id: Date.now(), kind: finishKind(a.mode === "extreme" ? "sprint" : "win"), at: next[next.length - 1] });
        const { cell: stuckCell, maxPauseMs } = findStuck(a.events);
        setStuck(stuckCell);
        // Personal best per grid size and mode, on this device only. The demo screen has no "you", so no best.
        const key = bestKey(n, a.mode);
        const rec = demo || a.mode === "extreme" ? null : recordBest(readBest(), key, ms);
        if (rec) writeBest(rec.map);
        setSolveInfo({
          solveId: a.solveId,
          pauseMs: maxPauseMs,
          firstSolve: demo || readList(DONE_KEY).length === 0, // each demo volunteer is a fresh player
          mode: a.mode,
          bestMs: rec ? (rec.map[key] ?? null) : null,
          previousBest: rec?.previous ?? null,
          newBest: rec?.isNew ?? false,
        });
        dragging.current = false;
        addToList(SEEN_KEY, puzzle.id);
        setDone(addToList(DONE_KEY, puzzle.id));
        const days = addDay(readList(STREAK_KEY), new Date());
        try {
          localStorage.setItem(STREAK_KEY, JSON.stringify(days));
        } catch {}
        setStreakDays(days);
        a.finished = true;
        if (a.mode === "extreme" && r && r.phase === "running") setRun({ ...r, score: r.score + 1, index: r.index + 1 });
        void send(true, ms);
        if (a.mode !== "extreme") void fetchStuck(puzzle.id); // the result card is the only place stuck cells show
        if (demo) void fetchHeat(puzzle.id);
      }
    },
    [dots, n, puzzle.id, send, fetchStuck, fetchHeat, demo, mode, endRun, setRun],
  );

  // Drag the path head onto `target`: see planMove in lib/zip.ts.
  const moveTo = useCallback(
    (target: Cell) => {
      const move = planMove(n, labelAt, attempt.current.path, target);
      if (move) commit(move.path, move.kind);
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
    if (locked) return;
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
    if (locked || attempt.current.path.length <= 1) return;
    commit([startCell(puzzle)], "clear");
  };

  // The Undo button: one cell back, the same as dragging back over the path.
  const undo = () => {
    if (locked || attempt.current.path.length <= 1) return;
    commit(attempt.current.path.slice(0, -1), "undo");
  };

  // Regular and demo: the next puzzle. (A sprint advances by itself, see advanceSprint.)
  const next = () => {
    const a = attempt.current;
    if (status !== "solved") {
      // Log abandoned attempts too: giving up is a difficulty signal.
      if (a.t0 !== null) void send(false, performance.now() - a.t0);
      addToList(SEEN_KEY, puzzle.id);
    }
    const p = pickPuzzle(puzzles, coreCount, puzzle.id, demo);
    if (demo) {
      setVolunteer(crypto.randomUUID());
      setHeat(null);
    }
    loadPuzzle(p);
  };

  const chooseMode = (m: Mode) => {
    if (m === mode || !canChangeMode) return;
    setMode(m);
    writeLocal(MODE_KEY, m);
    if (m === "extreme") {
      loadPuzzle(sprintPuzzles[0]); // every run starts from the same first puzzle, blurred until Start
      setRun({ phase: "ready" });
    } else {
      setRun(null);
      loadPuzzle(pickPuzzle(puzzles, coreCount, puzzle.id));
    }
  };

  const chooseSeconds = (secs: number) => {
    setSprintSecs(secs);
    writeSprintSeconds(secs);
  };

  // Share this result. Once the solve is saved the message carries /r/<solve id>, a page built from what the server
  // stored. Before that, or if saving failed, it carries the plain site link. Phones get the share sheet, the rest the clipboard.
  const shareOut = async (text: string) => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // closed the share sheet: nothing to do
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setShareFallback(null);
    } catch {
      setCopied(false);
      setShareFallback(text); // clipboard blocked: the message is selectable on screen
    }
  };
  const shareResult = () => {
    const origin = window.location.origin;
    const link = submit === "saved" && solveInfo ? `${origin}${sharePath(solveInfo.solveId)}` : origin;
    return shareOut(shareMessage(`Yomi #${number}`, elapsed, backtracks, link));
  };
  const shareScore = () => {
    if (run?.phase === "over") return shareOut(shareScoreMessage(run.score, Math.round(run.durationMs / 1000), window.location.origin));
  };

  const closeTutorial = () => {
    markTutorialSeen();
    setTutorial(false);
  };

  const today = new Date();
  const streak = streakState(streakDays, today);
  // How the solve compared with the prediction: a headline (percent faster/slower) plus one explanation line.
  const gapInput: GapInput | null =
    status === "solved" && prediction && predicted && solveInfo
      ? {
          actualMs: elapsed,
          predicted: { value: predicted.value, unit: predicted.unit },
          label: prediction.label,
          backtracks,
          pause: solveInfo.pauseMs === null ? null : { ms: solveInfo.pauseMs, cell: stuck },
          dots,
          firstTime: solveInfo.firstSolve,
        }
      : null;
  const gap = gapInput ? gapParts(gapInput) : null;
  const dayLetter = (back: number) => "SMTWTFS"[new Date(daysBefore(today, back) + "T12:00").getDay()];

  // Sprint clock: what is left (the full length before Start, zero after), and how much of the run is gone for the background.
  const remainingMs = run?.phase === "running" ? Math.max(0, run.durationMs - (tick - run.startMs)) : run?.phase === "over" ? 0 : sprintSecs * 1000;
  const sprintScore = run?.phase === "running" || run?.phase === "over" ? run.score : 0;
  const onPath = new Set(path.map(([r, c]) => r * n + c));

  // Sprint only: how much of the run is gone, 0 to 1. It drives the background pulse and the warning colour.
  const urgency = run?.phase === "running" ? Math.min(1, Math.max(0, 1 - remainingMs / run.durationMs)) : 0;

  return (
    <>
    <GameBackground extreme={mode === "extreme"} urgency={urgency} event={bgEvent} />
    {tutorial && <Tutorial onClose={closeTutorial} />}
    {menuOpen && !demo && (
      <GameMenu
        onClose={() => setMenuOpen(false)}
        puzzleLabel={mode === "extreme" ? `Extreme run · ${durationLabel(sprintSecs)}` : `${isCore ? `Yomi #${number} of ${coreCount}` : `Practice #${number}`} · ${n}×${n}`}
        solved={done.length}
        streak={{ count: streak.count, atRisk: streak.atRisk }}
        mode={mode}
        canChangeMode={canChangeMode}
        canSkip={mode !== "extreme" || run?.phase === "running"}
        onMode={chooseMode}
        skipLabel={status === "solved" ? "Next puzzle" : "Skip this puzzle"}
        onSkip={() => {
          setMenuOpen(false);
          if (mode === "extreme") skipSprint();
          else next();
        }}
        canHowTo={status !== "playing" && run?.phase !== "running"}
        onHowTo={() => {
          setMenuOpen(false);
          setTutorial(true);
        }}
      />
    )}
    <div
      className={demo ? "flex flex-col items-center gap-3 text-lg" : "flex w-full max-w-md flex-col items-center gap-3"}
      style={demo ? { width: "min(94vw, 52vh)" } : undefined}
    >
      {demo ? (
        <div className="flex w-full items-baseline justify-between font-mono text-lg">
          <span>
            {isCore ? `Yomi #${number} of ${coreCount}` : `Practice #${number}`} · {n}×{n}
          </span>
          <span className="text-5xl tabular-nums">{clock(elapsed)}</span>
          <span className="opacity-70">{done.length} solved</span>
        </div>
      ) : (
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            {mode === "extreme" ? (
              <>
                {/* No animation on this text: iOS Safari leaves a stale paint behind text that changes every 100 ms inside an animated layer. */}
                <span
                  className={`font-mono text-3xl tabular-nums ${run?.phase === "running" && remainingMs < 10_000 ? "text-rose-600" : ""}`}
                  aria-label="Time left"
                  data-testid="sprint-clock"
                >
                  {formatRemaining(remainingMs)}
                </span>
                <span className="rounded-full bg-orange-500/15 px-2.5 py-1 font-mono text-xs text-orange-700 dark:text-orange-300" data-testid="sprint-score">
                  ✓ {sprintScore}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-3xl tabular-nums" aria-label="Time">
                  {clock(elapsed)}
                </span>
                {/* once solved, the result card shows the streak instead */}
                <StreakChip count={status === "solved" ? 0 : streak.count} atRisk={streak.atRisk} />
              </>
            )}
          </div>
          <button onClick={() => setMenuOpen(true)} className="min-h-11 rounded-lg border border-foreground/30 px-4 py-2 text-sm" data-testid="menu-button">
            Menu
          </button>
        </div>
      )}

      {prediction && predicted && status !== "solved" && mode !== "extreme" && (demo ? (
        <p className="text-center text-xl leading-snug" data-testid="prediction">
          {prediction.label === "human_time" ? (
            <>Yomi predicts <b>{showPrediction(prediction, predicted.value)}</b>. Can you beat it?</>
          ) : (
            <>
              Yomi&apos;s read: <b>{difficultyWord(prediction, puzzle.id)}</b> ({showPrediction(prediction, predicted.value)} for a computer,
              not your time)
            </>
          )}
        </p>
      ) : (
        <div className="w-full rounded-xl border-2 border-orange-500/40 bg-orange-500/10 px-3 py-2 text-center" data-testid="prediction">
          <p className="text-base font-bold leading-snug">{targetCopy(prediction.label, predicted.value, difficultyWord(prediction, puzzle.id)).headline}</p>
          <p className="text-xs opacity-80">{targetCopy(prediction.label, predicted.value, difficultyWord(prediction, puzzle.id)).note}</p>
        </div>
      ))}

      {!demo && status !== "solved" && (mode !== "extreme" || run?.phase === "running") && (
        <p className="text-center text-xs opacity-80" data-testid="objective">
          {objectiveLine(dots.length)}
        </p>
      )}

      <div
        ref={board}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={`relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl border-2 border-foreground/80 bg-background ${run?.phase === "over" ? "yomi-shake" : ""}`}
        style={{ WebkitTouchCallout: "none" }}
      >
        <FinishEffect event={finish} n={n} />
        {mode === "extreme" && run && run.phase !== "running" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-y-auto bg-background/30 p-3 text-center" data-testid="sprint-overlay">
            {run.phase === "ready" ? (
              rulesSeen && !rulesOpen ? (
                <SprintReady seconds={sprintSecs} onSeconds={chooseSeconds} onStart={startRun} onRules={() => setRulesOpen(true)} />
              ) : (
                <SprintRules
                  onGotIt={() => {
                    markSprintRulesSeen();
                    setRulesSeen(true);
                    setRulesOpen(false);
                  }}
                />
              )
            ) : (
              <p className="rounded-xl bg-background/80 px-4 py-2 text-3xl font-extrabold">{run.cleared ? "All puzzles cleared" : "Time's up"}</p>
            )}
          </div>
        )}
        {/* Before Start the grid is blurred so nobody can read the puzzle ahead of the clock. */}
        <div
          className={`absolute inset-0 transition-[filter] duration-200 motion-reduce:transition-none ${mode === "extreme" && run?.phase === "ready" ? "blur-lg" : ""}`}
          data-testid="board-layer"
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
          <PathLine path={path} stroke={status === "solved" ? "#16a34a" : "#f97316"} />
          {dots.map(([r, c, v]) => (
            <g key={v}>
              <circle cx={c + 0.5} cy={r + 0.5} r={0.3} className="fill-foreground" />
              {/* dy, not dominant-baseline: Safari ignores dominant-baseline and draws the digits too high in the dot */}
              <text
                x={c + 0.5}
                y={r + 0.5}
                fontSize={0.32}
                fontWeight={700}
                className="fill-background"
                textAnchor="middle"
                dy=".35em"
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
      </div>

      {demo ? (
        <div className="flex w-full items-center justify-between text-sm">
          <span className="font-mono opacity-70">backtracks: {backtracks}</span>
          <div className="flex gap-2">
            <button
              onClick={clear}
              disabled={locked || path.length <= 1}
              className="min-h-14 rounded-lg border border-foreground/30 px-4 py-2 text-lg disabled:opacity-30"
            >
              Clear
            </button>
            <button onClick={next} className="min-h-14 rounded-lg bg-foreground px-4 py-2 text-lg text-background">
              {status === "solved" ? "Next volunteer" : "Skip"}
            </button>
          </div>
        </div>
      ) : (status === "solved" && mode !== "extreme") || (mode === "extreme" && run?.phase === "over") ? null : (
        <div className="flex w-full gap-2 text-sm">
          <button
            onClick={undo}
            disabled={locked || path.length <= 1}
            className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-30"
            data-testid="undo"
          >
            Undo
          </button>
          <button
            onClick={clear}
            disabled={locked || path.length <= 1}
            className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-30"
            data-testid="reset"
          >
            Reset
          </button>
        </div>
      )}

      <div className={`w-full text-center ${demo ? "min-h-20 text-lg" : "text-sm"}`} aria-live="polite">
        {demo && status === "idle" && <p>Start at 1. Connect the dots in order and fill every cell.</p>}
        {mode === "extreme" && run?.phase === "over" && !demo && (
          <SprintOver
            score={run.score}
            seconds={Math.round(run.durationMs / 1000)}
            previousBest={run.previousBest}
            newBest={run.newBest}
            cleared={run.cleared}
            onAgain={playAgain}
            onRegular={() => chooseMode("regular")}
            onShare={shareScore}
            copied={copied}
            fallback={shareFallback}
          />
        )}
        {status === "solved" && mode !== "extreme" && (
          <div className="flex flex-col items-center gap-2">
            {gap?.headline && !demo && (
              <div className="flex flex-col items-center" data-testid="gap-headline">
                <p
                  className={`text-5xl font-extrabold tabular-nums ${gap.headline.tone === "faster" ? "text-green-600" : gap.headline.tone === "slower" ? "text-orange-600" : ""}`}
                  data-testid="gap-big"
                >
                  {gap.headline.big}
                </p>
                <p className="text-sm font-medium">{gap.headline.small}</p>
                <p className="mt-1 text-sm opacity-80" data-testid="gap-line">
                  {gap.detail}
                </p>
              </div>
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
            {!demo && solveInfo && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {solveInfo.newBest && solveInfo.previousBest !== null && (
                  <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white" data-testid="new-best">
                    New best! Was {clock(solveInfo.previousBest)}
                  </span>
                )}
                {solveInfo.bestMs !== null && (
                  <span className="font-mono text-xs opacity-70" data-testid="best">
                    {solveInfo.newBest
                      ? `Best ${n}×${n} ${solveInfo.mode}: ${clock(solveInfo.bestMs)}`
                      : solveInfo.previousBest === null
                        ? `First ${n}×${n} ${solveInfo.mode} solve. Best to beat: ${clock(solveInfo.bestMs)}`
                        : `Best ${n}×${n} ${solveInfo.mode}: ${clock(solveInfo.bestMs)}`}
                  </span>
                )}
                <StreakChip count={streak.count} atRisk={false} />
              </div>
            )}
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
            {gap && gapInput && (demo || !gap.headline) && (
              <p className={demo ? "text-lg" : "text-sm"} data-testid="gap-line">
                {demo ? explainGap(gapInput) : gap.detail}
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
            <div className="flex w-full flex-col items-center gap-1">
              <button
                onClick={shareResult}
                disabled={submit === "sending"}
                className="min-h-11 w-full rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-50"
                data-testid="share"
              >
                {submit === "sending" ? "Saving…" : copied ? "Link copied" : "Share result"}
              </button>
              {(submit === "queued" || submit === "failed") && <p className="text-xs opacity-70">This solve is not saved yet, so the message links to the site instead of this result.</p>}
              {shareFallback && <code className="select-all break-all rounded-md bg-foreground/10 px-3 py-1.5 text-xs" data-testid="share-fallback">{shareFallback}</code>}
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
            {!demo && !nameAsked &&
              (nameOpen ? (
                <NameForm variant="start" onDone={() => setNameAsked(true)} />
              ) : (
                <p className="flex flex-wrap items-center justify-center gap-2 text-xs" data-testid="name-prompt">
                  Want your name on the board?
                  <button onClick={() => { markStartDone(); setNameAsked(true); }} className="min-h-11 rounded-lg border-2 border-foreground px-4 font-semibold">
                    No thanks
                  </button>
                  <button onClick={() => setNameOpen(true)} className="min-h-11 rounded-lg border border-foreground/30 px-4">
                    Add nickname
                  </button>
                </p>
              ))}
            <p className="text-xs opacity-70">
              {submit === "sending" && "Saving…"}
              {submit === "saved" && "Solve logged. Thank you."}
              {submit === "queued" && "Couldn't reach the server just now. This solve is saved here and will be sent on your next visit."}
              {submit === "failed" && "This solve could not be logged."}
            </p>
            {!demo && (
              // The one primary action. Sticky, so it stays in reach however long the card is on a small phone.
              <button
                onClick={next}
                autoFocus
                className="sticky bottom-3 z-10 mt-2 min-h-12 w-full rounded-xl bg-orange-500 px-4 py-3 text-lg font-semibold text-white shadow-lg"
                data-testid="next"
              >
                Next puzzle
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
