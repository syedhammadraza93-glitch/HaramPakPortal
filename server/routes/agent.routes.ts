import { Router } from "express";
import { downloadDocument, getProfile, resubmitApplication, updateProfile, uploadDocument } from "../controllers/agent.controller";
import { jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { singleDocumentUpload } from "../middleware/upload";
import { asyncHandler as h } from "../utils/http";

const router = Router();

// Agent portal: every route is scoped to the logged-in agent's own agency.
router.use(jwtGuard, requirePermission("portal.agent"));

router.get("/profile", h(getProfile));
router.patch("/profile", h(updateProfile));
router.post("/profile/resubmit", h(resubmitApplication));
router.post("/documents", singleDocumentUpload, h(uploadDocument));
router.get("/documents/:id", h(downloadDocument));

export default router;
