"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { pathPoints, pointsAttr, reconcile, stepLength } from "@/lib/pathAnim";
import type { Cell } from "@/lib/zip";

/**
 * The drawn path. The line grows to a new head and eases back on undo instead of jumping. The game state stays the
 * source of truth: this only animates what is drawn. The polyline's points are set straight on the DOM node from a
 * requestAnimationFrame loop (no React render per frame). With prefers-reduced-motion it always snaps.
 */
export default function PathLine({ path, stroke }: { path: Cell[]; stroke: string }) {
  const line = useRef<SVGPolylineElement>(null);
  const anim = useRef({ shown: path, L: path.length - 1, target: path.length - 1, raf: 0, last: 0 });

  useLayoutEffect(() => {
    const a = anim.current;
    const draw = () => line.current?.setAttribute("points", pointsAttr(pathPoints(a.shown, a.L)));
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - a.last) / 1000); // a long gap (hidden tab) must not make a jump
      a.last = t;
      a.L = stepLength(a.L, a.target, dt);
      draw();
      if (a.L !== a.target) a.raf = requestAnimationFrame(frame);
      else {
        a.raf = 0;
        a.shown = a.shown.slice(0, a.target + 1); // a finished retract: drop the part that was undone
      }
    };

    a.target = path.length - 1;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(a.raf);
      a.raf = 0;
      a.shown = path;
      a.L = a.target;
      draw();
      return;
    }
    const r = reconcile(a.shown, a.L, path);
    a.shown = r.shown;
    a.L = r.L;
    draw();
    if (a.L !== a.target && !a.raf) {
      a.last = performance.now();
      a.raf = requestAnimationFrame(frame);
    }
  }, [path]);

  useEffect(() => () => cancelAnimationFrame(anim.current.raf), []);

  return <polyline ref={line} fill="none" stroke={stroke} strokeWidth={0.5} strokeLinecap="round" strokeLinejoin="round" />;
}
