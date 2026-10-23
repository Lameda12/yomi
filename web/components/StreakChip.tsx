// One small counter for the daily streak, used on the main screen and the result card. Nothing when there is no streak.
export default function StreakChip({ count, atRisk }: { count: number; atRisk: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className="rounded-full bg-orange-500/15 px-2.5 py-1 font-mono text-xs text-orange-700 dark:text-orange-300"
      title={atRisk ? `${count}-day streak. Solve one today to keep it` : `${count}-day streak`}
      aria-label={`${count}-day streak${atRisk ? ", solve one today to keep it" : ""}`}
      data-testid="streak-chip"
    >
      🔥 {count}
    </span>
  );
}
