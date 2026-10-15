// Pre-generates the static puzzle set so the site never generates at runtime.
// Run: npm run gen:puzzles   (node >= 23 runs .ts directly)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countSolutions, generatePuzzle, isSolved, mulberry32, type ZipPuzzle } from "../lib/zip.ts";

const PER_SIZE = 15;
const SIZES = [5, 6];
const SEED = 7;

const rng = mulberry32(SEED);
const puzzles: ZipPuzzle[] = [];

for (const n of SIZES) {
  let made = 0, tries = 0;
  while (made < PER_SIZE && tries < PER_SIZE * 40) {
    tries++;
    const p = generatePuzzle(n, rng, `zip-${n}x${n}-${String(made + 1).padStart(2, "0")}`);
    if (!p) continue;
    // Re-verify with the full budget before shipping it.
    if (!isSolved(p.n, p.dots, p.solution) || countSolutions(p.n, p.dots, 2, 2_000_000) !== 1) continue;
    puzzles.push(p);
    made++;
  }
  console.error(`[zip] ${n}x${n}: ${made}/${PER_SIZE} puzzles in ${tries} tries`);
  if (made < PER_SIZE) process.exitCode = 1;
}

const out = fileURLToPath(new URL("../data/puzzles.json", import.meta.url));
writeFileSync(out, JSON.stringify(puzzles) + "\n");
console.error(`wrote ${puzzles.length} puzzles -> ${out}`);
