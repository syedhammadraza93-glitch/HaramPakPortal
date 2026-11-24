import dns from "node:dns";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config";
import * as schema from "./schema";

// Force IPv4 lookups: some ISPs have broken IPv6 routes that make getaddrinfo time out (same fix as pmcmworks).
const origLookup = dns.lookup;
(dns as any).lookup = function (hostname: any, options: any, callback: any) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  return origLookup(hostname, { ...options, family: 4 }, callback);
};

// A new TLS connection to Neon costs seconds, so keep connections open longer and use TCP keepalive.
const POOL_MAX = Number(process.env.DB_POOL_MAX || 10);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 300_000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.error("Database pool error:", err);
});

export const db = drizzle(pool, { schema });

/** Either the main connection or a transaction, so helpers can run inside a caller's transaction. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbClient = typeof db | Tx;

/** Opens DB_WARM_CONNECTIONS connections and pings them every 30 s so requests do not wait for a new handshake. */
export function startDbKeepWarm(): void {
  const warm = Math.min(Number(process.env.DB_WARM_CONNECTIONS ?? 4), POOL_MAX);
  if (!(warm > 0)) return;
  const ping = () =>
    Promise.all(Array.from({ length: warm }, () => pool.query("SELECT 1"))).catch((err) => {
      console.warn("DB keep-warm ping failed (non-fatal):", err?.message || err);
    });
  void ping();
  setInterval(ping, 30_000).unref();
}
