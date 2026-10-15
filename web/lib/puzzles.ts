import "server-only";
import raw from "@/data/puzzles.json";
import type { ZipPuzzle } from "./zip";

// Every visitor plays these three first, in this order; the rest are practice.
export const CORE_IDS = ["zip-5x5-01", "zip-5x5-02", "zip-6x6-01"];

const all = raw as ZipPuzzle[];
const core = CORE_IDS.map((id) => {
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error(`core puzzle ${id} missing from data/puzzles.json`);
  return p;
});

/** Core puzzles first; a puzzle's public number is its index here + 1. */
export const PUZZLES: ZipPuzzle[] = [...core, ...all.filter((p) => !CORE_IDS.includes(p.id))];
export const PUZZLE_BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));
