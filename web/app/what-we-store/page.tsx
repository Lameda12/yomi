import type { Metadata } from "next";
import Link from "next/link";
import { API_SOLVE_FIELDS, DEVICE, GROUPS, LIMITS, NOT_STORED, PLAYERS, SOLVES, USES, type Origin, type StoredItem } from "@/lib/stored-data";

export const metadata: Metadata = {
  title: "What we store · Yomi",
  description: "Exactly what Yomi saves when you play, why, and what it never saves.",
};

const ORIGIN: Record<Origin, string> = { sent: "from your browser", derived: "worked out by the server from your moves", server: "added by the server" };

function Items({ items }: { items: StoredItem[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((i) => (
        <div key={i.column} className="rounded-xl border border-foreground/15 p-3">
          <dt className="flex flex-wrap items-baseline justify-between gap-2">
            <code className="font-mono text-sm font-semibold">{i.column}</code>
            <span className="text-xs opacity-60">{ORIGIN[i.origin]}</span>
          </dt>
          <dd className="mt-1 text-sm">{i.what}</dd>
          <dd className="mt-1 text-xs opacity-70">Why: {i.why}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function WhatWeStore() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            What we <span className="text-orange-500">store</span>
          </h1>
          <Link href="/" className="text-sm opacity-60 hover:opacity-100">
            ← play
          </Link>
        </div>
        <p className="text-sm">
          Yomi is a student machine-learning project. Everything it saves is below, in plain English. You never sign up, nothing asks for your email,
          and Yomi&apos;s code never reads your IP address. The only name saved is a nickname, and only if you pick one.
        </p>
        <p className="text-xs opacity-70">
          This list is checked against the real database definitions and API code by an automated test, so a new field cannot be added without it
          showing up here.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="solves">
        <h2 id="solves" className="text-lg font-semibold">
          Every time you play a puzzle
        </h2>
        <p className="text-sm opacity-80">
          One record per attempt, finished or given up. Your browser sends up to {API_SOLVE_FIELDS.length} fields (and the server checks them); the server
          works out the solve time and the rest itself, from your moves.
        </p>
        {GROUPS.map((g) => {
          const items = SOLVES.filter((i) => i.group === g.id);
          return items.length ? (
            <div key={g.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide opacity-70">{g.title}</h3>
              <Items items={items} />
            </div>
          ) : null;
        })}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="nick">
        <h2 id="nick" className="text-lg font-semibold">
          Only if you pick a nickname
        </h2>
        <Items items={PLAYERS} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="not">
        <h2 id="not" className="text-lg font-semibold">
          What we do not store
        </h2>
        <ul className="flex flex-col gap-2">
          {NOT_STORED.map((n) => (
            <li key={n.item} className="rounded-xl border border-foreground/15 p-3 text-sm">
              <span className="font-semibold">{n.item}.</span> {n.detail}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="use">
        <h2 id="use" className="text-lg font-semibold">
          What it is used for
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {USES.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="device">
        <h2 id="device" className="text-lg font-semibold">
          What stays in your browser
        </h2>
        <p className="text-sm opacity-80">Saved in your browser&apos;s local storage on this device. Clearing your site data erases it.</p>
        <dl className="flex flex-col gap-2">
          {DEVICE.map((d) => (
            <div key={d.key} className="rounded-xl border border-foreground/15 p-3 text-sm">
              <dt>
                <code className="font-mono text-xs font-semibold">{d.key}</code>
              </dt>
              <dd className="mt-1">{d.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="limits">
        <h2 id="limits" className="text-lg font-semibold">
          Honest notes
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
