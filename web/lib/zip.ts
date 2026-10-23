// Zip-style path puzzles: port of the generator in ../../prep_datasets.py.
// A puzzle is an n x n grid with numbered dots; the solution is the one
// Hamiltonian path that starts at dot 1 and visits the dots in order.

export type Cell = [row: number, col: number];
export type Dot = [row: number, col: number, label: number];

export interface ZipPuzzle {
  id: string;
  n: number;
  dots: Dot[];
  solution: Cell[];
  features: { n_dots: number; max_gap: number; mean_gap: number; turns: number };
}

export type Rng = () => number;

const DIRS: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Small seeded PRNG so the static puzzle file is reproducible. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: Rng, n: number) => Math.floor(rng() * n);

function shuffle<T>(xs: T[], rng: Rng): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** Random Hamiltonian path on an n x n grid via Warnsdorff-style DFS. */
export function randomHamiltonianPath(n: number, rng: Rng): Cell[] | null {
  const total = n * n;
  const seen = new Uint8Array(total);
  const start: Cell = [randInt(rng, n), randInt(rng, n)];
  const path: Cell[] = [start];
  seen[start[0] * n + start[1]] = 1;

  const nbrs = ([r, c]: Cell): Cell[] => {
    const out: Cell[] = [];
    for (const [dr, dc] of DIRS) {
      const qr = r + dr, qc = c + dc;
      if (qr >= 0 && qr < n && qc >= 0 && qc < n && !seen[qr * n + qc]) out.push([qr, qc]);
    }
    return out;
  };

  let steps = 0;
  const dfs = (): boolean => {
    if (++steps > 200_000) return false;
    if (path.length === total) return true;
    // Shuffle, then stable-sort so ties between equally constrained cells stay random.
    const cand = shuffle(nbrs(path[path.length - 1]), rng)
      .map((q) => ({ q, exits: nbrs(q).length }))
      .sort((a, b) => a.exits - b.exits); // fewest exits first
    for (const { q } of cand) {
      path.push(q);
      seen[q[0] * n + q[1]] = 1;
      if (dfs()) return true;
      path.pop();
      seen[q[0] * n + q[1]] = 0;
    }
    return false;
  };

  return dfs() ? path : null;
}

/**
 * Count paths (capped) that start at dot 1, cover every cell, and hit the dots
 * in order. Returns -1 if the search budget runs out.
 */
export function countSolutions(n: number, dots: Dot[], cap = 2, budget = 300_000): number {
  const { count, steps } = searchSolutions(n, dots, cap, budget);
  return steps > budget ? -1 : count;
}

/**
 * Search steps of the uniqueness solver (cap 2, same search as countSolutions). Matches `solver_steps`
 * in ml/features.py: if the budget runs out it returns budget + 1, not the true effort.
 */
export function solverSteps(n: number, dots: Dot[], budget = 300_000): number {
  return searchSolutions(n, dots, 2, budget).steps;
}

function searchSolutions(n: number, dots: Dot[], cap: number, budget: number): { count: number; steps: number } {
  const total = n * n;
  const label = new Int16Array(total); // 0 = no dot
  let start = -1;
  for (const [r, c, v] of dots) {
    label[r * n + c] = v;
    if (v === 1) start = r * n + c;
  }
  if (start < 0) return { count: 0, steps: 0 };
  const k = dots.length;
  const seen = new Uint8Array(total);
  seen[start] = 1;
  let count = 0, steps = 0;

  const dfs = (p: number, nxt: number, visited: number): boolean => {
    if (++steps > budget) return true;
    if (visited === total) {
      if (nxt > k) count++;
      return count >= cap;
    }
    const r = Math.floor(p / n), c = p % n;
    for (const [dr, dc] of DIRS) {
      const qr = r + dr, qc = c + dc;
      if (qr < 0 || qr >= n || qc < 0 || qc >= n) continue;
      const q = qr * n + qc;
      if (seen[q]) continue;
      const l = label[q];
      if (l !== 0 && l !== nxt) continue;
      seen[q] = 1;
      if (dfs(q, l === nxt ? nxt + 1 : nxt, visited + 1)) return true;
      seen[q] = 0;
    }
    return false;
  };

  dfs(start, 2, 1);
  return { count, steps };
}

