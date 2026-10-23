"use client";

import { useEffect, useRef } from "react";

/**
 * Call `tick` every `ms` while the tab is visible. Hidden tab: the timer stops. Tab visible again: one
 * immediate call, then the timer resumes. Uses the Page Visibility API; no websockets.
 */
export function useLivePoll(tick: () => void, ms = 10_000) {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer ??= setInterval(() => latest.current(), ms);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        latest.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}
