// Appends to the daily pool in the static puzzle file: daily-001, daily-002, ...
// Run: npm run gen:daily   (node >= 23 runs .ts directly)
//
// The puzzles already in data/puzzles.json are NEVER touched, the 30 originals and every daily already published.
// Stored solves reference their ids, so a changed board under an old id would corrupt the data. The script generates
// the daily list it would publish, checks that every id already in the file would get exactly the board it has, and
// only then appends the ids that are new. If anything published would change, it refuses and writes nothing.
// Rerunning with the same options is therefore a no-op, and a larger --count only appends.
//
//   --count N    how many dailies the pool should hold (default 120). Smaller than what is published: nothing is added.
//   --no-7x7     leave out the 7x7 boards. This changes the board order, so it is refused once dailies are published.
//   --file PATH  work on another copy of the puzzle file (used by the tests)
//
// Do not run scripts/generate-puzzles.ts: it rewrites the whole file and would change the existing puzzles.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendDailies } from "../lib/dailyPool.ts";
import { countSolutions, generatePuzzle, isSolved, mulberry32, type ZipPuzzle } from "../lib/zip.ts";

// Not the seed of generate-puzzles.ts (7). One generator per board size, so the boards of one size do not depend on the others.
const SEED = 20261103;

// The size of each day in a 10-day cycle: mostly 5x5 and 6x6, with a 7x7 on every tenth day.
const CYCLE_WITH_7 = [5, 6, 5, 6, 5, 6, 5, 6, 6, 7];
const CYCLE_NO_7 = [5, 6, 5, 6];

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const countArg = flag("--count");
const count = countArg === undefined ? 120 : Number(countArg);
if (!Number.isInteger(count) || count < 1) {
  console.error(`--count must be a whole number of at least 1, got ${countArg}`);
  process.exit(1);
}
const cycle = process.argv.includes("--no-7x7") ? CYCLE_NO_7 : CYCLE_WITH_7;
const sizeOfDay = (i: number) => cycle[i % cycle.length];

const file = flag("--file") ?? fileURLToPath(new URL("../data/puzzles.json", import.meta.url));
const before = readFileSync(file, "utf8");
const existing = JSON.parse(before) as ZipPuzzle[];
const originals = existing.filter((p) => !p.id.startsWith("daily-"));
if (originals.length !== 30) {
  console.error(`expected the 30 original puzzles, found ${originals.length}; refusing to continue`);
  process.exit(1);
}
const seen = new Set(originals.map((p) => JSON.stringify([p.n, p.dots])));

const started = Date.now();
const need = new Map<number, number>();
for (let i = 0; i < count; i++) need.set(sizeOfDay(i), (need.get(sizeOfDay(i)) ?? 0) + 1);

const bySize = new Map<number, ZipPuzzle[]>();
for (const [n, wanted] of [...need].sort((a, b) => a[0] - b[0])) {
  const rng = mulberry32(SEED + n);
  const made: ZipPuzzle[] = [];
  let tries = 0;
  const t0 = Date.now();
  while (made.length < wanted) {
    tries++;
    if (tries > wanted * 400) {
      console.error(`[daily] ${n}x${n}: gave up after ${tries} tries with ${made.length}/${wanted}`);
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
  console.error(`[daily] ${n}x${n}: ${made.length}/${wanted} puzzles in ${tries} tries, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const taken = new Map<number, number>();
const generated: ZipPuzzle[] = Array.from({ length: count }, (_, i) => {
  const n = sizeOfDay(i);
  const k = taken.get(n) ?? 0;
  taken.set(n, k + 1);
  return { ...bySize.get(n)![k], id: `daily-${String(i + 1).padStart(3, "0")}` };
});

let merged: ZipPuzzle[];
try {
  merged = appendDailies(existing, generated);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
if (merged.length === existing.length) {
  console.error(`nothing to add: ${existing.length - originals.length} dailies are already published and match. Nothing was written.`);
  process.exit(0);
}
const after = JSON.stringify(merged) + "\n";
// Belt and braces: the file as it was must be an exact prefix of the file as it will be.
if (!after.startsWith(before.slice(0, -2) + ",")) {
  console.error("the existing puzzles would change; refusing to write");
  process.exit(1);
}
writeFileSync(file, after);
console.error(`appended ${merged.length - existing.length} dailies (now ${merged.length - originals.length}) -> ${file} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
