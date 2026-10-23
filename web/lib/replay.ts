import type { GameEvent } from "./stuck.ts";
import { isSolved, type Cell, type Dot } from "./zip.ts";

export interface Replay {
  path: Cell[];
  completed: boolean;
  backtracks: number;
  solveMs: number; // ms from first move to last move
}

export interface ReplayStep {
  t: number; // ms since the first move
  path: Cell[];
}

/**
 * Rebuild an attempt from its event log, so the server never trusts the client's
 * solve time, backtrack count or "completed" flag.
 *
 * Mirrors ZipGame: the path starts on dot 1; an event with a longer path is an
 * extension along one straight line from the old head (fast drags add several
 * cells at once); a shorter path is an undo or clear back to an earlier cell.
 * Backtracks count undo episodes (consecutive undos count once).
 *
 * Returns null when the log cannot come from a real game: time going backwards,
 * diagonal or overlong jumps, revisited cells, dots out of order, or an undo
 * whose head is not on the path.
 *
 * Pass `steps` to also get the path after every event (the first entry is the start, t = 0), for drawing a replay.
 */
export function replay(n: number, dots: Dot[], events: GameEvent[], steps?: ReplayStep[]): Replay | null {
  const one = dots.find((d) => d[2] === 1);
  if (!one) return null;
  const labelAt = new Map(dots.map(([r, c, v]) => [r * n + c, v]));
  const path: Cell[] = [[one[0], one[1]]];
  let backtracks = 0;
  let lastWasUndo = false;
  let prevT = 0;
  steps?.push({ t: 0, path: path.slice() });

  for (const [t, r, c, len] of events) {
    if (t < prevT || r < 0 || r >= n || c < 0 || c >= n) return null;
    prevT = t;

    if (len > path.length) {
      const [hr, hc] = path[path.length - 1];
      if (r !== hr && c !== hc) return null;
      if (Math.abs(r - hr) + Math.abs(c - hc) !== len - path.length) return null;
      const visited = new Set(path.map(([pr, pc]) => pr * n + pc));
      let nextLabel = 1 + path.filter(([pr, pc]) => labelAt.has(pr * n + pc)).length;
      const dr = Math.sign(r - hr), dc = Math.sign(c - hc);
      let qr = hr, qc = hc;
      while (path.length < len) {
        qr += dr;
        qc += dc;
        const key = qr * n + qc;
        const label = labelAt.get(key);
        if (visited.has(key) || (label !== undefined && label !== nextLabel)) return null;
        if (label !== undefined) nextLabel++;
        visited.add(key);
        path.push([qr, qc]);
      }
      lastWasUndo = false;
    } else if (len < path.length) {
      const [pr, pc] = path[len - 1];
      if (pr !== r || pc !== c) return null;
      path.length = len;
      if (!lastWasUndo) backtracks++;
      lastWasUndo = true;
    } else {
      return null; // the game only logs real changes
    }
    steps?.push({ t, path: path.slice() });
  }

  return {
    path,
    completed: isSolved(n, dots, path),
    backtracks,
    solveMs: events.length ? events[events.length - 1][0] : 0,
  };
}
