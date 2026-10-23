import Link from "next/link";
import ChangeName from "@/components/ChangeName";
import GameLoader from "@/components/GameLoader";
import { loadTimeInfo } from "@/lib/model";
import { CORE_IDS, PUZZLES } from "@/lib/puzzles";

export default function Home() {
  // Solutions stay on the server; the client only needs the grid and dots.
  const publicPuzzles = PUZZLES.map(({ id, n, dots }) => ({ id, n, dots }));
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Yomi <span className="text-orange-500">読み</span>
        </h1>
        <p className="text-sm opacity-60">Read the grid. One path, every cell.</p>
      </header>
      <GameLoader puzzles={publicPuzzles} coreCount={CORE_IDS.length} prediction={loadTimeInfo()} />
      <footer className="mt-auto max-w-md text-center text-xs opacity-60">
        Solves are logged anonymously (time and moves, no personal data) for a student ML project.{" "}
        <Link href="/stats" className="underline">
          See the stats
        </Link>{" "}
        ·{" "}
        <Link href="/board" className="underline">
          Most Unpredictable board
        </Link>
        .
        <div>
          <ChangeName />
        </div>
      </footer>
    </main>
  );
}
