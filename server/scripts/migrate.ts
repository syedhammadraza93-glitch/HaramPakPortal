import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../database/connection";

/**
 * Applies pending SQL migrations from ./drizzle (created with `npm run db:generate`).
 * Each migration runs in a transaction and is recorded in drizzle.__drizzle_migrations,
 * so running this again only applies new files.
 */
async function runMigrations() {
  const started = Date.now();
  console.log("⚡ Applying database migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`🎉 Migrations complete in ${((Date.now() - started) / 1000).toFixed(2)}s.`);
  await pool.end();
}

runMigrations().catch(async (err) => {
  console.error("❌ Migration failed:", err?.message || err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
