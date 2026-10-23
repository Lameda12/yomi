import assert from "node:assert/strict";
import { test } from "node:test";
import { anonName } from "../lib/anon.ts";

test("anonName is a stable four-hex label that never contains the id", () => {
  assert.match(anonName("p2"), /^Anon [0-9a-f]{4}$/);
  assert.equal(anonName("p2"), anonName("p2"));
  assert.notEqual(anonName("p2"), anonName("p3"));
  assert.ok(!anonName("player-with-a-long-id").includes("player"));
});
