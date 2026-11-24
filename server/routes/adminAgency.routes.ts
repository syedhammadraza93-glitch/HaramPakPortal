import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies } from "../database/schema";
import { logAudit } from "../services/audit.service";
import { uuidSchema } from "../utils/validation";
import {
  addAgencyNote, changeAgencyStatus, downloadAgencyDocument, getAgency, listAgencies,
  resendAgencyVerification, unlockAgencyUser, updateAgency, verifyAgencyDocument,
} from "../controllers/adminAgency.controller";
import { currentUser, jwtGuard, requirePermission as can } from "../middleware/auth.middleware";
import { asyncHandler as h, conflict, forbidden, ok, parse } from "../utils/http";

const router = Router();
router.use(jwtGuard);


router.get("/agencies", can("agent.view"), h(listAgencies));
router.get("/agencies/:id", can("agent.view"), h(getAgency));
router.patch("/agencies/:id", can("agent.edit"), h(updateAgency));
// approve | reject | request-info | suspend | reactivate | deactivate | reopen (permission checked per action)
router.post("/agencies/:id/status/:action", can("agent.view"), h(changeAgencyStatus));
router.post("/agencies/:id/notes", can("agent.notes"), h(addAgencyNote));
router.post("/agencies/:id/resend-verification", can("agent.approve"), h(resendAgencyVerification));
router.post("/agencies/:id/users/:userId/unlock", can("agent.edit"), h(unlockAgencyUser));
router.get("/agencies/:id/documents/:documentId", can("agent.view"), h(downloadAgencyDocument));
router.patch("/agencies/:id/documents/:documentId", can("agent.approve"), h(verifyAgencyDocument));

router.patch("/agencies/:id/access", can("agent.access"), h(async (req, res) => {
  if (currentUser(req).type !== "staff") throw forbidden();
  const id = parse(uuidSchema, req.params.id);
  const { version, ...portalAccess } = parse(z.object({ version: z.number().int().min(0),
    catalogue: z.boolean(), bookings: z.boolean(), finance: z.boolean(),
  }).strict(), req.body);
  await db.transaction(async tx => {
    const [saved] = await tx.update(agencies).set({ portalAccess, version: sql`${agencies.version} + 1` })
      .where(and(eq(agencies.id, id), eq(agencies.version, version))).returning({ id: agencies.id });
    if (!saved) throw conflict("Agency record changed. Reload and try again.");
    await logAudit({ action: "agency.access_changed", entityType: "agency", entityId: id, newValues: portalAccess }, tx);
  });
  ok(res, null, "Agency access updated");
}));

export default router;
