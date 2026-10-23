// Smooth path drawing: the line is drawn up to a length L (in cells, fractional) that eases toward the real path
// length. Pure helpers only; components/PathLine.tsx owns the requestAnimationFrame loop and the reduced-motion check.
import type { Cell } from "./zip.ts";

export const EASE_TAU = 0.04; // seconds: how quickly the drawn length closes the gap to the real one
export const MIN_SPEED = 14; // cells per second, so the last bit of an ease never crawls

/** One frame of easing from `L` toward `target`. Never overshoots; lands exactly on `target`. */
export function stepLength(L: number, target: number, dt: number): number {
  const d = target - L;
  if (d === 0) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / EASE_TAU);
  const step = Math.max(Math.abs(d) * k, MIN_SPEED * Math.max(0, dt));
  return step >= Math.abs(d) - 1e-3 ? target : L + Math.sign(d) * step;
}

/** Cell centres (in grid units) for `path` drawn up to length `L`, with a partial last segment. */
export function pathPoints(path: Cell[], L: number): [number, number][] {
  if (path.length === 0) return [];
  const len = Math.min(Math.max(L, 0), path.length - 1);
  const whole = Math.floor(len);
  const pts: [number, number][] = path.slice(0, whole + 1).map(([r, c]) => [c + 0.5, r + 0.5]);
  const frac = len - whole;
  if (frac > 1e-6 && whole + 1 < path.length) {
    const [r0, c0] = path[whole];
    const [r1, c1] = path[whole + 1];
    pts.push([c0 + 0.5 + (c1 - c0) * frac, r0 + 0.5 + (r1 - r0) * frac]);
  }
  return pts;
}

export const pointsAttr = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/**
 * The path changed to `next` while `shown` is drawn up to `L`. Returns what to keep drawing from:
 * - `next` is a prefix of `shown` (undo, reset): keep the longer line and let it retract.
 * - `next` extends or diverges: draw `next`, but never further than the part both paths share.
 * - nothing shared (a new puzzle): snap, no animation across puzzles.
 */
export function reconcile(shown: Cell[], L: number, next: Cell[]): { shown: Cell[]; L: number } {
  let c = 0;
  while (c < next.length && c < shown.length && sameCell(next[c], shown[c])) c++;
  if (c === next.length && c > 0) return { shown, L: Math.min(L, shown.length - 1) };
  if (c === 0) return { shown: next, L: next.length - 1 };
  return { shown: next, L: Math.min(L, c - 1) };
}
