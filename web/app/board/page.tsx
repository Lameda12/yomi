import type { Metadata } from "next";
import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";

export const metadata: Metadata = {
  title: "Most Unpredictable at Dal · Yomi",
  description: "Whose solve times are hardest to predict? Ranked against the crowd, and against Yomi once it predicts time.",
};

export default function BoardPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Most Unpredictable <span className="text-orange-500">at Dal</span>
          </h1>
          <Link href="/" className="text-sm opacity-60 hover:opacity-100">
            ← play
          </Link>
        </div>
      </header>
      <Leaderboard />
    </main>
  );
}
