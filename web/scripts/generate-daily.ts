// Appends the daily pool to the static puzzle file: daily-001 ... daily-120.
// Run: npm run gen:daily   (node >= 23 runs .ts directly)
//
// The 30 puzzles already in data/puzzles.json are NEVER touched. Stored solves reference their ids, so a changed
// puzzle would corrupt the data. This script only appends, and refuses to write if the first entries would change.
// It is deterministic: same seeds, same 120 puzzles, so running it twice writes the same file.
//
//   --no-7x7   leave out the 7x7 boards (use this if generating them is too slow on your machine)
//
// Do not run scripts/generate-puzzles.ts: it rewrites the whole file and would change the existing puzzles.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countSolutions, generatePuzzle, isSolved, mulberry32, type ZipPuzzle } from "../lib/zip.ts";

// Not the seed of generate-puzzles.ts (7). One generator per board size, so adding or dropping 7x7 never shifts the others.
const SEED = 20261103;
const DAILY_POOL_SIZE = 120;

// The size of each day in a 10-day cycle: mostly 5x5 and 6x6, with a 7x7 on every tenth day.
const CYCLE_WITH_7 = [5, 6, 5, 6, 5, 6, 5, 6, 6, 7];
const CYCLE_NO_7 = [5, 6, 5, 6];

const withSeven = !process.argv.includes("--no-7x7");
const cycle = withSeven ? CYCLE_WITH_7 : CYCLE_NO_7;
const sizeOfDay = (i: number) => cycle[i % cycle.length];

const file = fileURLToPath(new URL("../data/puzzles.json", import.meta.url));
const before = readFileSync(file, "utf8");
const existing = JSON.parse(before) as ZipPuzzle[];
const base = existing.filter((p) => !p.id.startsWith("daily-"));
if (base.length !== 30) {
  console.error(`expected the 30 original puzzles, found ${base.length}; refusing to continue`);
  process.exit(1);
}
const baseText = JSON.stringify(base);
const seen = new Set(base.map((p) => JSON.stringify([p.n, p.dots])));

const started = Date.now();
const need = new Map<number, number>();
for (let i = 0; i < DAILY_POOL_SIZE; i++) need.set(sizeOfDay(i), (need.get(sizeOfDay(i)) ?? 0) + 1);

const bySize = new Map<number, ZipPuzzle[]>();
for (const [n, count] of [...need].sort((a, b) => a[0] - b[0])) {
  const rng = mulberry32(SEED + n);
  const made: ZipPuzzle[] = [];
  let tries = 0;
  const t0 = Date.now();
  while (made.length < count) {
    tries++;
    if (tries > count * 400) {
      console.error(`[daily] ${n}x${n}: gave up after ${tries} tries with ${made.length}/${count}`);
      process.exit(1);
    }
    const p = generatePuzzle(n, rng, `tmp-${n}-${made.length}`);
    if (!p) continue;
    // Same verification as generate-puzzles.ts: the stored solution solves it, and it has exactly one solution.
    if (!isSolved(p.n, p.dots, p.solution) || countSolutions(p.n, p.dots, 2, 2_000_000) !== 1) continue;
    const key = JSON.stringify([p.n, p.dots]);
    if (seen.has(key)) continue;
    seen.add(key);
    made.push(p);
  }
  bySize.set(n, made);
  console.error(`[daily] ${n}x${n}: ${made.length}/${count} puzzles in ${tries} tries, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const taken = new Map<number, number>();
const daily: ZipPuzzle[] = Array.from({ length: DAILY_POOL_SIZE }, (_, i) => {
  const n = sizeOfDay(i);
  const k = taken.get(n) ?? 0;
  taken.set(n, k + 1);
  return { ...bySize.get(n)![k], id: `daily-${String(i + 1).padStart(3, "0")}` };
});

const after = JSON.stringify([...base, ...daily]) + "\n";
// The original entries must be byte for byte what they were.
if (!after.startsWith(baseText.slice(0, -1) + ",") || !before.startsWith(baseText.slice(0, -1))) {
  console.error("the original puzzles would change; refusing to write");
  process.exit(1);
}
writeFileSync(file, after);
console.error(`wrote ${base.length} original + ${daily.length} daily puzzles -> ${file} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
