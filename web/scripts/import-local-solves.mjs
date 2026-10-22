// One-off: copy chosen rows of ../data/solves.jsonl into Neon, tagged source = 'local_import'.
// Run: node --env-file=.env.neon.local scripts/import-local-solves.mjs --ids 9,10,11 [--apply]
// Without --apply it only prints what it would insert. Only pass ids you know are real human play.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const idsArg = args[args.indexOf("--ids") + 1];
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || !idsArg || idsArg.startsWith("--")) {
  console.error("need DATABASE_URL and --ids 9,10,11");
  process.exit(1);
}
const wanted = new Set(idsArg.split(",").map(Number));
const file = fileURLToPath(new URL("../../data/solves.jsonl", import.meta.url));
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => wanted.has(r.id));

const missing = [...wanted].filter((id) => !rows.some((r) => r.id === id));
if (missing.length) throw new Error(`ids not in the file: ${missing.join(",")}`);
const noId = rows.filter((r) => !r.solve_id);
if (noId.length) throw new Error(`rows without solve_id cannot be imported safely: ${noId.map((r) => r.id).join(",")}`);

console.log(`rows to insert: ${rows.length}`);
for (const r of rows) console.log(`  local id ${r.id}  ${r.puzzle_id}  ${r.solve_ms} ms  completed=${r.completed}`);
if (!apply) {
  console.log("dry run: nothing inserted (add --apply)");
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);
let inserted = 0;
for (const r of rows) {
  const res = await sql`
    insert into solves (solve_id, created_at, player_id, puzzle_id, grid_size, n_dots, device, started_at_ms, ended_at_ms,
                        solve_ms, completed, events, backtracks, max_pause_ms, stuck_cell, played_zip_before, source)
    values (${r.solve_id}, ${r.created_at}, ${r.player_id}, ${r.puzzle_id}, ${r.grid_size}, ${r.n_dots}, ${r.device},
            ${r.started_at_ms}, ${r.ended_at_ms}, ${r.solve_ms}, ${r.completed}, ${JSON.stringify(r.events)}::jsonb,
            ${r.backtracks}, ${r.max_pause_ms}, ${r.stuck_cell ? `{${r.stuck_cell[0]},${r.stuck_cell[1]}}` : null}::int[],
            ${r.played_zip_before}, 'local_import')
    on conflict (solve_id) do nothing
    returning id`;
  inserted += res.length;
}
console.log(`inserted ${inserted} of ${rows.length} (the rest were already there)`);
