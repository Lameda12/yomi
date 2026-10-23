// Two things that rendered wrongly on a real iPhone (Safari) while looking fine in Chromium. Source-level guards so they
// do not come back; the behaviour itself was checked by measuring the rendered dots (see the PR that added this file).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
// Code only: the comments that explain these rules mention the very words the tests forbid.
const code = (rel: string) => read(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("dot numbers are centred with dy, not dominant-baseline (Safari ignores dominant-baseline and draws them too high)", () => {
  for (const f of ["components/ZipGame.tsx", "components/Tutorial.tsx"]) {
    const src = code(f);
    assert.doesNotMatch(src, /dominantBaseline|dominant-baseline/, `${f} must not use dominant-baseline`);
    assert.match(src, /dy="\.35em"/, `${f} centres the dot number with dy=".35em"`);
  }
});

test("the sprint clock text is not animated (iOS Safari leaves a stale paint behind text that changes every 100 ms in an animated layer)", () => {
  const src = code("components/ZipGame.tsx");
  const at = src.indexOf('data-testid="sprint-clock"');
  assert.ok(at > 0);
  const tag = src.slice(src.lastIndexOf("<span", at), at);
  assert.doesNotMatch(tag, /animate-|transition|will-change/, "no animation or layer promotion on the clock");
});
