// Growing the daily pool without ever changing a published puzzle. A solve stored under "daily-009" refers to the board
// that was published as daily-009, so an id must keep its board for good. Pure, so the generator script and the tests
// share one rule. See scripts/generate-daily.ts.
import type { ZipPuzzle } from "./zip.ts";

const DAILY = /^daily-(\d{3})$/;
const isDaily = (p: ZipPuzzle) => DAILY.test(p.id);

/**
 * `existing` is the whole puzzle file; `generated` is the full daily list the generator would publish now (daily-001
 * onwards). Returns the new file contents: every existing entry untouched and in place, plus the generated dailies
 * beyond the ones already published. Throws, naming the first id, if the generator would give a published id a different
 * board (other options, a changed generator) or if the published ids are not daily-001, daily-002, ... in a row.
 * When nothing is beyond what is published, the result is `existing` itself.
 */
export function appendDailies(existing: readonly ZipPuzzle[], generated: readonly ZipPuzzle[]): ZipPuzzle[] {
  const published = existing.filter(isDaily);
  const want = (i: number) => `daily-${String(i + 1).padStart(3, "0")}`;
  published.forEach((p, i) => {
    if (p.id !== want(i)) throw new Error(`published dailies are not daily-001, daily-002, ... in a row: found ${p.id} where ${want(i)} belongs`);
  });
  generated.forEach((p, i) => {
    if (p.id !== want(i)) throw new Error(`generated dailies must be numbered daily-001 onwards: found ${p.id} where ${want(i)} belongs`);
  });
  const shared = Math.min(published.length, generated.length);
  for (let i = 0; i < shared; i++) {
    if (JSON.stringify(published[i]) !== JSON.stringify(generated[i])) {
      throw new Error(`${published[i].id} would change: the generator now gives that id a different board than the published one. Published puzzles are never rewritten; nothing was written.`);
    }
  }
  return generated.length > published.length ? [...existing, ...generated.slice(published.length)] : [...existing];
}
