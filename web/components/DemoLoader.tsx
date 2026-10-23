"use client";

import dynamic from "next/dynamic";
import type { TimeInfo } from "@/lib/predict";
import type { PublicPuzzle } from "./ZipGame";

// Reads localStorage (cached counters, progress), so it only renders in the browser.
const DemoScreen = dynamic(() => import("./DemoScreen"), { ssr: false });

export default function DemoLoader(props: { puzzles: PublicPuzzle[]; coreCount: number; prediction: TimeInfo | null }) {
  return <DemoScreen {...props} />;
}
