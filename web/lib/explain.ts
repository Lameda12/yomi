// Plain-English copy for the prediction, built from data the client already has. Templates only, no LLM call.
// The honesty rules from CLAUDE.md apply: while the model is the solver-effort stand-in it predicts solver
// steps, not a time, so the copy never turns it into one.
import { clock } from "./clock.ts";
import type { Cell, Dot } from "./zip.ts";

type Label = "solver_effort" | "human_time";

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The dot closest to `cell` (Manhattan distance, lower label on a tie), or null when no dot is within 2 cells. */
export function nearestDot(dots: Dot[], cell: Cell): number | null {
  let best: { label: number; dist: number } | null = null;
  for (const [r, c, label] of dots) {
    const dist = Math.abs(r - cell[0]) + Math.abs(c - cell[1]);
    if (best === null || dist < best.dist || (dist === best.dist && label < best.label)) best = { label, dist };
  }
  return best && best.dist <= 2 ? best.label : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What to show before the solve: a target to beat when the model predicts a time, a read of the grid when not. */
export function targetCopy(label: Label, value: number, difficulty: string): { headline: string; note: string } {
  if (label === "human_time") {
    return { headline: `Target: beat ${clock(value)}`, note: "Yomi's guess for you. The clock starts on your first move." };
  }
  const challenge = difficulty === "on the easier side" ? "Can you make it look easy?" : difficulty === "on the harder side" ? "Think you can crack it?" : "Can you beat the read?";
  return {
    headline: `Yomi's read: ${difficulty}. ${challenge}`,
    note: `About ${Math.round(value)} solver steps for a computer, not a time. Yomi does not predict your time yet.`,
  };
}

export interface GapInput {
  actualMs: number;
  predicted: { value: number; unit: "ms" | "solver_steps" } | null;
  label: Label | null; // what the model was trained on; null when there is no model
  backtracks: number;
  pause: { ms: number; cell: Cell | null } | null; // the longest pause in the solve and where the head sat
  dots: Dot[];
  firstTime: boolean; // no earlier solves on this device
}

// A pause only counts as a story if it is long enough to notice and a real share of the solve.
const MIN_PAUSE_MS = 3000;
const MIN_PAUSE_SHARE = 0.1;
const CLOSE = 0.1; // within 10% of the guess counts as spot on

function pauseText(i: GapInput): string | null {
  if (!i.pause || i.pause.ms < MIN_PAUSE_MS || i.pause.ms < MIN_PAUSE_SHARE * i.actualMs) return null;
  const near = i.pause.cell ? nearestDot(i.dots, i.pause.cell) : null;
  return `paused ${Math.round(i.pause.ms / 1000)} s${near === null ? "" : ` near the ${ordinal(near)} dot`}`;
}

/** One plain-English line on the gap between what Yomi predicted and what happened. */
export function explainGap(i: GapInput): string {
  const pause = pauseText(i);
  const bt = i.backtracks > 0 ? `backtracked ${plural(i.backtracks, "time")}` : null;
  const facts = [pause, bt].filter((x): x is string => x !== null);
  const story = facts.length ? `You ${facts.join(" and ")}` : null;

  // Solver steps are not a time, so there is no gap to explain; say what happened and what the model cannot do yet.
  if (i.label !== "human_time" || !i.predicted || i.predicted.unit !== "ms" || !(i.predicted.value > 0)) {
    const learning = "Yomi's model is still learning from real players, so its guess is not a time yet.";
    return story ? `${story}. ${learning}` : `A clean run with no backtracks. ${learning}`;
  }

  const ratio = i.actualMs / i.predicted.value;
  if (ratio <= 1 - CLOSE) {
    const pct = Math.round((1 - ratio) * 100);
    return `You were ${pct}% faster: ${i.backtracks === 0 ? "no backtracks." : `only ${plural(i.backtracks, "backtrack")}.`}`;
  }
  if (ratio >= 1 + CLOSE) {
    const pct = Math.round((ratio - 1) * 100);
    const why = story ? `${story}, which the model does not see.` : "A clean run, so this one was just harder on you than Yomi guessed.";
    const first = i.firstTime ? " It was your first solve, so Yomi has no history on you yet." : "";
    return `You were ${pct}% slower. ${why}${first}`;
  }
  return `Right on Yomi's guess${story ? `, even though you ${facts.join(" and ")}` : ""}.`;
}
