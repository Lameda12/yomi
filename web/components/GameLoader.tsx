"use client";

import dynamic from "next/dynamic";
import type { PublicPuzzle } from "./ZipGame";

// The game reads progress from localStorage, so it only renders in the browser.
const ZipGame = dynamic(() => import("./ZipGame"), { ssr: false });

export default function GameLoader({ puzzles, coreCount }: { puzzles: PublicPuzzle[]; coreCount: number }) {
  return <ZipGame puzzles={puzzles} coreCount={coreCount} />;
}
