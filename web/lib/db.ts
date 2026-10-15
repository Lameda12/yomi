import "server-only";
import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP client, or null when DATABASE_URL is missing. Never import from client code. */
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // Local development only: point the driver at a local Neon HTTP proxy.
  if (process.env.NEON_LOCAL_PROXY) neonConfig.fetchEndpoint = process.env.NEON_LOCAL_PROXY;
  return (cached ??= neon(url));
}
