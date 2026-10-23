"use client";

import { useState } from "react";
import { SPRINT_PRESETS, durationLabel, parseDuration } from "@/lib/sprint";

const chip = "min-h-11 rounded-lg border px-3 text-sm font-medium";

/** The rules card, shown before the first Extreme run and from the "Rules" link after that. */
export function SprintRules({ onGotIt }: { onGotIt: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-2 text-left" data-testid="sprint-rules">
      <p className="text-lg font-bold">How Extreme works</p>
      <ul className="list-disc space-y-1 pl-5 text-xs leading-snug">
        <li>Pick a time, from 10 seconds to 10 minutes. The grid stays blurred until you tap Start.</li>
        <li>Solve as many puzzles as you can. Each one scores 1 and the next appears at once.</li>
        <li>Same puzzles, same order, every run. Smallest grids first.</li>
        <li>When time is up, the puzzle you are on does not count.</li>
        <li>Your best score for each time is kept on this device only. Extreme runs are not used to train Yomi&apos;s model.</li>
      </ul>
      <button onClick={onGotIt} className="min-h-11 w-full rounded-lg bg-orange-500 px-4 py-2 text-base font-semibold text-white" data-testid="sprint-rules-ok">
        Got it
      </button>
    </div>
  );
}

/** Before a run: pick the time (presets or custom seconds/minutes) and start. The grid behind it is blurred. */
export function SprintReady({ seconds, onSeconds, onStart, onRules }: { seconds: number; onSeconds: (s: number) => void; onStart: () => void; onRules: () => void }) {
  const isPreset = (SPRINT_PRESETS as readonly number[]).includes(seconds);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [unit, setUnit] = useState<"s" | "min">(seconds % 60 === 0 && seconds >= 60 ? "min" : "s");
  const [text, setText] = useState(() => (seconds % 60 === 0 && seconds >= 60 ? String(seconds / 60) : String(seconds)));
  const parsed = parseDuration(text, unit);
  const invalid = customOpen && !parsed.ok;

  const edit = (nextText: string, nextUnit: "s" | "min") => {
    setText(nextText);
    setUnit(nextUnit);
    const r = parseDuration(nextText, nextUnit);
    if (r.ok) onSeconds(r.seconds);
  };

  return (
    <div className="flex w-full flex-col items-center gap-2" data-testid="sprint-ready">
      <p className="text-lg font-bold">Extreme ⚡</p>
      <p className="text-xs leading-snug">Clock starts when you tap Start. Each solved puzzle scores 1.</p>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Run length">
        {SPRINT_PRESETS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setCustomOpen(false);
              onSeconds(s);
            }}
            aria-pressed={!customOpen && seconds === s}
            className={`${chip} ${!customOpen && seconds === s ? "border-orange-500 bg-orange-500 text-white" : "border-foreground/30 bg-background"}`}
          >
            {durationLabel(s)}
          </button>
        ))}
        <button
          onClick={() => {
            setCustomOpen(true);
            const r = parseDuration(text, unit);
            if (r.ok) onSeconds(r.seconds);
          }}
          aria-pressed={customOpen}
          className={`${chip} ${customOpen ? "border-orange-500 bg-orange-500 text-white" : "border-foreground/30 bg-background"}`}
        >
          Custom
        </button>
      </div>
      {customOpen && (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <label htmlFor="sprint-custom" className="sr-only">
              Custom run length
            </label>
            <input
              id="sprint-custom"
              value={text}
              onChange={(e) => edit(e.target.value, unit)}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={invalid || undefined}
              className="min-h-11 w-24 rounded-lg border border-foreground/30 bg-background px-3 text-center text-base"
              data-testid="sprint-custom"
            />
            <label htmlFor="sprint-unit" className="sr-only">
              Unit
            </label>
            <select
              id="sprint-unit"
              value={unit}
              onChange={(e) => edit(text, e.target.value as "s" | "min")}
              className="min-h-11 rounded-lg border border-foreground/30 bg-background px-2 text-base"
              data-testid="sprint-unit"
            >
              <option value="s">seconds</option>
              <option value="min">minutes</option>
            </select>
          </div>
          <p className={`min-h-4 text-xs ${invalid ? "text-rose-600" : "opacity-70"}`} role={invalid ? "alert" : undefined} data-testid="sprint-custom-note">
            {parsed.ok ? durationLabel(parsed.seconds) : parsed.error}
          </p>
        </div>
      )}
      <button
        onClick={onStart}
        disabled={invalid}
        className="min-h-12 w-full rounded-xl bg-orange-500 px-4 py-2 text-lg font-semibold text-white disabled:opacity-40"
        data-testid="sprint-start"
      >
        Start {durationLabel(seconds)}
      </button>
      <button onClick={onRules} className="min-h-8 text-xs underline opacity-80">
        Rules
      </button>
    </div>
  );
}

/** After a run: the score, how it compares with the best on this device for this length, and what to do next. */
export function SprintOver(p: {
  score: number;
  seconds: number;
  previousBest: number | null;
  newBest: boolean;
  cleared: boolean;
  onAgain: () => void;
  onRegular: () => void;
  onShare: () => void;
  copied: boolean;
  fallback: string | null;
}) {
  const unit = `puzzle${p.score === 1 ? "" : "s"}`;
  return (
    <div className="flex w-full flex-col items-center gap-2" data-testid="sprint-over">
      {/* Compact on purpose: the score, the badge and the best line must all sit above the sticky Play again button on a small phone. */}
      <p className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tabular-nums text-orange-600" data-testid="sprint-final-score">
          {p.score}
        </span>
        <span className="text-sm font-medium">
          {unit} in {durationLabel(p.seconds)}
        </span>
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {p.newBest && p.previousBest !== null && (
          <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white" data-testid="sprint-new-best">
            New best! Was {p.previousBest}
          </span>
        )}
        <p className="font-mono text-xs opacity-70" data-testid="sprint-best-line">
          {p.score === 0
            ? "No puzzle finished this time. Go again."
            : p.newBest
              ? `Best for ${durationLabel(p.seconds)}: ${p.score}`
              : p.previousBest === null
                ? `First ${durationLabel(p.seconds)} run. Best to beat: ${p.score}`
                : `Best for ${durationLabel(p.seconds)}: ${p.previousBest}`}
        </p>
      </div>
      <button
        onClick={p.onAgain}
        autoFocus
        className="sticky bottom-3 z-10 mt-1 min-h-12 w-full rounded-xl bg-orange-500 px-4 py-3 text-lg font-semibold text-white shadow-lg"
        data-testid="sprint-again"
      >
        Play again
      </button>
      {p.score > 0 && (
        <button onClick={p.onShare} className="min-h-11 w-full rounded-lg border border-foreground/30 px-4 py-2" data-testid="share">
          {p.copied ? "Link copied" : "Share score"}
        </button>
      )}
      {p.fallback && (
        <code className="select-all break-all rounded-md bg-foreground/10 px-3 py-1.5 text-xs" data-testid="share-fallback">
          {p.fallback}
        </code>
      )}
      <button onClick={p.onRegular} className="min-h-11 w-full rounded-lg border border-foreground/30 px-4 py-2" data-testid="sprint-regular">
        Back to Regular
      </button>
    </div>
  );
}
