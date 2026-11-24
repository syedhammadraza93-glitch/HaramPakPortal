import { Router } from "express";
import {
  createPricingGroup, createVisaRate, deletePricingGroup, listPricingGroups, listVisaRates, updateAgencyCommercial, updatePricingGroup,
  updateVisaRate,
} from "../controllers/pricing.controller";
import { jwtGuard, requirePermission as can } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

/** /api/admin: pricing groups, visa rates, agency commercial terms. */
const router = Router();
router.use(jwtGuard);

// Group names are shown on agency pages, so any admin-portal user can read them.
router.get("/pricing-groups", can("dashboard.admin"), h(listPricingGroups));
router.post("/pricing-groups", can("pricing.manage"), h(createPricingGroup));
router.put("/pricing-groups/:id", can("pricing.manage"), h(updatePricingGroup));
router.delete("/pricing-groups/:id", can("pricing.manage"), h(deletePricingGroup));

router.get("/visa-rates", can("catalogue.view"), h(listVisaRates));
router.post("/visa-rates", can("pricing.manage"), h(createVisaRate));
router.put("/visa-rates/:id", can("pricing.manage"), h(updateVisaRate));

router.patch("/agencies/:id/commercial", can("pricing.manage"), h(updateAgencyCommercial));

export default router;
