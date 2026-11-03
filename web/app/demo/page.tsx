import type { Metadata } from "next";
import DemoLoader from "@/components/DemoLoader";
import { loadTimeInfo } from "@/lib/model";
import { PRACTICE } from "@/lib/puzzles";

export const metadata: Metadata = { title: "Yomi live demo", robots: { index: false } };

export default function DemoPage() {
  // Same as the home page: solutions stay on the server, and a missing model just means no prediction line.
  // The demo plays the original puzzles only: it has no daily, and it must not reveal upcoming dailies on a projector.
  const publicPuzzles = PRACTICE.map(({ id, n, dots }) => ({ id, n, dots }));
  return <DemoLoader puzzles={publicPuzzles} prediction={loadTimeInfo()} />;
}
