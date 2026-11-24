import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { sql } from "drizzle-orm";
import { env, isProduction } from "./config/env";
import { db } from "./database/connection";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimit";
import { requestContextMiddleware } from "./middleware/requestContext";
import adminAgencyRoutes from "./routes/adminAgency.routes";
import agentCatalogueRoutes from "./routes/agentCatalogue.routes";
import { adminBookingRoutes, agentBookingRoutes, bookingSetupRoutes } from "./routes/booking.routes";
import catalogueRoutes from "./routes/catalogue.routes";
import { adminFinanceRoutes, agentFinanceRoutes } from "./routes/finance.routes";
import { adminCommunicationRoutes, agentCommunicationRoutes, notificationRoutes } from "./routes/communication.routes";
import packageRoutes from "./routes/package.routes";
import pricingRoutes from "./routes/pricing.routes";
import { servePackageImage } from "./controllers/package.controller";
import agentRoutes from "./routes/agent.routes";
import auditLogRoutes from "./routes/auditLog.routes";
import authRoutes from "./routes/auth.routes";
import publicRoutes from "./routes/public.routes";
import roleRoutes from "./routes/role.routes";
import settingsRoutes from "./routes/settings.routes";
import userRoutes from "./routes/user.routes";
import { asyncHandler } from "./utils/http";
import { crmRoutes, websiteLeadRoutes } from "./routes/crm.routes";
import { metaSettingsRoutes } from "./routes/metaSettings.routes";
import { adminWebsiteRoutes, publicWebsiteRoutes } from "./routes/website.routes";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(cors((req, callback) => {
  if (/^\/api\/public\/website\/enquiries\/?$/.test(req.path)) {
    const origin = env.PUBLIC_WEBSITE_URL ? new URL(env.PUBLIC_WEBSITE_URL).origin : false;
    callback(null, { origin, methods: ["POST"] });
    return;
  }
  callback(null, { origin: env.FRONTEND_URL, credentials: true });
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
if (env.NODE_ENV !== "test") app.use(morgan(isProduction ? "combined" : "dev"));
app.use(requestContextMiddleware);
app.use("/api", apiLimiter);

app.get(
  "/api/health",
  asyncHandler(async (_req, res) => {
    await db.execute(sql`SELECT 1`);
    res.json({ success: true, status: "ok", time: new Date().toISOString() });
  }),
);

// ---- Public & auth ----
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/public/website/enquiries", websiteLeadRoutes);
app.use("/api/public/website", publicWebsiteRoutes);
app.get("/api/public/package-images/:imageId", asyncHandler(servePackageImage));

// ---- Agent portal ----
app.use("/api/agent/catalogue", agentCatalogueRoutes);
app.use("/api/agent/bookings", agentBookingRoutes);
app.use("/api/agent/finance", agentFinanceRoutes);
app.use("/api/agent", agentCommunicationRoutes);
app.use("/api/agent", agentRoutes);

// ---- Admin portal -------
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin/crm", crmRoutes);
app.use("/api/admin/meta-settings", metaSettingsRoutes);
app.use("/api/admin/website", adminWebsiteRoutes);
app.use("/api/admin", adminCommunicationRoutes);
app.use("/api/admin", adminAgencyRoutes);
app.use("/api/admin", roleRoutes);
app.use("/api/admin", pricingRoutes);
app.use("/api/admin/catalogue", catalogueRoutes);
app.use("/api/admin/packages", packageRoutes);
app.use("/api/admin/bookings", adminBookingRoutes);
app.use("/api/admin/finance", adminFinanceRoutes);
app.use("/api/admin/booking-setup", bookingSetupRoutes);
app.use("/api/admin/users", userRoutes);
app.use("/api/admin/settings", settingsRoutes);
app.use("/api/admin/audit-log", auditLogRoutes);

app.use("/api", notFoundHandler);
app.use(errorHandler);

export default app;
