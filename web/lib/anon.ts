// A stable anonymous label for a player who has no nickname. Server code only (node:crypto).
import { createHash } from "node:crypto";

/** The last 4 hex digits of a hash of the id. Identifies nobody, and never shows the raw id. */
export function anonName(playerId: string): string {
  return `Anon ${createHash("sha256").update(playerId).digest("hex").slice(-4)}`;
}
