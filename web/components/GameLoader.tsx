"use client";

import dynamic from "next/dynamic";
import type { Predictions } from "@/lib/predict";
import type { PublicPuzzle } from "./ZipGame";

// The game reads progress from localStorage, so it only renders in the browser.
const ZipGame = dynamic(() => import("./ZipGame"), { ssr: false });

export default function GameLoader(props: { puzzles: PublicPuzzle[]; coreCount: number; predictions: Predictions | null }) {
  return <ZipGame {...props} />;
}
