// Applies migrations/*.sql in filename order. Run: npm run db:migrate
// Reads DATABASE_URL from the environment (npm script loads .env.neon.local, which is not read by `next dev`, so local dev stays in file mode).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon, neonConfig } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in web/.env.neon.local (e.g. `vercel env pull .env.neon.local`).");
  process.exit(1);
}
if (process.env.NEON_LOCAL_PROXY) neonConfig.fetchEndpoint = process.env.NEON_LOCAL_PROXY;

const sql = neon(url);
const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

try {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    // Neon's HTTP driver runs one statement per request; migrations are idempotent.
    const statements = readFileSync(dir + file, "utf8")
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await sql.query(statement);
    console.log(`applied ${file} (${statements.length} statements)`);
  }
} catch (err) {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
