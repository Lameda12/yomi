"use client";

import { useEffect, useRef } from "react";
import {
  EXTREME_SPEED, GREEN, ORANGE, PULSE, ROSE, makeShapes, mixRgb, mulberry32, pulseHz, shapeAlpha, spawnBurst, stepParticles, stepShapes, warning,
  type Particle, type Rgb, type Shape,
} from "@/lib/background";

export interface BgEvent {
  kind: "win" | "timeout";
  id: number; // changes for every event, so the same kind twice in a row still fires
}

// Cheap frame timing, so the "under 2 ms a frame" claim can be checked in a real browser.
interface Perf {
  mode: "animated" | "static";
  running: boolean;
  frames: number;
  totalMs: number;
  maxMs: number;
}
declare global {
  interface Window {
    __yomiBgPerf?: Perf;
  }
}

/**
 * Original animated background behind the game: 3 parallax layers of squares, triangles and lines in Yomi's palette.
 * Regular: slow and faint. Extreme: faster, a pulse that quickens as the clock runs down, and a shift toward the warning
 * colour in the last 20%. A win throws a short burst, a timeout flashes. With prefers-reduced-motion it is drawn once and
 * stays still. requestAnimationFrame only, paused while the tab is hidden, device pixel ratio capped at 2.
 */
export default function GameBackground({ extreme, urgency, event }: { extreme: boolean; urgency: number; event: BgEvent | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ extreme, urgency });
  const pending = useRef<BgEvent | null>(null);

  useEffect(() => {
    live.current = { extreme, urgency };
  });
  useEffect(() => {
    if (event) pending.current = event;
  }, [event]);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const rnd = mulberry32(11);
    const perf: Perf = (window.__yomiBgPerf = { mode: "animated", running: false, frames: 0, totalMs: 0, maxMs: 0 });

    let w = 0, h = 0, dpr = 1;
    let shapes: Shape[] = [];
    let particles: Particle[] = [];
    let flash = 0;
    let phase = 0;
    let raf = 0;
    let last = 0;
    let lastEvent = -1;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const draw = (isExtreme: boolean, urg: number, pulse: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const text: Rgb = dark.matches ? [237, 237, 237] : [23, 23, 23];
      const warn = isExtreme ? warning(urg) : 0;
      const accent = mixRgb(ORANGE, ROSE, warn);
      const neutral = mixRgb(text, ROSE, warn * 0.6);
      for (const s of shapes) {
        const a = shapeAlpha(s.layer, isExtreme, pulse);
        const c = s.accent ? accent : neutral;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.strokeStyle = ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        ctx.lineWidth = s.layer === 2 ? 1.5 : 1.25;
        if (s.kind === "square") {
          ctx.strokeRect(-s.size / 2, -s.size / 2, s.size, s.size);
        } else if (s.kind === "triangle") {
          ctx.beginPath();
          ctx.moveTo(0, -s.size * 0.58);
          ctx.lineTo(s.size * 0.5, s.size * 0.29);
          ctx.lineTo(-s.size * 0.5, s.size * 0.29);
          ctx.closePath();
          if (s.accent) ctx.fill();
          else ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(-s.size / 2, 0);
          ctx.lineTo(s.size / 2, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const p of particles) {
        const c = p.green ? GREEN : ORANGE;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(p.life / p.max) * 0.55})`;
        if (p.kind === "square") ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        else {
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.6);
          ctx.lineTo(p.size * 0.5, p.size * 0.3);
          ctx.lineTo(-p.size * 0.5, p.size * 0.3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      if (flash > 0) {
        ctx.fillStyle = `rgba(${ROSE[0]},${ROSE[1]},${ROSE[2]},${0.22 * flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const t0 = performance.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const { extreme: isExtreme, urgency: urg } = live.current;
      const ev = pending.current;
      if (ev && ev.id !== lastEvent) {
        lastEvent = ev.id;
        pending.current = null;
        if (ev.kind === "win") particles = particles.concat(spawnBurst(w, h, rnd));
        else flash = 1;
      }
      stepShapes(shapes, dt, w, h, isExtreme ? EXTREME_SPEED : 1);
      particles = stepParticles(particles, dt);
      flash = Math.max(0, flash - dt / 0.35);
      phase += dt * 2 * Math.PI * pulseHz(urg, isExtreme);
      draw(isExtreme, urg, 1 + PULSE * Math.sin(phase));
      const ms = performance.now() - t0;
      perf.frames++;
      perf.totalMs += ms;
      if (ms > perf.maxMs) perf.maxMs = ms;
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      perf.running = false;
    };
    const run = () => {
      if (raf || document.hidden || reduced.matches) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
      perf.running = true;
    };

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2); // never more than 2x: a 3x phone would draw 2.25x the pixels
      const nw = window.innerWidth, nh = window.innerHeight;
      if (!shapes.length || nw !== w || Math.abs(nh - h) > 120) shapes = makeShapes(nw, nh);
      w = nw;
      h = nh;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      if (reduced.matches) draw(false, 0, 1); // a canvas resize clears it: a still background is repainted
    };

    // Reduced motion: one still frame, no loop, no bursts, no flashes.
    const mode = () => {
      stop();
      particles = [];
      flash = 0;
      perf.mode = reduced.matches ? "static" : "animated";
      if (reduced.matches) draw(false, 0, 1);
      else run();
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(size, 150);
    };
    const onVisibility = () => (document.hidden ? stop() : run());

    size();
    mode();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", mode);
    dark.addEventListener("change", mode);
    return () => {
      stop();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", mode);
      dark.removeEventListener("change", mode);
    };
  }, []);

  return <canvas ref={canvas} aria-hidden="true" data-testid="game-bg" className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
