// One entry per path change: [ms since first move, head row, head col, path length].
export type GameEvent = [t: number, row: number, col: number, len: number];

/**
 * Stuck cell = where the path head sat during the longest pause before the next move.
 * Shared by the client (highlight) and the server (stored columns).
 */
export function findStuck(events: GameEvent[]): { cell: [number, number] | null; maxPauseMs: number | null } {
  let cell: [number, number] | null = null;
  let maxPauseMs: number | null = null;
  for (let i = 0; i + 1 < events.length; i++) {
    const gap = events[i + 1][0] - events[i][0];
    if (maxPauseMs === null || gap > maxPauseMs) {
      maxPauseMs = gap;
      cell = [events[i][1], events[i][2]];
    }
  }
  return { cell, maxPauseMs };
}
