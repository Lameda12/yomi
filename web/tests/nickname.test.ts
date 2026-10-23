import assert from "node:assert/strict";
import { test } from "node:test";
import { NICKNAME_MAX, isProfane, nicknameKey, validateNickname } from "../lib/nickname.ts";

const ok = (raw: string | null) => {
  const r = validateNickname(raw);
  assert.ok(r.ok, `expected ok for ${JSON.stringify(raw)}`);
  return r.nickname;
};
const bad = (raw: string) => assert.equal(validateNickname(raw).ok, false, `expected rejection for ${JSON.stringify(raw)}`);

test("no nickname means anonymous: null, empty and blank all clear it", () => {
  assert.equal(ok(null), null);
  assert.equal(ok(""), null);
  assert.equal(ok("   "), null);
});

test("normal names pass and are tidied", () => {
  assert.equal(ok("Alex"), "Alex");
  assert.equal(ok("  Zoë   the  Great "), "Zoë the Great");
  assert.equal(ok("path_finder-7"), "path_finder-7");
  assert.equal(ok("Peacock"), "Peacock"); // contains a short blocked word, but only as part of a longer one
  assert.equal(ok("Analysis Ace"), "Analysis Ace");
  assert.equal(ok("Scunthorpe"), "Scunthorpe");
});

test("length: 2 to 16 characters, counted as characters not bytes", () => {
  bad("a");
  assert.equal(ok("ab"), "ab");
  assert.equal(ok("a".repeat(NICKNAME_MAX)), "a".repeat(NICKNAME_MAX));
  bad("a".repeat(NICKNAME_MAX + 1));
  assert.equal(ok("é".repeat(NICKNAME_MAX)), "é".repeat(NICKNAME_MAX));
});

test("only letters, digits, space, underscore and hyphen", () => {
  for (const name of ["hi@there", "a.b", "http://x", "emoji😀", "<b>x</b>", "a/b", "-start", " _x"]) bad(name);
  bad("Привет"); // non-Latin script: look-alikes could fake a reserved name
});

test("reserved names and the anonymous label cannot be taken, even disguised", () => {
  for (const name of ["Yomi", "ADMIN", "a d m i n", "Moderator", "Anon 7f3a", "anonymous", "Yōmi"]) bad(name);
});

test("profanity is rejected in plain, spaced, accented and leetspeak spellings", () => {
  const words = ["fuck", "shit", "bitch"];
  for (const w of words) {
    bad(w);
    bad(w.toUpperCase());
    bad(w.split("").join(" "));
    bad(w.split("").join("_"));
    bad(`xx ${w}`);
  }
  bad("sh1t");
  bad("f_u_c_k");
  bad("b!tch");
  bad("fück");
  assert.equal(isProfane("Friendly Fox"), false);
});

test("short blocked words match whole words only, so common names are not caught", () => {
  assert.equal(isProfane("dick"), true);
  assert.equal(isProfane("Dickens"), false);
  assert.equal(isProfane("cocktail"), false);
  assert.equal(isProfane("grape"), false);
  assert.equal(isProfane("rape"), true);
});

test("nicknameKey makes names compare case-insensitively", () => {
  assert.equal(nicknameKey("Pathfinder"), nicknameKey("pathFINDER"));
  assert.notEqual(nicknameKey("Zig"), nicknameKey("Zag"));
});
