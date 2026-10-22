// Daily streak, kept on the player's device only (a list of local calendar days they solved something).
// No server round trip and nothing new is collected, so the anonymous-data rule still holds.

/** Local calendar day as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The day `back` days before `today`. Built from calendar parts so DST shifts cannot skip or repeat a day. */
export function daysBefore(today: Date, back: number): string {
  return localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back));
}

export interface StreakState {
  count: number; // consecutive solved days; 0 if the streak has lapsed
  doneToday: boolean;
  atRisk: boolean; // alive from yesterday but nothing solved yet today
  week: boolean[]; // last 7 days, oldest first, last entry is today
}

export function streakState(solvedDays: string[], today: Date): StreakState {
  const days = new Set(solvedDays);
  const doneToday = days.has(daysBefore(today, 0));
  // A streak stays alive until the end of today: count back from yesterday when today is still open.
  let back = doneToday ? 0 : 1;
  let count = 0;
  while (days.has(daysBefore(today, back))) {
    count++;
    back++;
  }
  const week = Array.from({ length: 7 }, (_, i) => days.has(daysBefore(today, 6 - i)));
  return { count, doneToday, atRisk: !doneToday && count > 0, week };
}

export function addDay(solvedDays: string[], today: Date): string[] {
  const d = localDay(today);
  if (solvedDays.includes(d)) return solvedDays;
  // Bounded so localStorage cannot grow forever; a streak past a year still reads correctly.
  return [...solvedDays, d].sort().slice(-400);
}
