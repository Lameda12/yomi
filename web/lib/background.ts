// Pure maths for the animated game background: shapes, drift, pulse, colour, bursts. No DOM, so it can be tested.
// Original art: squares, triangles and lines in Yomi's own orange / neutral palette. Nothing here is borrowed.

export type Kind = "square" | "triangle" | "line";
export type Rgb = [number, number, number];

export interface Shape {
  kind: Kind;
  layer: 0 | 1 | 2; // 0 far and slowest, 2 near and fastest: that is the parallax
  x: number;
  y: number;
  size: number;
  rot: number;
  vr: number; // rotation speed, rad/s
  vx: number; // drift, px/s at regular speed
  vy: number;
  accent: boolean; // orange; otherwise the neutral text colour
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds left
  max: number;
  size: number;
  rot: number;
  vr: number;
  kind: "square" | "triangle";
  green: boolean;
}

// Per layer: how many shapes, their kind, size range, drift speed (px/s) and the base alpha. Kept very low so the
// grid, the text and the buttons stay the focus.
export const LAYERS = [
  { count: 7, kind: "square" as const, size: [120, 220], speed: 6, alpha: 0.05 },
  { count: 9, kind: "triangle" as const, size: [46, 90], speed: 11, alpha: 0.055 },
  { count: 12, kind: "line" as const, size: [60, 140], speed: 18, alpha: 0.07 },
];

export const EXTREME_SPEED = 2.4; // extreme drifts this much faster
export const EXTREME_ALPHA = 1.4; // and is a little more present
export const PULSE = 0.2; // the pulse swings alpha by +-20%
export const MAX_ALPHA = Math.max(...LAYERS.map((l) => l.alpha)) * EXTREME_ALPHA * (1 + PULSE); // one shape, pulse at its peak
export const ORANGE: Rgb = [249, 115, 22];
export const ROSE: Rgb = [225, 29, 72]; // the warning colour (the same rose the game uses for "stuck")
export const GREEN: Rgb = [22, 163, 74];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeShapes(w: number, h: number, seed = 7): Shape[] {
  const rnd = mulberry32(seed);
  const out: Shape[] = [];
  LAYERS.forEach((L, i) => {
    for (let n = 0; n < L.count; n++) {
      const angle = -Math.PI / 4 + (rnd() - 0.5) * 0.9; // mostly up and to the right
      out.push({
        kind: L.kind,
        layer: i as 0 | 1 | 2,
        x: rnd() * w,
        y: rnd() * h,
        size: L.size[0] + rnd() * (L.size[1] - L.size[0]),
        rot: rnd() * Math.PI * 2,
        vr: (rnd() - 0.5) * 0.12,
        vx: Math.cos(angle) * L.speed * (0.7 + rnd() * 0.6),
        vy: Math.sin(angle) * L.speed * (0.7 + rnd() * 0.6),
        accent: rnd() < 0.55,
      });
    }
  });
  return out;
}

/** Drift every shape, wrapping around the edges. `speed` is 1 for regular and EXTREME_SPEED for extreme. */
export function stepShapes(shapes: Shape[], dt: number, w: number, h: number, speed: number): void {
  for (const s of shapes) {
    const m = s.size; // wrap just outside the screen so shapes never pop in view
    s.x += s.vx * dt * speed;
    s.y += s.vy * dt * speed;
    s.rot += s.vr * dt * speed;
    if (s.x > w + m) s.x = -m;
    else if (s.x < -m) s.x = w + m;
    if (s.y > h + m) s.y = -m;
    else if (s.y < -m) s.y = h + m;
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0 until the last 20% of the clock, then 0 to 1: how far the colour has shifted toward the warning colour. */
export function warning(urgency: number): number {
  return clamp01((urgency - 0.8) / 0.2);
}

/** Pulse rate in Hz: a gentle 0.5 Hz, rising to 2.7 Hz as the clock runs out. Regular mode does not pulse. */
export function pulseHz(urgency: number, extreme: boolean): number {
  return extreme ? 0.5 + 2.2 * clamp01(urgency) : 0;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

/** Alpha of one shape, including the extreme boost and the pulse (pulse is a value around 1, e.g. 0.8 to 1.2). */
export function shapeAlpha(layer: 0 | 1 | 2, extreme: boolean, pulse: number): number {
  return LAYERS[layer].alpha * (extreme ? EXTREME_ALPHA : 1) * (extreme ? pulse : 1);
}

export function spawnBurst(w: number, h: number, rnd: () => number, count = 28): Particle[] {
  return Array.from({ length: count }, () => {
    const angle = rnd() * Math.PI * 2;
    const speed = 120 + rnd() * 220;
    const life = 0.55 + rnd() * 0.3;
    return {
      x: w / 2,
      y: h * 0.42,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life,
      max: life,
      size: 6 + rnd() * 10,
      rot: rnd() * Math.PI * 2,
      vr: (rnd() - 0.5) * 8,
      kind: rnd() < 0.5 ? "square" : "triangle",
      green: rnd() < 0.45,
    };
  });
}

/** Move the particles on and drop the finished ones. */
export function stepParticles(ps: Particle[], dt: number): Particle[] {
  const live: Particle[] = [];
  for (const p of ps) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 220 * dt; // a little gravity
    p.vx *= 1 - 1.4 * dt;
    p.rot += p.vr * dt;
    live.push(p);
  }
  return live;
}
