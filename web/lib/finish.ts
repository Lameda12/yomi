// The finish effect: a short spark burst from the cell where the path ended. Pure helpers, shared with the canvas
// component. Full on a win, subtle when an Extreme grid was finished after the clock, none when the clock ran out.
import { stepParticles, type Particle } from "./background.ts";

export type FinishKind = "full" | "subtle";
export type Outcome = "win" | "late" | "timeout";

export const MAX_LIFE = 0.85; // seconds: every particle is gone well before one second

export function finishKind(outcome: Outcome): FinishKind | null {
  return outcome === "win" ? "full" : outcome === "late" ? "subtle" : null;
}

/** Sparks flying out of `origin` (canvas pixels). `scale` is the board size over 343 px, so small phones get small sparks. */
export function spawnSparks(origin: [number, number], kind: FinishKind, rnd: () => number, scale = 1): Particle[] {
  const full = kind === "full";
  const count = full ? 22 : 8;
  return Array.from({ length: count }, () => {
    const angle = rnd() * Math.PI * 2;
    const speed = (full ? 90 + rnd() * 170 : 45 + rnd() * 75) * scale;
    const life = full ? 0.5 + rnd() * (MAX_LIFE - 0.5) : 0.4 + rnd() * 0.2;
    return {
      x: origin[0],
      y: origin[1],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30 * scale,
      life,
      max: life,
      size: (full ? 4 + rnd() * 5 : 3 + rnd() * 2) * scale,
      rot: rnd() * Math.PI * 2,
      vr: (rnd() - 0.5) * 8,
      kind: rnd() < 0.5 ? ("square" as const) : ("triangle" as const),
      green: rnd() < 0.5,
    };
  });
}

/** Seconds until every spark is gone when stepped at `fps`, for tests and a safety cap. */
export function burstDuration(ps: Particle[], fps = 60): number {
  let live = ps.map((p) => ({ ...p }));
  let t = 0;
  while (live.length && t < 5) {
    live = stepParticles(live, 1 / fps);
    t += 1 / fps;
  }
  return t;
}