/** One unique-solution puzzle, or null if this attempt did not converge. */
export function generatePuzzle(n: number, rng: Rng, id: string): ZipPuzzle | null {
  const path = randomHamiltonianPath(n, rng);
  if (!path) return null;
  const last = path.length - 1;

  // Start sparse, then add waypoints from the hidden path until the solution
  // is unique (each added dot shrinks the search a lot).
  const interior = shuffle(Array.from({ length: last - 1 }, (_, i) => i + 1), rng);
  const chosen = new Set<number>([0, last, ...interior.slice(0, n - 2)]);
  const free = interior.slice(n - 2);

  let idx: number[] = [];
  let dots: Dot[] = [];
  for (;;) {
    idx = [...chosen].sort((a, b) => a - b);
    dots = idx.map((i, j) => [path[i][0], path[i][1], j + 1]);
    if (countSolutions(n, dots, 2, 60_000) === 1) break;
    if (free.length === 0 || chosen.size > n + 8) return null;
    chosen.add(free.pop()!);
  }

  const gaps = idx.slice(1).map((v, j) => v - idx[j]);
  let turns = 0;
  for (let i = 1; i < last; i++) {
    const inR = path[i][0] - path[i - 1][0], inC = path[i][1] - path[i - 1][1];
    const outR = path[i + 1][0] - path[i][0], outC = path[i + 1][1] - path[i][1];
    if (inR !== outR || inC !== outC) turns++;
  }

  return {
    id,
    n,
    dots,
    solution: path,
    features: {
      n_dots: dots.length,
      max_gap: Math.max(...gaps),
      mean_gap: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) / 100,
      turns,
    },
  };
}

/** True if `path` is a full valid solution for the puzzle (used client- and server-side). */
export function isSolved(n: number, dots: Dot[], path: Cell[]): boolean {
  if (path.length !== n * n) return false;
  const label = new Map(dots.map(([r, c, v]) => [r * n + c, v]));
  const seen = new Set<number>();
  let nxt = 1;
  for (let i = 0; i < path.length; i++) {
    const [r, c] = path[i];
    if (r < 0 || r >= n || c < 0 || c >= n) return false;
    const key = r * n + c;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0 && Math.abs(r - path[i - 1][0]) + Math.abs(c - path[i - 1][1]) !== 1) return false;
    const l = label.get(key);
    if (l !== undefined) {
      if (l !== nxt) return false;
      nxt++;
    }
  }
  return nxt === dots.length + 1;
}

export type Move = { kind: "undo" | "extend"; path: Cell[] };

/**
 * What dragging the path head onto `target` does: undo if the cell is already on the path, otherwise extend one
 * cell at a time along a straight line (fast drags skip cells), stopping at a visited cell or a dot out of order.
 * `labelAt` maps `row * n + col` to a dot label. Null when nothing changes.
 */
export function planMove(n: number, labelAt: Map<number, number>, cur: Cell[], target: Cell): Move | null {
  const at = cur.findIndex(([r, c]) => r === target[0] && c === target[1]);
  if (at >= 0) return at < cur.length - 1 ? { kind: "undo", path: cur.slice(0, at + 1) } : null;
  const [hr, hc] = cur[cur.length - 1];
  if (hr !== target[0] && hc !== target[1]) return null; // diagonal: wait for a clear direction
  const dr = Math.sign(target[0] - hr), dc = Math.sign(target[1] - hc);
  const visited = new Set(cur.map(([r, c]) => r * n + c));
  let nextLabel = 1 + cur.filter(([r, c]) => labelAt.has(r * n + c)).length;
  const next = cur.slice();
  let r = hr, c = hc;
  while (r !== target[0] || c !== target[1]) {
    r += dr;
    c += dc;
    const key = r * n + c;
    const label = labelAt.get(key);
    if (visited.has(key) || (label !== undefined && label !== nextLabel)) break;
    if (label !== undefined) nextLabel++;
    visited.add(key);
    next.push([r, c]);
  }
  return next.length > cur.length ? { kind: "extend", path: next } : null;
}
