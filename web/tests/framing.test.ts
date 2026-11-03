// The one-line framing above the game, and the docs that must keep saying what the target is and is not.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the home page states the question once, above the game", () => {
  const page = read("../app/page.tsx");
  const text = "What makes a puzzle hard for a person? Play today&apos;s Yomi and help us find out.";
  assert.equal(page.split(text).length - 1, 1);
  assert.ok(page.indexOf(text) < page.indexOf("<GameLoader"), "it sits above the board, not in the way of it");
});

test("the README separates what works from what is not validated, and labels the peer feedback as qualitative", () => {
  const readme = read("../../README.md");
  for (const h of ["## The problem", "## What I built", "## What works today", "## What is not validated yet", "## Presentation feedback", "## Seven-day playtest"]) assert.ok(readme.includes(h), h);
  const feedback = readme.slice(readme.indexOf("## Presentation feedback"), readme.indexOf("## Seven-day playtest"));
  assert.match(feedback, /Qualitative classroom feedback/);
  assert.match(feedback, /not a user study/);
  assert.doesNotMatch(feedback, /["“”]/, "paraphrased, no direct quotes or testimonials");
  assert.match(readme, /not an ML prediction/i);
  assert.match(readme, /not a human solve time/i);
  assert.match(readme, /only when a model trained on human solve times is actually deployed/);
});

test("the playtest doc has the three definitions, the limits, and the two questions word for word", () => {
  const doc = read("../../PLAYTEST.md");
  for (const must of [
    "**Participant:** a distinct player id with at least one completed daily in the window.",
    "**Return player:** a participant who completed dailies on at least two distinct days",
    "**Daily completion:** completed daily attempts divided by all recorded daily attempts in the window.",
    "A player id is a browser, not a person.",
    "A recorded attempt is not a visit.",
    "Abandoned attempts may be missing.",
    "Server dates are not the daily's date.",
    "\"What did you think the target above the puzzle meant?\"",
    "\"What would make you come back tomorrow?\"",
  ]) assert.ok(doc.includes(must), must);
  assert.doesNotMatch(doc, /[—–]/);
});
