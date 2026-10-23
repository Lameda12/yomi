"use client";

import { useState } from "react";
import { RATINGS, RATING_LABEL, type Rating } from "@/lib/difficulty";
import { getPlayerId } from "@/lib/player";

type State = { kind: "ask" } | { kind: "sending"; rating: Rating } | { kind: "done"; rating: Rating } | { kind: "failed" };

/**
 * One optional question after a saved Regular solve. Skipping is just not tapping: nothing is asked again and nothing
 * blocks "Next puzzle". The answer goes to the server for analysis, not for training the model.
 */
export default function DifficultyRating({ solveId }: { solveId: string }) {
  const [state, setState] = useState<State>({ kind: "ask" });

  const send = async (rating: Rating) => {
    setState({ kind: "sending", rating });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solve_id: solveId, player_id: getPlayerId(), rating }),
      });
      setState(res.ok ? { kind: "done", rating } : { kind: "failed" });
    } catch {
      setState({ kind: "failed" });
    }
  };

  if (state.kind === "done") {
    return (
      <p className="text-xs opacity-70" data-testid="rating-done">
        Noted: {RATING_LABEL[state.rating].toLowerCase()}. It is for analysis, not for training the model.
      </p>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-1" data-testid="rating">
      <p className="text-xs">How difficult did that puzzle feel? (optional)</p>
      <div className="flex w-full gap-2" role="group" aria-label="How difficult did that puzzle feel?">
        {RATINGS.map((r) => (
          <button
            key={r}
            onClick={() => void send(r)}
            disabled={state.kind === "sending"}
            className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-2 text-sm disabled:opacity-50"
          >
            {RATING_LABEL[r]}
          </button>
        ))}
      </div>
      {state.kind === "failed" && <p className="text-xs opacity-70">Could not save that just now. You can skip it.</p>}
    </div>
  );
}
