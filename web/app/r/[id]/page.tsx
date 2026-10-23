import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { clock } from "@/lib/clock";
import { PUZZLES } from "@/lib/puzzles";
import { clockLine, predictionLine, resultLine } from "@/lib/share";
import { getSharedSolve } from "@/lib/store";

type Props = { params: Promise<{ id: string }> };

// A share page is read-only and shows only what the server stored for that solve. Never indexed.
async function load(params: Props["params"]) {
  const { id } = await params;
  await connection(); // read the solve fresh on every request
  try {
    return await getSharedSolve(id);
  } catch {
    return null; // storage trouble: the page shows "not found" instead of an error
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await load(params);
  if (!s) return { title: "Yomi", robots: { index: false } };
  const title = `${clock(s.solve_ms)} on a ${s.grid_size}×${s.grid_size}. Can you beat it?`;
  const description = resultLine(s);
  return { title, description, robots: { index: false }, openGraph: { title, description, type: "website", siteName: "Yomi" } };
}

export default function SharePage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight">
        Yomi <span className="text-orange-500">読み</span>
      </h1>
      <Suspense fallback={<p className="text-sm opacity-60">Loading result…</p>}>
        <Result params={params} />
      </Suspense>
    </main>
  );
}

async function Result({ params }: Props) {
  const s = await load(params);
  if (!s) notFound();
  const number = PUZZLES.findIndex((p) => p.id === s.puzzle_id) + 1;
  const pred = predictionLine(s);
  const clk = clockLine(s);
  return (
    <section className="flex w-full flex-col items-center gap-4 rounded-2xl border border-foreground/20 p-6 text-center" data-testid="shared-result">
      <p className="font-mono text-xs opacity-70">
        {number > 0 ? `Puzzle #${number} · ` : ""}
        {s.grid_size}×{s.grid_size}
        {s.mode === "extreme" ? " · Extreme ⚡" : ""}
      </p>
      <p className="font-mono text-6xl font-bold tabular-nums" data-testid="shared-time">
        {clock(s.solve_ms)}
      </p>
      <p className="text-sm">{resultLine(s)}</p>
      {pred && <p className="text-sm opacity-80">{pred}</p>}
      {clk && <p className="text-sm font-semibold text-green-600">{clk}</p>}
      <Link href="/" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-3 text-lg font-semibold text-white">
        Can you beat it? Play
      </Link>
      <p className="text-xs opacity-60">Time and backtracks are recorded by Yomi from the actual moves.</p>
    </section>
  );
}
