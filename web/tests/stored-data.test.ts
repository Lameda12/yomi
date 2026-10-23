// The /what-we-store page is built from lib/stored-data.ts. These tests check that list against the real code, so
// the page cannot drift from what the app does: schema, API fields, browser storage, IP/cookie/header use, analytics,
// rate limits and logging. If one fails, either the code changed (update the list and the page) or a claim stopped
// being true (fix the code, or stop making the claim).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { test } from "node:test";
import { API_PLAYER_FIELDS, API_SOLVE_FIELDS, DEVICE, GROUPS, LIMITS, NOT_STORED, PLAYERS, SOLVES, USES } from "../lib/stored-data.ts";

const root = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const files = (dir: string, exts = [".ts", ".tsx"]) =>
  (readdirSync(new URL(dir, root), { recursive: true }) as string[]).filter((f) => exts.some((e) => f.endsWith(e))).map((f) => `${dir}${f}`);
const SOURCE = [...files("app/"), ...files("lib/"), ...files("components/")].filter((f) => f !== "lib/stored-data.ts" && f !== "app/what-we-store/page.tsx");

// ---- schema ----------------------------------------------------------------------------------------------------

const sql = readdirSync(new URL("migrations/", root))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => read(`migrations/${f}`))
  .join("\n")
  .replace(/--.*$/gm, ""); // comments out

