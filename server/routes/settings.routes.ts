import { Router } from "express";
import {
  deleteLogo,
  getAdminCompany,
  getAdminRegistrationFields,
  getSecuritySettings,
  updateBranding,
  updateCompany,
  updateRegistrationFields,
  updateSecuritySettings,
  uploadLogo,
} from "../controllers/settings.controller";
import { singleDocumentUpload } from "../middleware/upload";
import { jwtGuard, requirePermission } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

const router = Router();
router.use(jwtGuard, requirePermission("settings.manage"));

router.get("/registration-fields", h(getAdminRegistrationFields));
router.put("/registration-fields", h(updateRegistrationFields));
router.get("/company", h(getAdminCompany));
router.put("/company", h(updateCompany));
router.put("/branding", h(updateBranding));
router.get("/security", h(getSecuritySettings));
router.put("/security", h(updateSecuritySettings));
router.post("/logo", singleDocumentUpload, h(uploadLogo));
router.delete("/logo", h(deleteLogo));

export default router;
