// Live totals with a fallback: if the database is slow or throws, answer with the last totals we saw and say so,
// so a projector screen never hangs on a slow Neon. Pure: the loader is passed in.
export interface Totals {
  solves: number;
  players: number;
}
export interface StatsAnswer {
  solves: number | null; // null only when nothing was ever loaded
  players: number | null;
  stale: boolean; // true = remembered numbers (or none), not fresh ones
  at: number | null;
}

export function createTotalsSource(load: () => Promise<Totals>, slowMs = 1_500) {
  let lastGood: { totals: Totals; at: number } | null = null;
  return async function get(): Promise<StatsAnswer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("slow")), slowMs);
      });
      const totals = await Promise.race([load(), slow]);
      lastGood = { totals, at: Date.now() };
      return { ...totals, stale: false, at: lastGood.at };
    } catch (err) {
      console.error("[stats] falling back to cached totals:", err instanceof Error ? err.message : err);
      return lastGood
        ? { ...lastGood.totals, stale: true, at: lastGood.at }
        : { solves: null, players: null, stale: true, at: null };
    } finally {
      clearTimeout(timer);
    }
  };
}
