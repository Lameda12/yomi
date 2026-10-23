// Personal bests, kept on the player's device only (localStorage, like the streak). One best time per grid size
// and mode, so an Extreme win is never compared with a Regular one. Nothing here is sent to the server.

export const BEST_KEY = "yomi_best";

export type BestMap = Record<string, number>;

export const bestKey = (n: number, mode: "regular" | "extreme") => `${n}x${n}:${mode}`;

export interface BestResult {
  map: BestMap;
  previous: number | null; // the best before this solve; null on the first solve of this size and mode
  isNew: boolean; // beat an earlier best (a first solve sets the best but is not a "new best")
}

export function recordBest(map: BestMap, key: string, ms: number): BestResult {
  const previous = Number.isFinite(map[key]) && map[key] > 0 ? map[key] : null;
  if (!Number.isFinite(ms) || ms <= 0) return { map, previous, isNew: false };
  if (previous !== null && ms >= previous) return { map, previous, isNew: false };
  return { map: { ...map, [key]: ms }, previous, isNew: previous !== null };
}

/** Parse whatever is in storage, dropping anything that is not a positive number. */
export function parseBest(raw: string | null): BestMap {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number" && Number.isFinite(x) && x > 0));
  } catch {
    return {};
  }
}

export function readBest(): BestMap {
  try {
    return parseBest(localStorage.getItem(BEST_KEY));
  } catch {
    return {};
  }
}

export function writeBest(map: BestMap): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(map));
  } catch {}
}
