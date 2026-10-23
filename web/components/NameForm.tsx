"use client";

import { useEffect, useRef, useState } from "react";
import { NICKNAME_MAX, validateNickname } from "@/lib/nickname";
import { markStartDone, saveNickname, savedNickname } from "@/lib/player";

// One input, used by the start screen ("start") and by "Change name" ("change").
export default function NameForm({ variant, onDone, onCancel }: { variant: "start" | "change"; onDone: () => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const start = variant === "start";

  // Prefill the current name, and focus the input on desktop only (a phone keyboard would cover the screen).
  useEffect(() => {
    const saved = savedNickname();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which only exists after mount
    if (saved) setName(saved);
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, []);

  const finish = () => {
    markStartDone();
    onDone();
  };

  // Play / Save. A blank box on the start screen just means "no nickname".
  const submit = async () => {
    if (busy) return;
    const checked = validateNickname(name);
    if (!checked.ok) return setError(checked.error); // the server checks again; this is only for fast feedback
    if (checked.nickname === null) return start ? finish() : void (await clear());
    setBusy(true);
    setError(null);
    const out = await saveNickname(checked.nickname);
    setBusy(false);
    if (out.status === "taken" || out.status === "invalid") return setError(out.message ?? "That name did not work.");
    // "later": the name is kept on this device and retried on the next load. Never block play.
    finish();
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    const out = await saveNickname(null);
    setBusy(false);
    if (out.status === "later") return setError("Could not reach the server, try again.");
    setName("");
    finish();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-foreground/20 p-6 text-center"
    >
      {start ? (
        <>
          <h2 className="text-3xl font-bold tracking-tight">
            Yomi <span className="text-orange-500">読み</span>
          </h2>
          <p className="text-sm opacity-80">Connect the dots, fill every cell. Yomi guesses how you&apos;ll do.</p>
        </>
      ) : (
        <p className="text-sm font-semibold">Change your leaderboard name</p>
      )}

      <div className="flex w-full flex-col gap-1 text-left">
        <label htmlFor="nickname" className="sr-only">
          Nickname for the leaderboard
        </label>
        <input
          id="nickname"
          ref={input}
          value={name}
          maxLength={NICKNAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Nickname for the leaderboard"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint={start ? "go" : "done"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "nickname-error" : undefined}
          className="min-h-11 w-full rounded-lg border border-foreground/30 bg-background px-3 text-base"
        />
        {error && (
          <p id="nickname-error" role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-foreground px-6 py-2 text-background disabled:opacity-50">
          {start ? "Play" : "Save"}
        </button>
        {start ? (
          <button type="button" onClick={finish} disabled={busy} className="min-h-11 rounded-lg border border-foreground/30 px-6 py-2 disabled:opacity-50">
            Skip, play anonymously
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => void clear()} disabled={busy} className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-50">
              Go anonymous
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 flex-1 rounded-lg border border-foreground/30 px-4 py-2 disabled:opacity-50">
              Cancel
            </button>
          </div>
        )}
      </div>

      <p className="text-xs opacity-60">Anonymous. No signup. Your nickname only shows on the leaderboard.</p>
    </form>
  );
}