function columns(table: string): string[] {
  const out = new Set<string>();
  const create = sql.match(new RegExp(`create table (?:if not exists )?${table} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(create, `create table ${table} not found`);
  for (const line of create[1].split("\n")) {
    const first = line.trim().split(/\s+/)[0];
    if (first && /^[a-z_]+$/.test(first) && !["primary", "unique", "check", "constraint", "foreign"].includes(first)) out.add(first);
  }
  for (const a of sql.matchAll(new RegExp(`alter table ${table} add column (?:if not exists )?([a-z_]+)`, "g"))) out.add(a[1]);
  return [...out].sort();
}

test("every column of `solves` and `players` is on the page, and nothing else is", () => {
  assert.deepEqual(columns("solves"), SOLVES.map((i) => i.column).sort(), "solves columns vs the page");
  assert.deepEqual(columns("players"), PLAYERS.map((i) => i.column).sort(), "players columns vs the page");
  for (const list of [SOLVES, PLAYERS]) assert.equal(new Set(list.map((i) => i.column)).size, list.length, "no duplicates");
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const i of [...SOLVES, ...PLAYERS]) assert.ok(groups.has(i.group), `${i.column} has a known group`);
});

test("no column is named like something we claim not to store", () => {
  const forbidden = /email|(^|_)ip($|_)|address|phone|agent|geo|location|account|password|token|^name$|real_name|surname|lat$|lng$/;
  for (const c of [...columns("solves"), ...columns("players")]) assert.doesNotMatch(c, forbidden, c);
});

// ---- API --------------------------------------------------------------------------------------------------------

test("the solves API accepts exactly the fields the page lists, and nothing derived", () => {
  const src = read("app/api/solves/route.ts");
  const body = src.slice(src.indexOf("const Body = z.object({"), src.indexOf("\n});", src.indexOf("const Body = z.object({")));
  const keys = [...body.matchAll(/^ {2}([a-z_]+): /gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys.slice(), [...API_SOLVE_FIELDS].sort()); // (slice: assert.deepEqual would otherwise narrow the type of `keys`)
  // sent items are accepted fields (the prediction object carries three columns); derived and server items never are
  const viaPrediction = ["pred_value", "pred_unit", "model_version"];
  for (const i of SOLVES) {
    if (i.origin === "sent") assert.ok(keys.includes(i.column) || viaPrediction.includes(i.column), `${i.column} is sent`);
    else assert.ok(!keys.includes(i.column), `${i.column} must not be accepted from the browser`);
  }
});

test("the players API accepts exactly the fields the page lists", () => {
  const src = read("app/api/players/route.ts");
  const line = src.match(/const Body = z\.object\(\{([^}]*)\}\)/)?.[1] ?? "";
  assert.deepEqual([...line.matchAll(/(\w+): z\./g)].map((m) => m[1]).sort(), [...API_PLAYER_FIELDS].sort());
});

test("the Your attempts API takes only the anonymous id, is POST-only, and never echoes it", () => {
  const src = read("app/api/me/route.ts");
  assert.match(src, /const Body = z\.object\(\{ player_id: z\.uuid\(\) \}\)/);
  assert.ok(!/export (async )?function GET/.test(src), "the id must travel in the body, never in a URL");
  assert.match(src, /cache-control": "no-store"/);
  assert.ok(!/player_id:\s*r\.player_id/.test(src), "the response must not carry the id");
});

// ---- browser storage --------------------------------------------------------------------------------------------

test("every localStorage key in the source is listed, and every listed key exists", () => {
  const found = new Set<string>();
  for (const f of SOURCE) for (const m of read(f).matchAll(/"(yomi_[a-z_]+)"/g)) found.add(m[1]);
  assert.deepEqual([...found].sort(), DEVICE.map((d) => d.key).sort());
});

// ---- what is not stored -----------------------------------------------------------------------------------------

test("the code never reads IPs, cookies, geolocation, the user agent or request headers (except the admin token)", () => {
  const forbidden = /x-forwarded|x-real-ip|cf-connecting|remoteAddress|request\.ip|req\.ip|\.ip\b|geolocation|document\.cookie|cookies\(|set-cookie|user-agent|userAgent|fingerprint/i;
  const offenders = SOURCE.filter((f) => forbidden.test(read(f)));
  assert.deepEqual(offenders, [], `forbidden reads in: ${offenders.join(", ")}`);

  const header: string[] = [];
  for (const f of SOURCE) {
    const text = read(f);
    for (const m of text.matchAll(/\bheaders\(\)|\.headers\b(?:\.get\(["']([^"']+)["']\))?/g)) header.push(`${f}:${m[1] ?? "?"}`);
  }
  assert.deepEqual(header, ["app/api/export/route.ts:authorization"], "the only header read is the admin token on the export route");

  for (const f of ["middleware.ts", "proxy.ts", "src/middleware.ts", "src/proxy.ts"]) assert.ok(!existsSync(new URL(f, root)), `${f} would see every request`);
  assert.doesNotMatch(read("next.config.ts"), /headers\s*\(/);
});

test("no analytics or tracking packages or scripts", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.doesNotMatch(name, /analytics|gtag|google-tag|sentry|segment|mixpanel|posthog|amplitude|hotjar|fullstory|datadog|logrocket|clarity/i, name);
  }
  assert.doesNotMatch(read("app/layout.tsx"), /<script|next\/script/);
});

test("every NOT_STORED claim has a reason, and the page lists the ones this test covers", () => {
  const items = NOT_STORED.map((n) => n.item);
  for (const needle of ["Email", "account", "IP address", "Cookies", "Analytics"]) assert.ok(items.some((i) => i.includes(needle)), needle);
  for (const n of NOT_STORED) assert.ok(n.detail.length > 10, n.item);
});

// ---- limits and logging -----------------------------------------------------------------------------------------

test("the rate limits on the page are the ones in the code, keyed on the anonymous player id", () => {
  const solves = read("app/api/solves/route.ts");
  const perHour = Number(solves.match(/MAX_INSERTS_PER_HOUR = (\d+)/)?.[1]);
  assert.ok(solves.includes("recentSolveCount(b.player_id)"), "solve limit is keyed on player_id");
  const store = read("lib/store.ts");
  assert.match(store, /where player_id = \$\{playerId\} and created_at > now\(\) - interval '1 hour'/);
  const cooldown = Number(store.match(/NAME_COOLDOWN_MS = ([\d_]+)/)?.[1].replace(/_/g, "")) / 1000;
  const newPerMinute = Number(store.match(/NEW_PLAYERS_PER_MINUTE = (\d+)/)?.[1]);
  assert.ok(perHour > 0 && cooldown > 0 && newPerMinute > 0);
  const text = LIMITS.find((l) => l.startsWith("Rate limits"))!;
  assert.ok(text.includes(`${perHour} saved solves per hour`), `says ${perHour} an hour`);
  assert.ok(text.includes(`once every ${cooldown} seconds`), `says every ${cooldown} seconds`);
  assert.ok(text.includes(`${newPerMinute} new nicknames a minute`), `says ${newPerMinute} nicknames a minute`);
  assert.match(text, /not by your IP/);
});

test("the only server logging is error messages, never requests, headers or what was played", () => {
  const calls: string[] = [];
  for (const f of SOURCE) for (const line of read(f).split("\n")) if (/\bconsole\./.test(line)) calls.push(`${f}: ${line.trim()}`);
  assert.ok(calls.length > 0);
  // Each call is console.error("<fixed text>") or console.error("<fixed text>", err instanceof Error ? err.message : err):
  // a tag plus an error message, nothing taken from the request or from what was played.
  for (const c of calls) {
    assert.match(c, /console\.error\("[^"]*"(, err instanceof Error \? err\.message : err)?\);$/, c);
  }
});

test("hosting: the notes name the real providers", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.ok("@neondatabase/serverless" in pkg.dependencies, "Neon is the database");
  const hosting = LIMITS.find((l) => l.startsWith("Hosting"))!;
  assert.match(hosting, /Vercel/);
  assert.match(hosting, /Neon/);
  assert.match(hosting, /IP addresses/);
});

// ---- the copy -----------------------------------------------------------------------------------------------------

test("plain English: no empty text, no em dashes", () => {
  const all = [
    ...SOLVES.flatMap((i) => [i.what, i.why]),
    ...PLAYERS.flatMap((i) => [i.what, i.why]),
    ...DEVICE.map((d) => d.what),
    ...NOT_STORED.flatMap((n) => [n.item, n.detail]),
    ...USES,
    ...LIMITS,
    ...GROUPS.map((g) => g.title),
  ];
  for (const t of all) {
    assert.ok(t.trim().length > 3);
    assert.doesNotMatch(t, /[—–]/, t);
  }
});

test("the page says what the data trains, that training is manual, and that nobody is ranked", () => {
  const uses = USES.join(" ");
  assert.match(uses, /train the model/);
  assert.match(uses, /manual batch job/);
  assert.match(uses, /does not change while you play/);
  const all = [...SOLVES.flatMap((i) => [i.what, i.why]), ...PLAYERS.flatMap((i) => [i.what, i.why]), ...USES, ...LIMITS, ...NOT_STORED.map((n) => n.detail)].join(" ");
  assert.doesNotMatch(all, /leaderboard|Most Unpredictable|\brank/i, "there is no ranking of people any more");
});
