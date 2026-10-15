import { createHash, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";

const COLUMNS = [
  "id", "created_at", "player_id", "puzzle_id", "grid_size", "n_dots", "device", "started_at_ms",
  "ended_at_ms", "solve_ms", "completed", "events", "backtracks", "max_pause_ms", "stuck_cell",
  "played_zip_before",
] as const;
const PAGE = 500;

// Hash both sides so the comparison is constant-time even when lengths differ.
const digest = (s: string) => createHash("sha256").update(s).digest();

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const admin = process.env.ADMIN_TOKEN;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!admin || !timingSafeEqual(digest(token), digest(admin))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) return Response.json({ error: "storage not configured" }, { status: 503 });

  const enc = new TextEncoder();
  let lastId = 0;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    // One page of rows per pull keeps memory flat however many solves there are.
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(enc.encode(COLUMNS.join(",") + "\n"));
        }
        const rows = await sql`select * from solves where id > ${lastId} order by id limit ${PAGE}`;
        if (rows.length === 0) return controller.close();
        lastId = Number(rows[rows.length - 1].id);
        controller.enqueue(
          enc.encode(rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(",")).join("\n") + "\n"),
        );
        if (rows.length < PAGE) controller.close();
      } catch (err) {
        console.error("[export] database error:", err instanceof Error ? err.message : err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="yomi_solves.csv"',
      "cache-control": "no-store",
    },
  });
}
