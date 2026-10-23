"use client";

import { useEffect, useRef } from "react";
import { GREEN, ORANGE, mulberry32, stepParticles, type Particle } from "@/lib/background";
import { MAX_LIFE, spawnSparks, type FinishKind } from "@/lib/finish";
import type { Cell } from "@/lib/zip";

export interface FinishEvent {
  id: number; // a new id fires the effect again
  kind: FinishKind;
  at: Cell; // where the path ended
}

/**
 * Spark burst over the board, drawn on its own canvas with requestAnimationFrame. It lives under a second, ignores
 * pointer events, and does nothing at all under prefers-reduced-motion. The canvas is cleared and the loop stops
 * when the last spark is gone.
 */
export default function FinishEffect({ event, n }: { event: FinishEvent | null; n: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!event || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    const h = el.clientHeight;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const full = event.kind === "full";
    const origin: [number, number] = [((event.at[1] + 0.5) / n) * w, ((event.at[0] + 0.5) / n) * h];
    let particles: Particle[] = spawnSparks(origin, event.kind, mulberry32(event.id), Math.min(w, h) / 343);
    const started = performance.now();
    let last = started;
    let raf = 0;

    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const age = (t - started) / 1000;
      particles = stepParticles(particles, dt);
      ctx.clearRect(0, 0, w, h);
      if (full && age < 0.4) {
        // one ring that opens from the finishing cell
        ctx.strokeStyle = `rgba(${GREEN[0]},${GREEN[1]},${GREEN[2]},${0.5 * (1 - age / 0.4)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(origin[0], origin[1], (w / n) * (0.4 + (age / 0.4) * 1.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const p of particles) {
        const c = p.green ? GREEN : ORANGE;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(p.life / p.max) * (full ? 0.95 : 0.55)})`;
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
      if (particles.length && age < MAX_LIFE + 0.1) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }, [event, n]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden="true" data-testid="finish-effect" />;
}
