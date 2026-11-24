import { env } from "./config/env";
import app from "./app";
import { sql } from "drizzle-orm";
import { db, startDbKeepWarm } from "./database/connection";
import { seedReferenceData } from "./database/seeds/seed";
import { bootstrapFirstAdmin } from "./services/firstAdminBootstrap";
import { startMailWorker } from "./services/mail.service";
import { startBookingJobs } from "./services/booking.service";
import { startCrmJobs } from "./services/crmEscalations.service";
import { startAlertJobs } from "./services/agentAlerts.service";

// Server initialization & startup checks
async function startServer() {
  try {
    console.log("🔄 Testing database connection...");
    await db.execute(sql`SELECT 1`);
    console.log("✅ Database connected successfully.");

    await seedReferenceData();
    console.log("✅ Roles, permissions and settings are up to date.");

    await bootstrapFirstAdmin();

    const server = app.listen(env.PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on http://localhost:${env.PORT}/api`);
      startDbKeepWarm();
      startMailWorker();
      startBookingJobs();
      startAlertJobs();
      startCrmJobs();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${env.PORT} is already in use (another server is still running).`);
        console.error(`   Find it:  Get-NetTCPConnection -LocalPort ${env.PORT} -State Listen | Select OwningProcess`);
        console.error(`   Stop it:  Stop-Process -Id <OwningProcess>   (or change PORT in server/.env)`);
      } else {
        console.error("❌ Server error:", err.message);
      }
      process.exit(1);
    });
  } catch (error: any) {
    console.error("❌ Server startup failed:", error?.message || error);
    if (String(error?.message || "").includes('relation "')) console.error("   Did you run `npm run db:migrate`?");
    process.exit(1);
  }
}

void startServer();
