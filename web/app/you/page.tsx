import type { Metadata } from "next";
import Link from "next/link";
import YourAttempts from "@/components/YourAttempts";

export const metadata: Metadata = {
  title: "Your attempts · Yomi",
  description: "Your own puzzle attempts, by board size, with a replay of each path.",
  robots: { index: false },
};

export default function YouPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Your <span className="text-orange-500">attempts</span>
          </h1>
          <Link href="/" className="text-sm opacity-60 hover:opacity-100">
            ← play
          </Link>
        </div>
        <p className="text-sm">
          What your own solving looked like. This is about you, not a ranking: nobody is compared with anybody. For patterns across everyone see{" "}
          <Link href="/stats" className="underline">What the data shows</Link>.
        </p>
      </header>
      <YourAttempts />
    </main>
  );
}
