/**
 * Keep the first row per solve_id, so a retried POST counts once.
 * Rows without a solve_id (logged before ids existed) are all kept.
 */
export function dedupeBySolveId<T extends { solve_id?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.solve_id) return true;
    if (seen.has(r.solve_id)) return false;
    seen.add(r.solve_id);
    return true;
  });
}
