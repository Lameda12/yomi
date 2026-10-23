import type { Metadata } from "next";
import DemoLoader from "@/components/DemoLoader";
import { loadTimeInfo } from "@/lib/model";
import { CORE_IDS, PUZZLES } from "@/lib/puzzles";

export const metadata: Metadata = { title: "Yomi live demo", robots: { index: false } };

export default function DemoPage() {
  // Same as the home page: solutions stay on the server, and a missing model just means no prediction line.
  const publicPuzzles = PUZZLES.map(({ id, n, dots }) => ({ id, n, dots }));
  return <DemoLoader puzzles={publicPuzzles} coreCount={CORE_IDS.length} prediction={loadTimeInfo()} />;
}
