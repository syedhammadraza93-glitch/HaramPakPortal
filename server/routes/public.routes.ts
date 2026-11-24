import { Router } from "express";
import { registerAgency } from "../controllers/registration.controller";
import { getPublicCompany, getPublicConfig, getPublicLogo, getPublicRegistrationFields } from "../controllers/settings.controller";
import { registrationLimiter } from "../middleware/rateLimit";
import { registrationUpload } from "../middleware/upload";
import { asyncHandler as h } from "../utils/http";

const router = Router();

router.get("/registration-fields", h(getPublicRegistrationFields));
router.get("/company", h(getPublicCompany));
router.get("/config", h(getPublicConfig));
router.get("/logo", h(getPublicLogo));
router.post("/agent-registrations", registrationLimiter, registrationUpload, h(registerAgency));

export default router;
