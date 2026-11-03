import "server-only";
import raw from "@/data/puzzles.json";
import { isDailyId } from "./daily";
import type { ZipPuzzle } from "./zip";

// These three keep positions 1 to 3 of the practice list, as they did when they were the starting puzzles. Moving
// them would renumber every practice puzzle and change what older shared results show.
const FIRST_IDS = ["zip-5x5-01", "zip-5x5-02", "zip-6x6-01"];

const all = raw as ZipPuzzle[];
const first = FIRST_IDS.map((id) => {
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error(`puzzle ${id} missing from data/puzzles.json`);
  return p;
});

/** The original 30 puzzles. Practice mode and Extreme play these; a puzzle's practice number is its position here + 1. */
export const PRACTICE: ZipPuzzle[] = [...first, ...all.filter((p) => !isDailyId(p.id) && !FIRST_IDS.includes(p.id))];

/** The daily pool in id order: index 0 is Yomi #1 (daily-001). */
export const DAILY: ZipPuzzle[] = all.filter((p) => isDailyId(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1));

/** Everything the server knows how to check: practice first, then the dailies. */
export const PUZZLES: ZipPuzzle[] = [...PRACTICE, ...DAILY];
export const PUZZLE_BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));
