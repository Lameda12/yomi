import GameLoader from "@/components/GameLoader";
import { loadTimeInfo } from "@/lib/model";
import { CORE_IDS, PUZZLES } from "@/lib/puzzles";

export default function Home() {
  // Solutions stay on the server; the client only needs the grid and dots.
  const publicPuzzles = PUZZLES.map(({ id, n, dots }) => ({ id, n, dots }));
  return (
    <main className="flex flex-1 flex-col items-center gap-3 px-4 py-4">
      <h1 className="text-xl font-bold tracking-tight">
        Yomi <span className="text-orange-500">読み</span>
      </h1>
      <GameLoader puzzles={publicPuzzles} coreCount={CORE_IDS.length} prediction={loadTimeInfo()} />
      <footer className="mt-auto max-w-md text-center text-xs opacity-70">
        Solves are logged anonymously for a student ML project. More in the menu.
      </footer>
    </main>
  );
}
