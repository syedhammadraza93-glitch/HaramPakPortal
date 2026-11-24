import { Router } from "express";
import {
  agentVisaRates, browsePackages, catalogueFilters, catalogueSummary, getAgentBrochure, getAgentPackage,
} from "../controllers/agentCatalogue.controller";
import { jwtGuard, requireAgencyAccess, requirePermission } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

/** /api/agent/catalogue: only approved agencies, with prices for their own agency. */
const router = Router();
router.use(jwtGuard, requirePermission("portal.agent"), requireAgencyAccess("catalogue"));

router.get("/summary", h(catalogueSummary));
router.get("/filters", h(catalogueFilters));
router.get("/packages", h(browsePackages));
router.get("/packages/:id", h(getAgentPackage));
router.get("/packages/:id/brochure", h(getAgentBrochure));
router.get("/visa-rates", h(agentVisaRates));

export default router;
