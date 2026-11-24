import { Router } from "express";
import {
  createDestination, createDocumentRequirement, createHotel, createPolicy, deleteDestination, deleteDocumentRequirement, deleteHotel,
  deletePolicy, listDestinations, listDocumentRequirements, listHotels, listPolicies, updateDestination, updateDocumentRequirement,
  updateHotel, updatePolicy,
} from "../controllers/catalogueSetup.controller";
import { jwtGuard, requirePermission as can } from "../middleware/auth.middleware";
import { asyncHandler as h } from "../utils/http";

/** /api/admin/catalogue: destinations, hotels, cancellation policies, document checklist. */
const router = Router();
router.use(jwtGuard);

router.get("/destinations", can("catalogue.view"), h(listDestinations));
router.post("/destinations", can("catalogue.manage"), h(createDestination));
router.put("/destinations/:id", can("catalogue.manage"), h(updateDestination));
router.delete("/destinations/:id", can("catalogue.manage"), h(deleteDestination));

router.get("/hotels", can("catalogue.view"), h(listHotels));
router.post("/hotels", can("catalogue.manage"), h(createHotel));
router.put("/hotels/:id", can("catalogue.manage"), h(updateHotel));
router.delete("/hotels/:id", can("catalogue.manage"), h(deleteHotel));

router.get("/cancellation-policies", can("catalogue.view"), h(listPolicies));
router.post("/cancellation-policies", can("catalogue.manage"), h(createPolicy));
router.put("/cancellation-policies/:id", can("catalogue.manage"), h(updatePolicy));
router.delete("/cancellation-policies/:id", can("catalogue.manage"), h(deletePolicy));

router.get("/document-requirements", can("catalogue.view"), h(listDocumentRequirements));
router.post("/document-requirements", can("catalogue.manage"), h(createDocumentRequirement));
router.put("/document-requirements/:id", can("catalogue.manage"), h(updateDocumentRequirement));
router.delete("/document-requirements/:id", can("catalogue.manage"), h(deleteDocumentRequirement));

export default router;
